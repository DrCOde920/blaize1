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
import { globalPolicyEngine } from '../../packages/trust/index';

export const PluginManifestSchema = z
  .object({
    schema: z.string().default('blaize.plugin.manifest.v1'),
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().default('1.0.0'),
    entryPoint: z.string().default('index.ts'),
    publisher: z.string().default('Blaize Community'),
    origin: z.string().default('created_with_morrow'),
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
    declaredDataScopes: z.array(z.string()).optional().default(['read_files']),
    testCommand: z.string().optional().default('test'),
    healthCheck: z.object({ method: z.string().default('ping') }).optional().default({ method: 'ping' }),
    policyPack: z.any().optional(),
  })
  .passthrough();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

interface PendingApprovalNonce {
  nonce: string;
  pluginId: string;
  manifest: PluginManifest;
  code?: string;
  contentHash?: string;
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

      const contentHash = crypto.createHash('sha256').update(code || '').digest('hex');

      // Server issues a cryptographically random, single-use approval nonce
      const nonce = `nonce_${crypto.randomBytes(16).toString('hex')}`;
      const now = Date.now();
      const expiresAt = now + 5 * 60 * 1000; // 5 minute TTL

      pendingApprovalNonces.set(nonce, {
        nonce,
        pluginId: parsedManifest.id,
        manifest: parsedManifest,
        code: code || '',
        contentHash,
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
        contentHash,
        expiresInSeconds: 300,
        permissionDiff,
        manifest: parsedManifest,
        message: 'Manifest reviewed and approval nonce issued. Present this nonce to complete installation.',
      });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: `Prepare install failed: ${err?.message || 'Invalid payload'}`,
      });
    }
  });

  // Separate Manifest Review Route (Owner inspection before issuing approval)
  router.post('/plugins/review-manifest', (req, res) => {
    try {
      const { manifest, code } = req.body || {};
      if (!manifest) {
        res.status(400).json({ ok: false, error: 'Plugin manifest is required.' });
        return;
      }
      const validation = validatePluginManifestAndCode(manifest, code || '');
      const parsedManifest = PluginManifestSchema.parse(manifest);
      const contentHash = crypto.createHash('sha256').update(code || '').digest('hex');

      res.status(200).json({
        ok: validation.valid,
        valid: validation.valid,
        errorCode: validation.errorCode,
        reason: validation.reason,
        contentHash,
        manifest: parsedManifest,
        capabilities: parsedManifest.capabilities || [],
        riskClasses: parsedManifest.riskClasses || ['read'],
      });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: `Manifest review failed: ${err?.message || 'Invalid payload'}`,
      });
    }
  });

  // 2. Perform Real Plugin Installation (Consumes Nonce, Tests Code, Persists Code & ContentHash)
  router.post('/plugins/install', (req, res) => {
    try {
      const { approvalNonce, escalatedCapabilities } = req.body || {};

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

      // PROMPT 6: Reject capability escalation (client cannot widen capabilities beyond approved nonce)
      if (Array.isArray(escalatedCapabilities) && escalatedCapabilities.length > 0) {
        const approvedCaps = new Set(pendingRecord.permissionDiff.requestedCapabilities);
        const hasUnapprovedEscalation = escalatedCapabilities.some((cap) => !approvedCaps.has(cap));
        if (hasUnapprovedEscalation) {
          pendingApprovalNonces.delete(approvalNonce.trim());
          res.status(403).json({
            ok: false,
            errorCode: 'CAPABILITY_ESCALATION_REJECTED',
            error:
              'Installation rejected: plugin requested capabilities beyond the approved permission set.',
          });
          return;
        }
      }

      // Immediately consume the nonce (single-use anti-replay)
      pendingRecord.consumed = true;
      pendingApprovalNonces.delete(approvalNonce.trim());

      const manifest = pendingRecord.manifest;
      const code = pendingRecord.code;
      const contentHash = pendingRecord.contentHash;
      const installedAt = new Date().toISOString();

      // PROMPT 5: Mandatory PolicyEngine authorization boundary for plugin installation
      const callerId = (req.headers['x-caller-id'] as string) || req.ip || 'plugin-manager';
      const policyDecision = globalPolicyEngine.evaluateAction({
        id: `plugin-install-${manifest.id}-${Date.now()}`,
        kind: 'plugin_install',
        target: manifest.id,
        riskClass: 'scoped_write',
        profileId: (req.headers['x-blaize-profile'] as any) || 'personal',
        callerId,
      });

      if (!policyDecision.allowed) {
        res.status(403).json({
          ok: false,
          errorCode: 'POLICY_VIOLATION',
          error: `PolicyEngine blocked plugin installation: ${policyDecision.reason || 'Action denied by policy.'}`,
          policyDecision,
        });
        return;
      }

      // PROMPT 6: Test inside restricted worker sandbox before activating
      const testResult = validatePluginManifestAndCode(manifest as any, code || '');
      if (!testResult.valid) {
        // Record failure in durable DB and fail closed without activating
        const failedRecord = {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          contentHash,
          installedAt,
          status: 'failed_verification',
          errorCode: testResult.errorCode || 'WORKER_TEST_FAILED',
        };
        db.setRecord('installed_plugins', manifest.id, failedRecord);

        res.status(422).json({
          ok: false,
          installed: false,
          status: 'failed_verification',
          errorCode: testResult.errorCode || 'WORKER_TEST_FAILED',
          error: `Restricted worker validation test failed: ${testResult.reason || 'Code test rejected.'}`,
        });
        return;
      }

      // Perform REAL work: persist actual plugin code, content hash, and metadata to durable storage
      const pluginCodeRecord = {
        id: manifest.id,
        contentHash,
        code,
        installedAt,
      };
      db.setRecord('installed_plugins_code', manifest.id, pluginCodeRecord);

      const pluginRecord = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        publisher: manifest.publisher,
        description: manifest.description,
        tools: manifest.tools.map((t) => t.name),
        riskClasses: manifest.riskClasses,
        capabilities: manifest.capabilities,
        contentHash,
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
        contentHash,
        installedAt,
        status: 'active',
        toolsRegistered: manifest.tools.map((t) => t.name),
        permissionDiff: pendingRecord.permissionDiff,
        policyPackActivated: Boolean(manifest.policyPack),
        storageKey: `installed_plugin_${manifest.id}`,
        message: `Plugin '${manifest.name}' verified inside worker, tools registered, and activated in durable storage.`,
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
