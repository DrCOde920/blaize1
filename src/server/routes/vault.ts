/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vault Management Routes (`src/server/routes/vault.ts`)
 * - Secret-code attempt limiting with exponential backoff and temporary lockout
 * - Execution time normalization to prevent timing-attack side channels
 * - Server-side only rate limits and spend caps (ignores client overrides)
 * - Never returns raw unencrypted keys
 */

import { Router } from 'express';
import { PassphraseWrapVault, redactSecretsFromText } from '../../packages/vault/index';
import { getGlobalDurableDb } from '../../packages/storage/index';
import { getPerLaunchAuthToken } from '../config';
import {
  globalSecretCodeAttemptLimiter,
  normalizeExecutionTiming,
} from '../middleware/lockout';

export function createVaultRouter(vaultInstance?: PassphraseWrapVault): Router {
  const router = Router();
  const serverVault =
    vaultInstance ??
    new PassphraseWrapVault({
      idleTimeoutMs: 5 * 60 * 1000,
      backendKind: 'passphrase_aes_256_gcm',
      durableDb: getGlobalDurableDb(),
    });

  // Vault Status & Masked List Endpoint (Never returns raw keys)
  router.get('/vault/status', (_req, res) => {
    const launchToken = getPerLaunchAuthToken();
    res.status(200).json({
      ok: true,
      locked: serverVault.isLocked(),
      launchTokenPreview: `••••${launchToken.slice(-4)}`,
      keys: serverVault.listMasked(),
    });
  });

  // Store Secret with Lockout Defense & Server-Side Caps Only
  router.post('/vault/store', async (req, res) => {
    const startMs = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    try {
      const { keyId, label, provider, plainKey, secretCode } = req.body || {};
      const code = secretCode ? String(secretCode).trim() : undefined;

      // Server-side caps strictly enforced (client-supplied caps ignored!)
      const serverSpendCapUsd = 10;
      const serverRateLimitPerMinute = 30;

      if (serverVault.isLocked()) {
        if (!code) {
          await normalizeExecutionTiming(startMs, null);
          res.status(400).json({
            ok: false,
            error: 'A secret code is required to encrypt and store a key in the locked vault.',
          });
          return;
        }

        // Check attempt lockout
        const lockout = globalSecretCodeAttemptLimiter.checkLockout(clientIp);
        if (lockout.isLocked) {
          await normalizeExecutionTiming(startMs, null);
          res.status(429).json({
            ok: false,
            error: `Too many failed secret code attempts. Temporary lockout active. Try again in ${lockout.retryAfterSeconds}s.`,
            retryAfterSeconds: lockout.retryAfterSeconds,
            locked: true,
          });
          return;
        }
      }

      const entry = await normalizeExecutionTiming(
        startMs,
        serverVault.store(
          {
            keyId: keyId || `key-${Date.now()}`,
            label: label || 'Custom API Key',
            provider: provider || 'Meta AI',
            plainKey: String(plainKey || ''),
            spendCapUsd: serverSpendCapUsd,
            rateLimitPerMinute: serverRateLimitPerMinute,
          },
          code
        )
      );

      if (code) {
        globalSecretCodeAttemptLimiter.recordSuccess(clientIp);
      }

      res.status(200).json({ ok: true, entry, locked: serverVault.isLocked() });
    } catch (err: any) {
      if (serverVault.isLocked()) {
        globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      }
      await normalizeExecutionTiming(startMs, null);
      res.status(400).json({
        ok: false,
        error: redactSecretsFromText(err?.message || 'Vault store failed.'),
      });
    }
  });

  // Rotate Key
  router.post('/vault/rotate', async (req, res) => {
    const startMs = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const { keyId, newPlainKey, secretCode } = req.body || {};

    const lockout = globalSecretCodeAttemptLimiter.checkLockout(clientIp);
    if (lockout.isLocked) {
      await normalizeExecutionTiming(startMs, null);
      res.status(429).json({
        ok: false,
        error: `Temporary lockout active. Try again in ${lockout.retryAfterSeconds}s.`,
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
      return;
    }

    try {
      const entry = await normalizeExecutionTiming(
        startMs,
        serverVault.rotate(
          String(keyId || ''),
          String(newPlainKey || ''),
          String(secretCode || '')
        )
      );
      globalSecretCodeAttemptLimiter.recordSuccess(clientIp);
      res.status(200).json({ ok: true, entry });
    } catch (err: any) {
      const fail = globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      await normalizeExecutionTiming(startMs, null);
      res.status(403).json({
        ok: false,
        locked: fail.locked,
        retryAfterSeconds: fail.retryAfterSeconds,
        error: redactSecretsFromText(err?.message || 'Vault rotation failed.'),
      });
    }
  });

  // Delete Key
  router.post('/vault/delete', async (req, res) => {
    const startMs = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const { keyId, secretCode } = req.body || {};

    const lockout = globalSecretCodeAttemptLimiter.checkLockout(clientIp);
    if (lockout.isLocked) {
      await normalizeExecutionTiming(startMs, null);
      res.status(429).json({
        ok: false,
        error: `Temporary lockout active. Try again in ${lockout.retryAfterSeconds}s.`,
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
      return;
    }

    try {
      const deleted = await normalizeExecutionTiming(
        startMs,
        serverVault.delete(String(keyId || ''), String(secretCode || ''))
      );
      globalSecretCodeAttemptLimiter.recordSuccess(clientIp);
      res.status(200).json({ ok: deleted, keys: serverVault.listMasked() });
    } catch (err: any) {
      const fail = globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      await normalizeExecutionTiming(startMs, null);
      res.status(403).json({
        ok: false,
        locked: fail.locked,
        retryAfterSeconds: fail.retryAfterSeconds,
        error: redactSecretsFromText(err?.message || 'Vault deletion failed.'),
      });
    }
  });

  // Lock Vault
  router.post('/vault/lock', (_req, res) => {
    serverVault.lock();
    res.status(200).json({ ok: true, locked: serverVault.isLocked() });
  });

  // Unlock Vault with Timing Attack Defense & Exponential Backoff Lockout
  router.post('/vault/unlock', async (req, res) => {
    const startMs = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const secretCode = String(req.body?.secretCode || '');

    // 1. Check if client is currently in lockout
    const lockout = globalSecretCodeAttemptLimiter.checkLockout(clientIp);
    if (lockout.isLocked) {
      await normalizeExecutionTiming(startMs, null);
      res.status(429).json({
        ok: false,
        locked: true,
        retryAfterSeconds: lockout.retryAfterSeconds,
        error: `Too many failed unlock attempts. Temporary lockout active. Try again in ${lockout.retryAfterSeconds} seconds.`,
      });
      return;
    }

    // 2. Perform unlock with normalized constant-time padding
    const unlocked = await normalizeExecutionTiming(startMs, serverVault.unlock(secretCode));

    if (!unlocked) {
      const failure = globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      res.status(403).json({
        ok: false,
        locked: true,
        error: failure.locked
          ? `Invalid secret code. Account locked for ${failure.retryAfterSeconds} seconds.`
          : 'Invalid secret code.',
        retryAfterSeconds: failure.retryAfterSeconds,
      });
      return;
    }

    // 3. Reset failed attempts on success
    globalSecretCodeAttemptLimiter.recordSuccess(clientIp);
    res.status(200).json({
      ok: true,
      locked: false,
      keys: serverVault.listMasked(),
    });
  });

  return router;
}
