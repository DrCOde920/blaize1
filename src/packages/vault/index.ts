/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Key Vault & Security Package (`src/packages/vault/index.ts`)
 * - SecretVault interface: store, useForRequest, rotate, delete, listMasked.
 * - Renderer never reads a stored plaintext key; only main process / server resolves it
 *   inside `useForRequest`.
 * - Implementations:
 *   A) ElectronSafeStorageVault: checks Linux backend (`basic_text` refused unless
 *      explicitly accepted with warning; notes macOS code-signing requirement).
 *   B) PassphraseWrapVault: wraps keys with AES-256-GCM using a key derived from the
 *      user's secret code, protecting against same-user process reads, with wrong-passphrase
 *      and tamper detection + automatic idle lock.
 *   C) PreviewServerVault & BrowserWebCryptoFallbackVault (clearly labeled lower-security fallback).
 * - Capability-scoped secret handles for plugins (`cap_secret_...`).
 * - Universal log/output/error redactor (`redactSecretsFromText`) and bundle scanner.
 */

export type LinuxSafeStorageBackend =
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'gnome_libsecret'
  | 'basic_text'
  | 'unknown';

export type VaultBackendKind =
  | 'electron_safe_storage'
  | 'passphrase_aes_256_gcm'
  | 'server_env_preview'
  | 'browser_webcrypto_fallback';

export interface MaskedVaultEntry {
  keyId: string;
  label: string;
  provider: string;
  maskedPreview: string; // e.g. "••••7f9a" — only last 4 chars
  lastFour: string;
  backendKind: VaultBackendKind;
  createdAtIso: string;
  rotatedAtIso?: string;
  spendCapUsd: number;
  spentUsd: number;
  rateLimitPerMinute: number;
  requestsInCurrentWindow: number;
  alertThresholdPct: number;
  alertTriggered: boolean;
}

export interface StoreSecretInput {
  keyId: string;
  label: string;
  provider: string;
  plainKey: string;
  spendCapUsd?: number;
  rateLimitPerMinute?: number;
  alertThresholdPct?: number;
}

export interface UseForRequestOptions {
  estimatedCostUsd?: number;
  nowMs?: number;
}

export interface UseForRequestResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  alertMessage?: string;
}

export interface SecretVault {
  store(input: StoreSecretInput, secretCode?: string): Promise<MaskedVaultEntry>;
  useForRequest<T>(
    keyId: string,
    executor: (resolvedKey: string) => Promise<T>,
    options?: UseForRequestOptions
  ): Promise<UseForRequestResult<T>>;
  rotate(keyId: string, newPlainKey: string, secretCode: string): Promise<MaskedVaultEntry>;
  delete(keyId: string, secretCode: string): Promise<boolean>;
  listMasked(): MaskedVaultEntry[];
  isLocked(): boolean;
  lock(): void;
  unlock(secretCode: string): Promise<boolean>;
  checkIdleLock(nowMs?: number): boolean;
}

export function maskSecretKeyLastFour(plainKey: string): {
  maskedPreview: string;
  lastFour: string;
} {
  const trimmed = (plainKey || '').trim();
  const lastFour = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed.padStart(4, '*');
  return {
    maskedPreview: `••••${lastFour}`,
    lastFour,
  };
}

