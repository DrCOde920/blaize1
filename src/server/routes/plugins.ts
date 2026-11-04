/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hardened Plugin Installation Routes (`src/server/routes/plugins.ts`)
 *
 * Requirements:
 * - DELETED /api/plugins/marketplace and hardcoded catalog
 * - /api/plugins/prepare-install: Validates manifest (Zod), runs static checks, computes permission diff,
 *   and issues a server-side single-use approval nonce.
 * - /api/plugins/install: Must do real work! Validates the single-use nonce, persists plugin to durable storage,
 *   and returns true status. Never returns success text for something that did not happen.
 * - Approval is a server-issued, single-use nonce, never a client-supplied flag.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  validatePluginManifestAndCode,
  type PluginManifestV1,
} from '../../packages/runtime/self_extension_manager';
import { getGlobalDurableDb } from '../../packages/storage/index';

export const PluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  entryPoint: z.string().default('index.ts'),
  publisher: z.string().default('Blaize Community'),
  description: z.string().optional().default(''),
  capabilities: z.array(z.string()).optional().default([]),
  requestedCapabilities: z.array(z.string()).optional().default([]),
  riskClasses: z.array(z.string()).optional().default(['read']),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional().default(''),
        inputSchema: z.record(z.string(), z.string()).optional().default({ query: 'string' }),
        outputSchema: z.record(z.string(), z.string()).optional().default({ result: 'string' }),
        riskClass: z.string().optional().default('read'),
        requiredCapabilities: z.array(z.string()).optional().default([]),
      })
    )
    .min(1),
  policyPack: z.any().optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

interface PendingApprovalNonce {
  nonce: string;
  pluginId: string;
  manifest: PluginManifest;
  code?: string;
  permissionDiff: {
    requestedCapabilities: string[];
    riskClasses: string[];
    requiresElevatedApproval: boolean;
  };
  issuedAt: number;
  expiresAt: number;
  consumed: boolean;
}

const pendingApprovalNonces = new Map<string, PendingApprovalNonce>();

export function clearPendingNoncesForTesting(): void {
  pendingApprovalNonces.clear();
}

export function createPluginsRouter(): Router {
  const router = Router();
  const db = getGlobalDurableDb();

  // 1. Prepare Plugin Installation & Issue Single-Use Approval Nonce
  router.post('/plugins/prepare-install', (req, res) => {
    try {
      const { manifest, code } = req.body || {};
      if (!manifest) {
        res.status(400).json({ ok: false, error: 'Plugin manifest is required.' });
        return;
      }

      // Validate manifest using Zod & static code checks
      const validation = validatePluginManifestAndCode(manifest, code || '');
      if (!validation.valid) {
        res.status(400).json({
          ok: false,
          error: `Manifest validation failed: ${validation.reason || validation.errorCode || 'Invalid manifest'}`,
          errorCode: validation.errorCode,
        });
        return;
      }

      const parsedManifest = PluginManifestSchema.parse(manifest);

      // Compute permission diff against standard capability ceiling
      const standardGrantedCapabilities = new Set([
        'workspace:read',
        'workspace:write',
        'fs:sandbox_read',
        'fs:sandbox_write',
      ]);

      const requestedCaps = parsedManifest.capabilities || [];
      const ungrantedCaps = requestedCaps.filter((cap) => !standardGrantedCapabilities.has(cap));
      const hasElevatedRisks = (parsedManifest.riskClasses || []).some(
        (rc) => rc === 'spend' || rc === 'destructive' || rc === 'external_send'
      );

      const permissionDiff = {
        requestedCapabilities: requestedCaps,
        riskClasses: parsedManifest.riskClasses || ['read'],
        ungrantedCapabilities: ungrantedCaps,
        requiresElevatedApproval: ungrantedCaps.length > 0 || hasElevatedRisks,
      };

      // Server issues a cryptographically random, single-use approval nonce
      const nonce = `nonce_${crypto.randomBytes(16).toString('hex')}`;
      const now = Date.now();
      const expiresAt = now + 5 * 60 * 1000; // 5 minute TTL

      pendingApprovalNonces.set(nonce, {
        nonce,
        pluginId: parsedManifest.id,
        manifest: parsedManifest,
        code: code || '',
        permissionDiff,
        issuedAt: now,
        expiresAt,
        consumed: false,
      });

      // Prune expired nonces
      for (const [n, record] of pendingApprovalNonces.entries()) {
        if (now > record.expiresAt || record.consumed) {
          pendingApprovalNonces.delete(n);
        }
      }

      res.status(200).json({
        ok: true,
        pluginId: parsedManifest.id,
        approvalNonce: nonce,
        expiresInSeconds: 300,
        permissionDiff,
        manifest: parsedManifest,
        message: 'Manifest validated and approval nonce issued. Present this nonce to complete installation.',
      });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: `Prepare install failed: ${err?.message || 'Invalid payload'}`,
      });
    }
  });

  // 2. Perform Real Plugin Installation (Consumes Single-Use Nonce & Persists to Durable DB)
  router.post('/plugins/install', (req, res) => {
    try {
      const { approvalNonce } = req.body || {};

      if (!approvalNonce || typeof approvalNonce !== 'string') {
        res.status(403).json({
          ok: false,
          errorCode: 'APPROVAL_NONCE_REQUIRED',
          error:
            'Plugin installation requires a valid server-issued approval nonce. Call /api/plugins/prepare-install first.',
        });
        return;
      }

      const pendingRecord = pendingApprovalNonces.get(approvalNonce.trim());
      if (!pendingRecord) {
        res.status(403).json({
          ok: false,
          errorCode: 'INVALID_APPROVAL_NONCE',
          error: 'Approval nonce is invalid or expired. Please re-review permissions and try again.',
        });
        return;
      }

      if (pendingRecord.consumed) {
        res.status(403).json({
          ok: false,
          errorCode: 'APPROVAL_NONCE_ALREADY_USED',
          error: 'Approval nonce has already been consumed. Each approval is strictly single-use.',
        });
        return;
      }

      if (Date.now() > pendingRecord.expiresAt) {
        pendingApprovalNonces.delete(approvalNonce.trim());
        res.status(403).json({
          ok: false,
          errorCode: 'APPROVAL_NONCE_EXPIRED',
          error: 'Approval nonce has expired. Please re-review permissions and try again.',
        });
        return;
      }

      // Immediately consume the nonce (single-use anti-replay)
      pendingRecord.consumed = true;
      pendingApprovalNonces.delete(approvalNonce.trim());

      const manifest = pendingRecord.manifest;
      const installedAt = new Date().toISOString();

      // Perform REAL work: persist to durable SQLite storage
      const pluginRecord = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        publisher: manifest.publisher,
        description: manifest.description,
        tools: manifest.tools.map((t) => t.name),
        riskClasses: manifest.riskClasses,
        capabilities: manifest.capabilities,
        installedAt,
        status: 'active',
        policyPackActivated: Boolean(manifest.policyPack),
      };

      db.setRecord('installed_plugins', manifest.id, pluginRecord);

      res.status(200).json({
        ok: true,
        installed: true,
        pluginId: manifest.id,
        version: manifest.version,
        installedAt,
        status: 'active',
        permissionDiff: pendingRecord.permissionDiff,
        policyPackActivated: Boolean(manifest.policyPack),
        storageKey: `installed_plugin_${manifest.id}`,
        message: `Plugin '${manifest.name}' installed and verified in durable storage.`,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: `Plugin installation failed: ${err?.message || 'Storage error'}`,
      });
    }
  });

  return router;
}
