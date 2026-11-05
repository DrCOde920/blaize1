/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Tests for Real Cryptography, Durable Ledger, and Identity Security (`src/packages/trust/durable_security.test.ts`)
 * Addresses PROMPT 3 requirements:
 * 1. Real SHA-256, HMAC, and authenticated AES-256-GCM (random 12-byte IV, 16-byte auth tag)
 * 2. Versioned canonical ledger serialization binding 11 fields
 * 3. Tamper detection on ledger chain and ciphertext corruption rejection
 * 4. Durable SQLite backing across process restart simulation
 * 5. Linux safeStorage basic_text rejection and fail-closed security
 * 6. Scrypt KDF with per-user salt and versioned parameters
 * 7. Default secret code 2026 removal and fresh onboardingCompleted: false state
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as nodeCrypto from 'node:crypto';
import {
  computeCryptographicSha256,
  computeCryptographicHmacSha256,
  encryptPayloadAesGcm,
  decryptPayloadAesGcm,
  derivePassphraseKeyScrypt,
  verifyTimingSafe,
} from './crypto';
import {
  serializeCanonicalLedgerRecord,
  computeCanonicalLedgerHash,
  validateCanonicalLedgerFields,
  verifyLedgerEventChainLink,
  CANONICAL_LEDGER_SCHEMA_VERSION,
  GENESIS_PREVIOUS_HASH,
} from './canonical_ledger';
import { MemoryLedger } from './index';
import { DurableSqliteDatabase } from '../storage/sqlite_db';
import {
  deriveSecretCodePBKDF2,
  deriveSecretCodeScrypt,
  verifySecretCodePBKDF2,
  buildDefaultPersistedSnapshot,
  buildDemoPersistedSnapshot,
} from '../runtime';
import {
  PassphraseWrapVault,
  verifySafeStorageBackend,
  type ElectronSafeStorageBridge,
} from '../vault';