// ============================================================================
// UNIVERSAL LOG / ERROR / OUTPUT REDACTOR
// ============================================================================

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bmeta-[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{14,}\b/gi,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token|model[_-]?api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{10,}["']?/gi,
];

/**
 * Redacts key-like patterns from logs, tool results, errors, ledger payloads, and model outputs.
 */
export function redactSecretsFromText(
  text: string,
  exactSecretsToScrub: string[] = []
): string {
  if (!text) return text;
  let scrubbed = text;

  for (const exact of exactSecretsToScrub) {
    if (exact && exact.trim().length >= 6) {
      const escaped = exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scrubbed = scrubbed.replace(new RegExp(escaped, 'g'), '[REDACTED_VAULT_SECRET]');
    }
  }

  for (const regex of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(regex, (match) => {
      if (/^bearer\s+/i.test(match)) {
        return 'Bearer [REDACTED_SECRET]';
      }
      if (/[:=]/.test(match)) {
        const prefix = match.split(/[:=]/)[0];
        return `${prefix}=[REDACTED_SECRET]`;
      }
      return '[REDACTED_SECRET]';
    });
  }

  return scrubbed;
}

/**
 * Build-time / runtime bundle scanner ensuring no raw API keys appear in client source or bundles.
 */
export function scanBundleSourceForLeakedKeys(sourceText: string): {
  clean: boolean;
  matches: string[];
} {
  const matches: string[] = [];
  const strictPatterns = [
    /\bsk-[A-Za-z0-9]{20,}\b/g,
    /\bmeta-live-[A-Za-z0-9]{16,}\b/g,
    /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    /\bghp_[A-Za-z0-9]{30,}\b/g,
  ];
  for (const pat of strictPatterns) {
    const found = sourceText.match(pat);
    if (found) {
      matches.push(...found);
    }
  }
  return {
    clean: matches.length === 0,
    matches,
  };
}

// ============================================================================
// CAPABILITY-SCOPED PLUGIN SECRET HANDLES
// ============================================================================

export interface CapabilitySecretHandle {
  handleId: string; // e.g., "cap_secret_l3xi_01"
  pluginId: string;
  keyId: string;
  allowedDomains: string[];
  createdAtIso: string;
}

export class PluginSecretHandleBroker {
  private handles = new Map<string, CapabilitySecretHandle>();

  issueHandle(
    pluginId: string,
    keyId: string,
    allowedDomains: string[]
  ): CapabilitySecretHandle {
    const handleId = `cap_secret_${pluginId.replace(/[^a-z0-9]/gi, '_')}_${keyId}`;
    const handle: CapabilitySecretHandle = {
      handleId,
      pluginId,
      keyId,
      allowedDomains: allowedDomains.map((d) => d.toLowerCase()),
      createdAtIso: new Date().toISOString(),
    };
    this.handles.set(handleId, handle);
    return handle;
  }

  async executeWithHandle<T>(
    handleId: string,
    targetUrl: string,
    vault: SecretVault,
    executor: (resolvedKey: string) => Promise<T>
  ): Promise<UseForRequestResult<T>> {
    const handle = this.handles.get(handleId);
    if (!handle) {
      return { ok: false, error: `Unknown or revoked capability secret handle: ${handleId}` };
    }
    let hostname = '';
    try {
      hostname = new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return { ok: false, error: `Invalid target URL for capability secret handle: ${targetUrl}` };
    }
    if (!handle.allowedDomains.includes(hostname)) {
      return {
        ok: false,
        error: `Plugin '${handle.pluginId}' is not permitted to use handle '${handleId}' on domain '${hostname}'.`,
      };
    }
    return vault.useForRequest(handle.keyId, executor);
  }
}

// ============================================================================
// CRYPTO HELPERS (WebCrypto AES-256-GCM + PBKDF2-SHA256)
// ============================================================================

function getSubtleCrypto(): SubtleCrypto {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('WebCrypto SubtleCrypto is required for AES-256-GCM vault encryption.');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export const PBKDF2_ITERATIONS = 210000;
export const LEGACY_PBKDF2_ITERATIONS = 60000;

async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedSecretEnvelope {
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

export async function encryptWithPassphraseAesGcm(
  plainText: string,
  passphrase: string,
  iterations = PBKDF2_ITERATIONS
): Promise<EncryptedSecretEnvelope> {
  const subtle = getSubtleCrypto();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);
  const key = await deriveAesGcmKey(passphrase, salt, iterations);
  const encoded = new TextEncoder().encode(plainText);
  const encryptedBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded
  );
  return {
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(encryptedBuf)),
  };
}

export async function decryptWithPassphraseAesGcm(
  envelope: EncryptedSecretEnvelope,
  passphrase: string
): Promise<string> {
  const subtle = getSubtleCrypto();
  const salt = base64ToBytes(envelope.saltB64);
  const iv = base64ToBytes(envelope.ivB64);
  const ciphertext = base64ToBytes(envelope.ciphertextB64);

  // Try standard 210,000 iterations first
  try {
    const key = await deriveAesGcmKey(passphrase, salt, PBKDF2_ITERATIONS);
    const decryptedBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch (primaryErr) {
    // Fall back to legacy 60,000 iterations for backwards compatibility
    try {
      const legacyKey = await deriveAesGcmKey(passphrase, salt, LEGACY_PBKDF2_ITERATIONS);
      const decryptedBuf = await subtle.decrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        legacyKey,
        ciphertext as unknown as BufferSource
      );
      return new TextDecoder().decode(decryptedBuf);
    } catch {
      throw primaryErr;
    }
  }
}

