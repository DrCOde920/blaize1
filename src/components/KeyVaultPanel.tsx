/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Key Vault & Security Panel (`Settings > Vault & Keys`)
 * - Masked entry, no reveal after saving, shows only the last 4 characters (`••••7f9a`).
 * - Replace (rotate) and delete require the user's secret code.
 * - Automatic vault lock after idle + manual Lock/Unlock.
 * - Server-side Test Connection, per-key spend caps, rate limits, and alerts.
 * - Linux `basic_text` backend refusal check unless explicitly overridden with warning.
 * - Capability-scoped secret handles (`cap_secret_...`) for plugins.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  LinuxSafeStorageBackend,
  MaskedVaultEntry,
  VaultBackendKind,
  redactSecretsFromText,
  verifySafeStorageBackend,
} from '../packages/vault';
import { ModelConnectionTestResult } from '../packages/runtime';

interface KeyVaultPanelProps {
  isLight: boolean;
  onTestServerConnection: () => Promise<ModelConnectionTestResult>;
  connectionTestResult: ModelConnectionTestResult | null;
  onRecordLedgerEvent: (summary: string, payload: Record<string, unknown>) => void;
}

export const KeyVaultPanel: React.FC<KeyVaultPanelProps> = ({
  isLight,
  onTestServerConnection,
  connectionTestResult,
  onRecordLedgerEvent,
}) => {
  const [vaultKeys, setVaultKeys] = useState<MaskedVaultEntry[]>([]);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [launchTokenPreview, setLaunchTokenPreview] = useState('••••local');
  const [selectedBackend, setSelectedBackend] = useState<VaultBackendKind>('passphrase_aes_256_gcm');
  const [simulatedLinuxBackend, setSimulatedLinuxBackend] =
    useState<LinuxSafeStorageBackend>('gnome_libsecret');
  const [allowUnprotectedBasicText, setAllowUnprotectedBasicText] = useState(false);

  // Add key form state (masked, cleared immediately on save)
  const [newKeyLabel, setNewKeyLabel] = useState('Meta Model API (Live)');
  const [newKeyProvider, setNewKeyProvider] = useState('Meta AI');
  const [newPlainKeyInput, setNewPlainKeyInput] = useState('');
  const [newSpendCapUsd, setNewSpendCapUsd] = useState(15);
  const [newRateLimitPerMin, setNewRateLimitPerMin] = useState(30);
  const [secretCodeInput, setSecretCodeInput] = useState('2026');

  // Rotate / Delete / Unlock state
  const [activeRotateKeyId, setActiveRotateKeyId] = useState<string | null>(null);
  const [rotatePlainInput, setRotatePlainInput] = useState('');
  const [rotateSecretCode, setRotateSecretCode] = useState('');
  const [vaultFeedback, setVaultFeedback] = useState<{
    type: 'ok' | 'error' | 'warn';
    text: string;
  } | null>(null);
  const [showSecurityDetails, setShowSecurityDetails] = useState(false);

  const fetchServerVaultStatus = async () => {
    try {
      const res = await fetch('/api/vault/status');
      const data = await res.json();
      if (data.ok && Array.isArray(data.keys)) {
        setVaultKeys(data.keys);
        setVaultLocked(Boolean(data.locked));
        if (data.launchTokenPreview) setLaunchTokenPreview(data.launchTokenPreview);
      }
    } catch {
      // Offline fallback
    }
  };

  useEffect(() => {
    void fetchServerVaultStatus();
  }, []);

  const handleStoreKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultFeedback(null);

    // Check Linux basic_text backend refusal rule first
    const backendCheck = await verifySafeStorageBackend(
      {
        platform: 'linux',
        getSelectedStorageBackend: async () => simulatedLinuxBackend,
        isEncryptionAvailable: async () => simulatedLinuxBackend !== 'basic_text',
        encryptString: async (s) => s,
        decryptString: async (s) => s,
      },
      { allowUnprotectedBasicTextFallback: allowUnprotectedBasicText }
    );

    if (!backendCheck.allowed) {
      setVaultFeedback({
        type: 'error',
        text: backendCheck.error || 'Refused to store secret on basic_text backend.',
      });
      return;
    }

    try {
      const response = await fetch('/api/vault/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId: `key-${Date.now()}`,
          label: newKeyLabel,
          provider: newKeyProvider,
          plainKey: newPlainKeyInput,
          spendCapUsd: newSpendCapUsd,
          rateLimitPerMinute: newRateLimitPerMin,
          secretCode: secretCodeInput,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setVaultFeedback({
          type: 'error',
          text: data.error || 'Failed to store key in vault.',
        });
        return;
      }

      // Immediately clear plaintext input so it can never be revealed
      setNewPlainKeyInput('');
      await fetchServerVaultStatus();
      onRecordLedgerEvent(`Stored masked key in Vault (${data.entry.maskedPreview})`, {
        keyId: data.entry.keyId,
        maskedPreview: data.entry.maskedPreview,
        backend: selectedBackend,
      });
      setVaultFeedback({
        type: backendCheck.warning ? 'warn' : 'ok',
        text:
          backendCheck.warning ||
          `Saved "${data.entry.label}" (${data.entry.maskedPreview}). Plaintext cleared; only server resolves it.`,
      });
    } catch (err: any) {
      setVaultFeedback({
        type: 'error',
        text: redactSecretsFromText(err?.message || 'Vault error'),
      });
    }
  };

  const handleRotateKey = async (keyId: string) => {
    setVaultFeedback(null);
    try {
      const response = await fetch('/api/vault/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId,
          newPlainKey: rotatePlainInput,
          secretCode: rotateSecretCode,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setVaultFeedback({
          type: 'error',
          text: data.error || 'Secret code required to rotate key.',
        });
        return;
      }
      setRotatePlainInput('');
      setRotateSecretCode('');
      setActiveRotateKeyId(null);
      await fetchServerVaultStatus();
      onRecordLedgerEvent(`Rotated vault key (${data.entry.maskedPreview})`, {
        keyId,
        maskedPreview: data.entry.maskedPreview,
      });
      setVaultFeedback({
        type: 'ok',
        text: `Rotated key to ${data.entry.maskedPreview}.`,
      });
    } catch (err: any) {
      setVaultFeedback({
        type: 'error',
        text: redactSecretsFromText(err?.message || 'Rotation failed'),
      });
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    setVaultFeedback(null);
    try {
      const response = await fetch('/api/vault/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId,
          secretCode: secretCodeInput,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setVaultFeedback({
          type: 'error',
          text: data.error || 'Valid secret code required to delete key.',
        });
        return;
      }
      await fetchServerVaultStatus();
      onRecordLedgerEvent(`Deleted key from Vault`, { keyId });
      setVaultFeedback({ type: 'ok', text: 'Key deleted after secret code verification.' });
    } catch (err: any) {
      setVaultFeedback({
        type: 'error',
        text: redactSecretsFromText(err?.message || 'Delete failed'),
      });
    }
  };

  const handleToggleLock = async () => {
    setVaultFeedback(null);
    if (!vaultLocked) {
      await fetch('/api/vault/lock', { method: 'POST' });
      setVaultLocked(true);
      setVaultFeedback({
        type: 'warn',
        text: 'Vault locked. Host cannot resolve keys until unlocked with your secret code.',
      });
    } else {
      const res = await fetch('/api/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretCode: secretCodeInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setVaultFeedback({
          type: 'error',
          text: data.error || 'Wrong secret code: vault remains locked.',
        });
        return;
      }
      setVaultLocked(false);
      setVaultFeedback({ type: 'ok', text: 'Vault unlocked in server memory (5m idle auto-lock).' });
    }
  };

  return (
    <section className="space-y-5" data-testid="key-vault-panel">
      {/* Header & Lock / Test Connection Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Key Vault &amp; Security</h2>
            <span
              data-testid="vault-lock-badge"
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                vaultLocked
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {vaultLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              <span>{vaultLocked ? 'Locked' : 'Unlocked (5m Auto-Lock)'}</span>
            </span>
          </div>
          <p className="text-stone-400 mt-0.5">
            Keys are AES-256-GCM wrapped with your secret code and resolved only on the server.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="vault-lock-toggle-btn"
            onClick={handleToggleLock}
            className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-xs font-medium inline-flex items-center gap-1.5"
          >
            {vaultLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{vaultLocked ? 'Unlock Vault' : 'Lock Vault'}</span>
          </button>
          <button
            type="button"
            data-testid="vault-test-connection-btn"
            onClick={() => void onTestServerConnection()}
            className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
          >
            Test Connection
          </button>
        </div>
      </div>

      {vaultFeedback && (
        <div
          data-testid="vault-feedback-banner"
          className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs ${
            vaultFeedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : vaultFeedback.type === 'warn'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          {vaultFeedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{vaultFeedback.text}</span>
        </div>
      )}

      {connectionTestResult && (
        <div
          data-testid="vault-connection-banner"
          className={`p-3 rounded-xl border text-xs ${
            connectionTestResult.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          {connectionTestResult.message}
        </div>
      )}

      {/* Masked Keys List (Never reveals full key; shows only last 4 chars) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Stored Keys (Masked — Last 4 Characters Only)</span>
          <span className="text-stone-400">Proxy Token: {launchTokenPreview}</span>
        </div>

        {vaultKeys.map((k) => (
          <div
            key={k.keyId}
            data-testid={`vault-key-row-${k.keyId}`}
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold text-xs flex items-center gap-2">
                    <span>{k.label}</span>
                    <span
                      data-testid={`vault-masked-preview-${k.keyId}`}
                      className="px-2 py-0.5 rounded bg-stone-800 text-stone-200 font-mono text-[11px]"
                    >
                      {k.maskedPreview}
                    </span>
                  </div>
                  <div className="text-[11px] text-stone-400">
                    Spend: ${k.spentUsd.toFixed(2)} / ${k.spendCapUsd.toFixed(2)} cap · Rate limit:{' '}
                    {k.rateLimitPerMinute}/min · Alert at {k.alertThresholdPct}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid={`vault-rotate-open-${k.keyId}`}
                  onClick={() =>
                    setActiveRotateKeyId(activeRotateKeyId === k.keyId ? null : k.keyId)
                  }
                  className="px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800 text-xs inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Replace</span>
                </button>
                <button
                  type="button"
                  data-testid={`vault-delete-btn-${k.keyId}`}
                  onClick={() => void handleDeleteKey(k.keyId)}
                  className="px-2.5 py-1 rounded-lg border border-stone-700 hover:border-rose-500/40 text-rose-400 text-xs inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {activeRotateKeyId === k.keyId && (
              <div className="pt-2 border-t border-stone-800/60 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="password"
                  placeholder="New API key (masked)"
                  value={rotatePlainInput}
                  onChange={(e) => setRotatePlainInput(e.target.value)}
                  className={`px-3 py-1.5 rounded-lg border text-xs ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                  }`}
                />
                <input
                  type="password"
                  placeholder="Confirm secret code (e.g. 2026)"
                  value={rotateSecretCode}
                  onChange={(e) => setRotateSecretCode(e.target.value)}
                  className={`px-3 py-1.5 rounded-lg border text-xs ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => void handleRotateKey(k.keyId)}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold text-xs"
                >
                  Confirm Rotation
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Masked Key Form */}
      <form
        onSubmit={handleStoreKey}
        className={`p-4 rounded-2xl border space-y-3 ${
          isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/50 border-stone-800'
        }`}
      >
        <div className="font-semibold text-xs flex items-center justify-between">
          <span>Add Key to Vault (Never Revealed After Saving)</span>
          <span className="text-[11px] text-stone-400">AES-256-GCM + Secret Code Wrap</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">Key Label</label>
            <input
              type="text"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">
              API Key (Masked Entry)
            </label>
            <input
              type="password"
              data-testid="vault-new-key-input"
              value={newPlainKeyInput}
              onChange={(e) => setNewPlainKeyInput(e.target.value)}
              placeholder="meta-live-..."
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">
              Secret Code (Required)
            </label>
            <input
              type="password"
              data-testid="vault-secret-code-input"
              value={secretCodeInput}
              onChange={(e) => setSecretCodeInput(e.target.value)}
              placeholder="2026"
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">
              Spend Cap ($ USD)
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={newSpendCapUsd}
              onChange={(e) => setNewSpendCapUsd(Number(e.target.value))}
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">
              Rate Limit (Requests / Min)
            </label>
            <input
              type="number"
              min={1}
              max={300}
              value={newRateLimitPerMin}
              onChange={(e) => setNewRateLimitPerMin(Number(e.target.value))}
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            />
          </div>
          <div>
            <label className="block text-[11px] text-stone-400 mb-1">Vault Backend</label>
            <select
              value={selectedBackend}
              onChange={(e) => setSelectedBackend(e.target.value as VaultBackendKind)}
              className={`w-full px-3 py-1.5 rounded-xl border text-xs ${
                isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
              }`}
            >
              <option value="passphrase_aes_256_gcm">
                PassphraseWrap (AES-256-GCM + Server Host)
              </option>
              <option value="electron_safe_storage">
                ElectronSafeStorage (Native OS Keychain)
              </option>
              <option value="browser_webcrypto_fallback">
                Browser WebCrypto (Lower-Security Preview Fallback)
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 text-[11px] text-stone-400">
            <span>Linux Backend Check:</span>
            <select
              aria-label="Simulated Linux storage backend"
              data-testid="linux-backend-select"
              value={simulatedLinuxBackend}
              onChange={(e) =>
                setSimulatedLinuxBackend(e.target.value as LinuxSafeStorageBackend)
              }
              className="px-2 py-1 rounded bg-stone-900 border border-stone-800 text-stone-200"
            >
              <option value="gnome_libsecret">gnome_libsecret (Encrypted)</option>
              <option value="kwallet6">kwallet6 (Encrypted)</option>
              <option value="basic_text">basic_text (Unencrypted — Refused by Default)</option>
            </select>
            {simulatedLinuxBackend === 'basic_text' && (
              <label className="inline-flex items-center gap-1 text-amber-400">
                <input
                  type="checkbox"
                  checked={allowUnprotectedBasicText}
                  onChange={(e) => setAllowUnprotectedBasicText(e.target.checked)}
                />
                <span>Accept unprotected fallback warning</span>
              </label>
            )}
          </div>

          <button
            type="submit"
            data-testid="vault-save-key-btn"
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Save to Vault</span>
          </button>
        </div>
      </form>

      {/* Collapsible Security & Threat Model Details (docs/security.md) */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowSecurityDetails((v) => !v)}
          className="px-3 py-1.5 rounded-xl border border-stone-800 text-stone-400 hover:text-stone-200 text-xs inline-flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Threat Model &amp; Plugin Handle Details</span>
          {showSecurityDetails ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>

        {showSecurityDetails && (
          <div className="mt-3 p-4 rounded-2xl border border-stone-800 bg-stone-950/70 space-y-2 text-[11px] text-stone-300">
            <div>
              <strong>What Encryption Protects:</strong> Disk theft, accidental bundle/log leaks, and
              other same-user apps reading disk files while locked (protected by PassphraseWrap
              AES-256-GCM).
            </div>
            <div>
              <strong>What Encryption Does Not Protect:</strong> Malware running as your OS user
              while the vault is unlocked can still inspect memory or issue requests. macOS requires
              a code-signed app for Keychain ACL isolation.
            </div>
            <div>
              <strong>Plugin Isolation:</strong> Plugins receive only capability-scoped handles (e.g.{' '}
              <code>cap_secret_plugin_ai_browser_meta-primary</code>) bound to allowlisted domains.
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