describe('PROMPT 3: Real Cryptography, Canonical Ledger & Durable Storage', () => {
  it('real SHA-256 and HMAC-SHA-256 match standard cryptographic vectors', () => {
    // Known test vector for empty string SHA-256
    const emptySha256 = computeCryptographicSha256('');
    assert.strictEqual(
      emptySha256,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );

    // Known test vector for "The quick brown fox jumps over the lazy dog"
    const foxSha256 = computeCryptographicSha256('The quick brown fox jumps over the lazy dog');
    assert.strictEqual(
      foxSha256,
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
    );

    // HMAC test vector
    const hmac = computeCryptographicHmacSha256('secret-key', 'data-payload');
    const nodeNativeHmac = nodeCrypto.createHmac('sha256', 'secret-key').update('data-payload').digest('hex');
    assert.strictEqual(hmac, nodeNativeHmac);

    // Timing-safe comparison
    assert.strictEqual(verifyTimingSafe('abcdef123456', 'abcdef123456'), true);
    assert.strictEqual(verifyTimingSafe('abcdef123456', 'abcdef123457'), false);
  });

  it('authenticated AES-256-GCM: uses 12-byte nonce, 16-byte tag, and fails on tampering or corruption', () => {
    const key = nodeCrypto.randomBytes(32);
    const plainText = JSON.stringify({ account: '123456', transferAmount: 5000, recipient: 'Alice' });

    const envelope = encryptPayloadAesGcm(plainText, key);
    assert.strictEqual(envelope.algorithm, 'aes-256-gcm');
    assert.strictEqual(Buffer.from(envelope.ivHex, 'hex').length, 12, 'IV must be 12 bytes');
    assert.strictEqual(Buffer.from(envelope.authTagHex, 'hex').length, 16, 'Auth tag must be 16 bytes');

    // Clean decryption succeeds
    const decrypted = decryptPayloadAesGcm(envelope, key);
    assert.strictEqual(decrypted, plainText);

    // Decryption with wrong key fails closed
    const wrongKey = nodeCrypto.randomBytes(32);
    assert.throws(() => decryptPayloadAesGcm(envelope, wrongKey), /Decryption failed/);

    // Corrupted ciphertext fails authentication tag verification
    const corruptedCiphertext = {
      ...envelope,
      ciphertextHex: envelope.ciphertextHex.slice(0, -2) + (envelope.ciphertextHex.slice(-2) === 'ff' ? '00' : 'ff'),
    };
    assert.throws(() => decryptPayloadAesGcm(corruptedCiphertext, key), /Decryption failed/);

    // Corrupted authentication tag fails
    const corruptedTag = {
      ...envelope,
      authTagHex: '00'.repeat(16),
    };
    assert.throws(() => decryptPayloadAesGcm(corruptedTag, key), /Decryption failed/);

    // Mutated IV fails
    const mutatedIv = {
      ...envelope,
      ivHex: 'ff'.repeat(12),
    };
    assert.throws(() => decryptPayloadAesGcm(mutatedIv, key), /Decryption failed/);
  });

  it('canonical ledger serialization binds all 11 required fields and detects tampering', () => {
    const fields = {
      sequence: 0,
      timestamp: '2026-11-02T03:00:00.000Z',
      actor: 'operator',
      eventType: 'rule_established',
      mission: 'mission-bootstrap',
      profileWorkspace: 'ws-prod',
      redactedSummary: 'Standing Rule confirmed.',
      payloadReference: 'slot_8a7b6c5d4e3f2a1b',
      payloadDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      previousHash: GENESIS_PREVIOUS_HASH,
      schemaVersion: CANONICAL_LEDGER_SCHEMA_VERSION,
    };

    const validation = validateCanonicalLedgerFields(fields);
    assert.strictEqual(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);

    const serialized = serializeCanonicalLedgerRecord(fields);
    assert.ok(serialized.includes('"schemaVersion":2'));
    assert.ok(serialized.includes('"sequence":0'));
    assert.ok(serialized.includes('"payloadDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"'));

    const ownHash = computeCanonicalLedgerHash(fields);
    assert.strictEqual(ownHash.length, 64, 'Computed hash must be 64-char SHA-256');

    // Chain link validation
    const linkCheck = verifyLedgerEventChainLink(fields, ownHash);
    assert.strictEqual(linkCheck.valid, true);

    // Tampering with summary changes recomputed hash and breaks link
    const tamperedFields = {
      ...fields,
      redactedSummary: 'Tampered summary by attacker',
    };
    const tamperedCheck = verifyLedgerEventChainLink(tamperedFields, ownHash);
    assert.strictEqual(tamperedCheck.valid, false);
    assert.ok(tamperedCheck.reason?.includes('Hash mismatch'));
  });

  it('MemoryLedger with durable SQLite backend survives restart and verifies 100% valid cryptographic chain', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-ledger-durable-'));
    const dbPath = path.join(tmpDir, 'ledger.sqlite');
    const masterKey = nodeCrypto.randomBytes(32);

    try {
      // Phase 1: create database and append events to ledger
      const db1 = new DurableSqliteDatabase(dbPath);
      const ledger1 = new MemoryLedger(false, db1, masterKey);

      ledger1.appendEvent({
        actor: 'guard',
        type: 'mission_started',
        summary: 'Boot event 1: PolicyGuard active.',
        payload: JSON.stringify({ mode: 'strict', rules: 5 }),
        trustLevel: 'verified_by_evidence',
        missionId: 'm-1',
      });

      ledger1.appendEvent({
        actor: 'operator',
        type: 'user_approved',
        summary: 'Operator confirmed financial limit.',
        payload: JSON.stringify({ maxTransferUsd: 1000 }),
        trustLevel: 'user_stated',
        missionId: 'm-1',
      });

      const report1 = ledger1.verifyChain();
      assert.strictEqual(report1.valid, true);
      assert.strictEqual(report1.totalEvents, 2);

      // Close DB connection 1
      db1.close();

      // Phase 2: process restart simulation — open DB 2 and initialize new MemoryLedger
      const db2 = new DurableSqliteDatabase(dbPath);
      const ledger2 = new MemoryLedger(false, db2, masterKey);

      // Verify chain was recovered from SQLite and is cryptographically sound
      const report2 = ledger2.verifyChain();
      assert.strictEqual(report2.valid, true, `Chain must verify after restart: ${report2.brokenReason}`);
      assert.strictEqual(report2.totalEvents, 2);

      // Explain event 1 and verify real AES-GCM decrypted preview matches original payload
      const explained = ledger2.explain(ledger2['events'][0].id);
      assert.ok(explained.decryptedPreview.includes('"mode":"strict"'), 'Payload must be decryptable with master key');

      // Right-to-delete test on durable store
      const deleteRes = ledger2.deleteContent(ledger2['events'][0].contentRef);
      assert.strictEqual(deleteRes.deleted, true);

      // Chain remains 100% valid after deletion
      const report3 = ledger2.verifyChain();
      assert.strictEqual(report3.valid, true, 'Chain must remain valid after payload deletion');

      db2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Linux safeStorage basic_text rejection: fails closed unless explicitly accepted with warning', async () => {
    const unencryptedLinuxBridge: ElectronSafeStorageBridge = {
      platform: 'linux',
      getSelectedStorageBackend: async () => 'basic_text',
      isEncryptionAvailable: async () => true,
      encryptString: async (p) => p,
      decryptString: async (c) => c,
    };

    // Unprotected basic_text without override is strictly refused
    const check1 = await verifySafeStorageBackend(unencryptedLinuxBridge, {
      allowUnprotectedBasicTextFallback: false,
    });
    assert.strictEqual(check1.allowed, false);
    assert.ok(check1.error?.includes('Refused to store key: Linux safeStorage backend is "basic_text"'));

    // PassphraseWrapVault with basic_text bridge throws when storing secret
    const vault = new PassphraseWrapVault({
      linuxBridge: unencryptedLinuxBridge,
      allowBasicTextFallback: false,
    });
    await assert.rejects(
      async () => {
        await vault.store(
          {
            keyId: 'k-linux-fail',
            label: 'Test Key',
            provider: 'OpenAI',
            plainKey: 'sk-abcdef1234567890',
          },
          'secure_passphrase_1234'
        );
      },
      /Refused to store key: Linux safeStorage backend is "basic_text"/
    );

    // When explicitly overridden by user, it is allowed with a warning
    const check2 = await verifySafeStorageBackend(unencryptedLinuxBridge, {
      allowUnprotectedBasicTextFallback: true,
    });
    assert.strictEqual(check2.allowed, true);
    assert.ok(check2.warning?.includes('WARNING: Using unprotected Linux basic_text fallback'));
  });

  it('scrypt KDF: versioned parameters, per-user salt, wrong passphrase rejection, and timing-safe check', () => {
    const passphrase = 'user_super_secure_vault_code';
    const digest = deriveSecretCodeScrypt(passphrase);

    assert.strictEqual(digest.algorithm, 'scrypt-v1');
    assert.ok(digest.saltHex.length >= 16, 'Per-user salt must be at least 8 bytes (16 hex chars)');
    assert.strictEqual(digest.params?.N, 16384);
    assert.strictEqual(digest.params?.r, 8);
    assert.strictEqual(digest.params?.p, 1);

    // Correct passphrase passes timing-safe verification
    assert.strictEqual(verifySecretCodePBKDF2(passphrase, digest), true);

    // Wrong passphrase strictly fails
    assert.strictEqual(verifySecretCodePBKDF2('wrong_passphrase', digest), false);
    assert.strictEqual(verifySecretCodePBKDF2('2026', digest), false);
  });

  it('fresh install starts onboarding incomplete and removes default 2026 secret code', () => {
    const defaultSnapshot = buildDefaultPersistedSnapshot();

    // Fresh install invariants
    assert.strictEqual(defaultSnapshot.onboardingCompleted, false, 'Fresh install must start onboarding incomplete');
    assert.strictEqual(defaultSnapshot.secretCodeDigest, undefined, 'Fresh install must not have a pre-seeded default secret code');
    assert.strictEqual(defaultSnapshot.biometricSimulatedEnabled, false, 'Fresh install must not claim biometric authentication');
    assert.strictEqual(defaultSnapshot.isDemo, false, 'Fresh install must start as production identity, not demo');

    // Demo snapshot is isolated
    const demoSnapshot = buildDemoPersistedSnapshot();
    assert.strictEqual(demoSnapshot.isDemo, true);
    assert.strictEqual(demoSnapshot.onboardingCompleted, true);
    assert.ok(demoSnapshot.secretCodeDigest !== undefined);
  });
});