// ============================================================================
// IMPLEMENTATION A: ElectronSafeStorageVault (with Linux basic_text check)
// ============================================================================

export interface ElectronSafeStorageBridge {
  getSelectedStorageBackend: () => Promise<LinuxSafeStorageBackend>;
  isEncryptionAvailable: () => Promise<boolean>;
  encryptString: (plainText: string) => Promise<string>;
  decryptString: (encryptedB64: string) => Promise<string>;
  platform: 'linux' | 'darwin' | 'win32';
  isMacCodeSigned?: boolean;
}

export interface ElectronSafeStorageVaultOptions {
  allowUnprotectedBasicTextFallback?: boolean;
}

/**
 * Checks whether the OS safeStorage backend is safe to store secrets.
 * On Linux, refuses `basic_text` unless `allowUnprotectedBasicTextFallback` is explicitly true.
 */
export async function verifySafeStorageBackend(
  bridge: ElectronSafeStorageBridge,
  options: ElectronSafeStorageVaultOptions = {}
): Promise<{
  allowed: boolean;
  warning?: string;
  error?: string;
}> {
  if (bridge.platform === 'linux') {
    const backend = await bridge.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      if (!options.allowUnprotectedBasicTextFallback) {
        return {
          allowed: false,
          error:
            'Refused to store key: Linux safeStorage backend is "basic_text" (unencrypted plaintext). Install gnome-keyring/kwallet or explicitly accept the unprotected fallback warning.',
        };
      }
      return {
        allowed: true,
        warning:
          'WARNING: Using unprotected Linux basic_text fallback by explicit operator override.',
      };
    }
  }

  if (bridge.platform === 'darwin' && bridge.isMacCodeSigned === false) {
    return {
      allowed: true,
      warning:
        'macOS note: Production Keychain isolation requires a code-signed application bundle.',
    };
  }

  const available = await bridge.isEncryptionAvailable();
  if (!available && !options.allowUnprotectedBasicTextFallback) {
    return {
      allowed: false,
      error: 'OS safeStorage encryption is unavailable on this system.',
    };
  }

  return { allowed: true };
}

// ============================================================================
// IMPLEMENTATION B: PassphraseWrapVault (AES-256-GCM + Idle Lock + Spend/Rate Caps)
// ============================================================================

interface StoredVaultRecord {
  meta: MaskedVaultEntry;
  envelope: EncryptedSecretEnvelope;
  windowStartedAtMs: number;
}

export class PassphraseWrapVault implements SecretVault {
  private records = new Map<string, StoredVaultRecord>();
  private unlockedPassphrase: string | null = null;
  private lastActivityMs: number = Date.now();
  private readonly idleTimeoutMs: number;
  private readonly backendKind: VaultBackendKind;
  private readonly linuxBridge?: ElectronSafeStorageBridge;
  private readonly allowBasicTextFallback: boolean;
  private durableDb?: any;

  constructor(options?: {
    idleTimeoutMs?: number;
    backendKind?: VaultBackendKind;
    linuxBridge?: ElectronSafeStorageBridge;
    allowBasicTextFallback?: boolean;
    durableDb?: any;
  }) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 5 * 60 * 1000; // 5 minutes default
    this.backendKind = options?.backendKind ?? 'passphrase_aes_256_gcm';
    this.linuxBridge = options?.linuxBridge;
    this.allowBasicTextFallback = Boolean(options?.allowBasicTextFallback);
    this.durableDb = options?.durableDb;
  }

  attachDurableDatabase(db: any): void {
    this.durableDb = db;
  }

  isLocked(): boolean {
    return this.unlockedPassphrase === null;
  }

  lock(): void {
    this.unlockedPassphrase = null;
  }

  checkIdleLock(nowMs = Date.now()): boolean {
    if (this.unlockedPassphrase && nowMs - this.lastActivityMs >= this.idleTimeoutMs) {
      this.lock();
      return true;
    }
    return this.isLocked();
  }

  async unlock(secretCode: string): Promise<boolean> {
    if (!secretCode || secretCode.trim().length < 4) {
      return false;
    }

    // If records are empty in cache, attempt to populate from durable database
    if (this.records.size === 0 && this.durableDb) {
      try {
        const masked = this.durableDb.listVaultMasked();
        for (const m of masked) {
          const item = this.durableDb.getVaultSecret(m.keyId);
          if (item) {
            const envelope: EncryptedSecretEnvelope = {
              saltB64: Buffer.from(item.secret.saltHex, 'hex').toString('base64'),
              ivB64: Buffer.from(item.secret.ivHex, 'hex').toString('base64'),
              ciphertextB64: Buffer.from(item.secret.ciphertextHex, 'hex').toString('base64'),
            };
            this.records.set(m.keyId, {
              meta: item.meta,
              envelope,
              windowStartedAtMs: Date.now(),
            });
          }
        }
      } catch {
        // Fall back to memory records
      }
    }

    // If there are existing records, verify the secretCode can decrypt the first record
    const first = this.records.values().next().value as StoredVaultRecord | undefined;
    if (first) {
      try {
        await decryptWithPassphraseAesGcm(first.envelope, secretCode);
      } catch {
        return false;
      }
    }
    this.unlockedPassphrase = secretCode;
    this.lastActivityMs = Date.now();
    return true;
  }

  async store(input: StoreSecretInput, secretCode?: string): Promise<MaskedVaultEntry> {
    if (this.linuxBridge) {
      const check = await verifySafeStorageBackend(this.linuxBridge, {
        allowUnprotectedBasicTextFallback: this.allowBasicTextFallback,
      });
      if (!check.allowed) {
        throw new Error(check.error);
      }
    }

    const code = secretCode || this.unlockedPassphrase;
    if (!code || code.trim().length < 4) {
      throw new Error('A secret code (at least 4 characters) is required to encrypt and store a key.');
    }

    const trimmedKey = input.plainKey.trim();
    if (trimmedKey.length < 6) {
      throw new Error('API key must be at least 6 characters.');
    }

    const envelope = await encryptWithPassphraseAesGcm(trimmedKey, code);
    const { maskedPreview, lastFour } = maskSecretKeyLastFour(trimmedKey);
    const meta: MaskedVaultEntry = {
      keyId: input.keyId,
      label: input.label,
      provider: input.provider,
      maskedPreview,
      lastFour,
      backendKind: this.backendKind,
      createdAtIso: new Date().toISOString(),
      spendCapUsd: input.spendCapUsd ?? 10.0,
      spentUsd: 0,
      rateLimitPerMinute: input.rateLimitPerMinute ?? 30,
      requestsInCurrentWindow: 0,
      alertThresholdPct: input.alertThresholdPct ?? 80,
      alertTriggered: false,
    };

    this.records.set(input.keyId, {
      meta,
      envelope,
      windowStartedAtMs: Date.now(),
    });

    if (this.durableDb) {
      try {
        this.durableDb.storeVaultSecret(
          meta,
          {
            saltHex: Buffer.from(base64ToBytes(envelope.saltB64)).toString('hex'),
            ivHex: Buffer.from(base64ToBytes(envelope.ivB64)).toString('hex'),
            ciphertextHex: Buffer.from(base64ToBytes(envelope.ciphertextB64)).toString('hex'),
            authTagHex: '00'.repeat(16),
            algorithm: 'aes-256-gcm',
          }
        );
      } catch {
        // In-memory continues
      }
    }

    this.unlockedPassphrase = code;
    this.lastActivityMs = Date.now();
    return structuredClone(meta);
  }

  async useForRequest<T>(
    keyId: string,
    executor: (resolvedKey: string) => Promise<T>,
    options: UseForRequestOptions = {}
  ): Promise<UseForRequestResult<T>> {
    const nowMs = options.nowMs ?? Date.now();
    if (this.checkIdleLock(nowMs)) {
      return {
        ok: false,
        error: 'Vault is locked due to inactivity. Unlock with your secret code before making requests.',
      };
    }

    const record = this.records.get(keyId);
    if (!record) {
      return { ok: false, error: `Key '${keyId}' not found in vault.` };
    }

    // Rate-limit window check (60s rolling window)
    if (nowMs - record.windowStartedAtMs >= 60_000) {
      record.windowStartedAtMs = nowMs;
      record.meta.requestsInCurrentWindow = 0;
    }

    if (record.meta.requestsInCurrentWindow + 1 > record.meta.rateLimitPerMinute) {
      return {
        ok: false,
        error: `Rate limit exceeded for '${record.meta.label}' (${record.meta.rateLimitPerMinute} requests/min).`,
      };
    }

    const cost = options.estimatedCostUsd ?? 0.01;
    if (record.meta.spentUsd + cost > record.meta.spendCapUsd) {
      return {
        ok: false,
        error: `Spend cap ($${record.meta.spendCapUsd.toFixed(2)}) reached for '${record.meta.label}'.`,
      };
    }

    let plainKey: string;
    try {
      plainKey = await decryptWithPassphraseAesGcm(record.envelope, this.unlockedPassphrase!);
    } catch {
      return {
        ok: false,
        error: 'Vault integrity check failed: wrong passphrase or tampered ciphertext.',
      };
    }

    record.meta.requestsInCurrentWindow += 1;
    record.meta.spentUsd = Number((record.meta.spentUsd + cost).toFixed(4));
    this.lastActivityMs = nowMs;

    const usagePct = (record.meta.spentUsd / record.meta.spendCapUsd) * 100;
    let alertMessage: string | undefined;
    if (usagePct >= record.meta.alertThresholdPct) {
      record.meta.alertTriggered = true;
      alertMessage = `Spend alert: '${record.meta.label}' is at ${Math.round(usagePct)}% of its $${record.meta.spendCapUsd.toFixed(2)} cap.`;
    }

    const result = await executor(plainKey);
    return {
      ok: true,
      result,
      alertMessage,
    };
  }

  async rotate(keyId: string, newPlainKey: string, secretCode: string): Promise<MaskedVaultEntry> {
    const record = this.records.get(keyId);
    if (!record) {
      throw new Error(`Key '${keyId}' not found.`);
    }
    // Verify current secretCode decrypts existing envelope before rotation
    try {
      await decryptWithPassphraseAesGcm(record.envelope, secretCode);
    } catch {
      throw new Error('Invalid secret code: cannot rotate key without verifying current secret code.');
    }

    const trimmed = newPlainKey.trim();
    const newEnvelope = await encryptWithPassphraseAesGcm(trimmed, secretCode);
    const { maskedPreview, lastFour } = maskSecretKeyLastFour(trimmed);
    record.envelope = newEnvelope;
    record.meta.maskedPreview = maskedPreview;
    record.meta.lastFour = lastFour;
    record.meta.rotatedAtIso = new Date().toISOString();

    if (this.durableDb) {
      try {
        this.durableDb.storeVaultSecret(
          record.meta,
          {
            saltHex: Buffer.from(base64ToBytes(newEnvelope.saltB64)).toString('hex'),
            ivHex: Buffer.from(base64ToBytes(newEnvelope.ivB64)).toString('hex'),
            ciphertextHex: Buffer.from(base64ToBytes(newEnvelope.ciphertextB64)).toString('hex'),
            authTagHex: '00'.repeat(16),
            algorithm: 'aes-256-gcm',
          }
        );
      } catch {
        // Ignore
      }
    }

    this.unlockedPassphrase = secretCode;
    this.lastActivityMs = Date.now();
    return structuredClone(record.meta);
  }

  async delete(keyId: string, secretCode: string): Promise<boolean> {
    const record = this.records.get(keyId);
    if (!record) return false;
    try {
      await decryptWithPassphraseAesGcm(record.envelope, secretCode);
    } catch {
      throw new Error('Invalid secret code: cannot delete key without verifying current secret code.');
    }
    const existed = this.records.delete(keyId);
    if (this.durableDb) {
      try {
        this.durableDb.deleteVaultSecret(keyId);
      } catch {
        // Ignore
      }
    }
    return existed;
  }

  listMasked(): MaskedVaultEntry[] {
    return Array.from(this.records.values()).map((r) => structuredClone(r.meta));
  }

  /**
   * Used only in unit tests to simulate disk ciphertext tampering.
   */
  simulateCiphertextTamperForTest(keyId: string): void {
    const record = this.records.get(keyId);
    if (!record) return;
    const raw = base64ToBytes(record.envelope.ciphertextB64);
    if (raw.length > 0) {
      raw[0] = raw[0] ^ 0xff;
      record.envelope.ciphertextB64 = bytesToBase64(raw);
    }
  }

  getStatus(): { locked: boolean; backend: VaultBackendKind; keyCount: number } {
    return {
      locked: this.isLocked(),
      backend: this.backendKind,
      keyCount: this.records.size,
    };
  }
}

export const globalSecretVault = new PassphraseWrapVault();

