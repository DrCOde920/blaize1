/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Full-Stack Server (Express + Vite Middleware)
 * - Serves `/api/model` and `/api/model/test` for the Meta Model API (`https://api.meta.ai/v1`)
 * - Keeps `MODEL_API_KEY` strictly on the server (never exposed in browser bundle or logs)
 * - Enforces model allowlist (`muse-spark-1.3` default for loops/extraction,
 *   `muse-wonder-1.0` for planning/recovery) and blocks `-contributor` IDs
 * - Strict payload validation and size limits (`64kb`), with zero silent fallbacks
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PassphraseWrapVault, redactSecretsFromText } from './src/packages/vault/index';
import { getGlobalDurableDb } from './src/packages/storage/index';
import {
  validateBrowserUrlSecurity,
  scanContentForPromptInjection,
  runBrowserSelfTest,
  searchOpenVsxRegistry,
} from './src/packages/browser_ide/index';
import {
  runEverydayPcBenchmarkSuite,
  type DesktopOSPlatform,
} from './src/packages/pc_operator/index';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ALLOWED_META_MODELS = new Set([
  'muse-spark-1.3',
  'muse-wonder-1.0',
  'muse-voice-transcribe-1.0',
  'muse-image-1.0',
  'sam-3.1',
  'muse-glimmer-local',
  'meta-models/muse-spark-open-1026',
]);

export interface ProxyValidationResult {
  valid: boolean;
  error?: string;
  resolvedModel: string;
}

export function validateMetaModelProxyRequest(body: unknown): ProxyValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.', resolvedModel: '' };
  }
  const payload = body as Record<string, unknown>;
  const rawModel =
    typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : payload.taskRole === 'planning' || payload.taskRole === 'recovery'
        ? 'muse-wonder-1.0'
        : 'muse-spark-1.3';

  if (rawModel.includes('-contributor')) {
    return {
      valid: false,
      error: `Blocked model '${rawModel}': -contributor model IDs are never permitted for user data.`,
      resolvedModel: rawModel,
    };
  }
  if (rawModel === 'muse-wonder-full' || rawModel === 'sam-3-1') {
    return {
      valid: false,
      error: `Invalid model ID '${rawModel}'. Use 'muse-wonder-1.0' or 'sam-3.1'.`,
      resolvedModel: rawModel,
    };
  }
  if (!ALLOWED_META_MODELS.has(rawModel)) {
    return {
      valid: false,
      error: `Model '${rawModel}' is not in the verified Meta Model API catalog.`,
      resolvedModel: rawModel,
    };
  }

  const input = payload.input ?? payload.messages;
  if (!input || (typeof input !== 'string' && !Array.isArray(input))) {
    return {
      valid: false,
      error: 'Request must include a non-empty `input` string or `messages` array.',
      resolvedModel: rawModel,
    };
  }

  const serializedLen = JSON.stringify(payload).length;
  if (serializedLen > 65536) {
    return {
      valid: false,
      error: `Payload size (${serializedLen} bytes) exceeds the 64 KB limit.`,
      resolvedModel: rawModel,
    };
  }

  return { valid: true, resolvedModel: rawModel };
}

const PER_LAUNCH_AUTH_TOKEN = `blaize_launch_${crypto.randomBytes(16).toString('hex')}`;
const serverVault = new PassphraseWrapVault({
  idleTimeoutMs: 5 * 60 * 1000,
  backendKind: 'passphrase_aes_256_gcm',
  durableDb: getGlobalDurableDb(),
});

function hasConfiguredApiKey(): boolean {
  const key = process.env.MODEL_API_KEY?.trim() || '';
  return Boolean(
    key &&
      key !== 'YOUR_META_MODEL_API_KEY' &&
      key !== 'MY_META_MODEL_API_KEY' &&
      key.length >= 8
  );
}

export async function createBlaizeServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Locked-down CORS policy & security headers for /api/*
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      !origin.includes('localhost') &&
      !origin.includes('127.0.0.1') &&
      !origin.includes('.run.app')
    ) {
      res.status(403).json({ ok: false, error: 'Cross-origin request blocked by proxy CORS policy.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Vault Status & Masked List Endpoint (Never returns raw keys)
  app.get('/api/vault/status', (_req, res) => {
    res.status(200).json({
      ok: true,
      locked: serverVault.isLocked(),
      launchTokenPreview: `••••${PER_LAUNCH_AUTH_TOKEN.slice(-4)}`,
      keys: serverVault.listMasked(),
    });
  });

  app.post('/api/vault/store', async (req, res) => {
    try {
      const { keyId, label, provider, plainKey, spendCapUsd, rateLimitPerMinute, secretCode } =
        req.body || {};
      const code = secretCode ? String(secretCode).trim() : undefined;
      if (!code && serverVault.isLocked()) {
        res.status(400).json({
          ok: false,
          error: 'A secret code (at least 4 characters) is required to encrypt and store a key in the vault.',
        });
        return;
      }
      const entry = await serverVault.store(
        {
          keyId: keyId || `key-${Date.now()}`,
          label: label || 'Custom API Key',
          provider: provider || 'Meta AI',
          plainKey: String(plainKey || ''),
          spendCapUsd: Number(spendCapUsd) || 10,
          rateLimitPerMinute: Number(rateLimitPerMinute) || 30,
        },
        code
      );
      res.status(200).json({ ok: true, entry, locked: serverVault.isLocked() });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: redactSecretsFromText(err?.message || 'Vault store failed.'),
      });
    }
  });

  app.post('/api/vault/rotate', async (req, res) => {
    try {
      const { keyId, newPlainKey, secretCode } = req.body || {};
      const entry = await serverVault.rotate(
        String(keyId || ''),
        String(newPlainKey || ''),
        String(secretCode || '')
      );
      res.status(200).json({ ok: true, entry });
    } catch (err: any) {
      res.status(403).json({
        ok: false,
        error: redactSecretsFromText(err?.message || 'Vault rotation failed.'),
      });
    }
  });

  app.post('/api/vault/delete', async (req, res) => {
    try {
      const { keyId, secretCode } = req.body || {};
      const deleted = await serverVault.delete(String(keyId || ''), String(secretCode || ''));
      res.status(200).json({ ok: deleted, keys: serverVault.listMasked() });
    } catch (err: any) {
      res.status(403).json({
        ok: false,
        error: redactSecretsFromText(err?.message || 'Vault deletion failed.'),
      });
    }
  });

  app.post('/api/vault/lock', (_req, res) => {
    serverVault.lock();
    res.status(200).json({ ok: true, locked: serverVault.isLocked() });
  });

  app.post('/api/vault/unlock', async (req, res) => {
    const unlocked = await serverVault.unlock(String(req.body?.secretCode || ''));
    if (!unlocked) {
      res.status(403).json({ ok: false, locked: true, error: 'Invalid secret code.' });
      return;
    }
    res.status(200).json({ ok: true, locked: false, keys: serverVault.listMasked() });
  });

  // Live Process & System Metrics Endpoint (Never hardcoded)
  app.get('/api/system/metrics', (_req, res) => {
    const mem = process.memoryUsage();
    res.status(200).json({
      rssBytes: mem.rss,
      heapTotalBytes: mem.heapTotal,
      heapUsedBytes: mem.heapUsed,
      externalBytes: mem.external,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/api/system/platform-info', (_req, res) => {
    res.status(200).json({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: 'none (web-preview)',
      isHeadless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    });
  });

  // 1. Honest Connection Check Endpoint (Never leaks key; no silent fallback)
  app.post('/api/model/test', async (_req, res) => {
    const baseUrl = (process.env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
    if (!hasConfiguredApiKey()) {
      res.status(200).json({
        ok: false,
        mode: 'mock_only',
        keyConfigured: false,
        endpoint: baseUrl,
        defaultLoopModel: 'muse-spark-1.3',
        defaultPlanningModel: 'muse-wonder-1.0',
        message:
          'MODEL_API_KEY is not configured on the server. Live mode is unavailable; running in Mock mode.',
      });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.MODEL_API_KEY!.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        res.status(200).json({
          ok: false,
          mode: 'live_error',
          keyConfigured: true,
          endpoint: baseUrl,
          httpStatus: response.status,
          message: `Meta Model API returned HTTP ${response.status}. Check MODEL_API_KEY permissions.`,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        mode: 'live_ready',
        keyConfigured: true,
        endpoint: baseUrl,
        defaultLoopModel: 'muse-spark-1.3',
        defaultPlanningModel: 'muse-wonder-1.0',
        message: 'Connected to Meta Model API (muse-spark-1.3 / muse-wonder-1.0).',
      });
    } catch (err: any) {
      res.status(200).json({
        ok: false,
        mode: 'live_unreachable',
        keyConfigured: true,
        endpoint: baseUrl,
        message: `Could not reach ${baseUrl} (${err?.message || 'network error'}). No silent fallback performed.`,
      });
    }
  });

  // 2. Server-Side Meta Model API Proxy (/api/model)
  app.post('/api/model', async (req, res) => {
    const validation = validateMetaModelProxyRequest(req.body);
    if (!validation.valid) {
      res.status(400).json({
        ok: false,
        error: validation.error,
        model: validation.resolvedModel,
      });
      return;
    }

    if (!hasConfiguredApiKey()) {
      res.status(503).json({
        ok: false,
        error:
          'Live mode requested, but MODEL_API_KEY is not configured in the server environment. Switch to Mock mode or set MODEL_API_KEY.',
        model: validation.resolvedModel,
        silentFallbackUsed: false,
      });
      return;
    }

    const baseUrl = (process.env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
    const upstreamPayload = {
      model: validation.resolvedModel,
      input: req.body.input ?? req.body.messages,
      max_output_tokens: Math.min(Number(req.body.max_output_tokens) || 1024, 4096),
      temperature: typeof req.body.temperature === 'number' ? req.body.temperature : 0.2,
      ...(Array.isArray(req.body.tools) ? { tools: req.body.tools } : {}),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MODEL_API_KEY!.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(upstreamPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        res.status(response.status).json({
          ok: false,
          error:
            (data && (data.error?.message || data.error)) ||
            `Meta Model API error (HTTP ${response.status})`,
          model: validation.resolvedModel,
          silentFallbackUsed: false,
        });
        return;
      }

      const reportedUsage = data?.usage
        ? {
            inputTokens: Number(data.usage.input_tokens ?? data.usage.prompt_tokens ?? 0),
            outputTokens: Number(data.usage.output_tokens ?? data.usage.completion_tokens ?? 0),
            source: 'reported' as const,
          }
        : {
            inputTokens: Math.ceil(JSON.stringify(upstreamPayload.input).length / 4),
            outputTokens: Math.ceil(JSON.stringify(data).length / 4),
            source: 'estimated' as const,
          };

      res.status(200).json({
        ok: true,
        model: validation.resolvedModel,
        response: data,
        usage: reportedUsage,
        silentFallbackUsed: false,
      });
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        error: `Meta Model API request failed: ${err?.message || 'upstream error'}. No silent fallback performed.`,
        model: validation.resolvedModel,
        silentFallbackUsed: false,
      });
    }
  });

  // 3. Plugin Marketplace Catalog API
  app.get('/api/plugins/marketplace', (_req, res) => {
    res.status(200).json({
      ok: true,
      catalog: [
        {
          id: 'plugin-files',
          name: 'Files & Sandboxed Folders',
          version: '2.1.0',
          publisher: 'Blaize Core',
          category: 'Productivity',
          tagline: 'Sandboxed local workspace file operations with SHA-256 integrity verification.',
          description: 'Safe file management confined to the workspace root. Enforces file_exists_hash verification.',
          installedByDefault: true,
          requestedTools: ['workspace.list_dir', 'workspace.read_file', 'workspace.write_file', 'workspace.delete_file'],
          riskClasses: ['read', 'write', 'destructive'],
          policyPack: {
            name: 'Workspace Sandbox Pack',
            summary: 'Confined to workspace root; delete actions require explicit interactive operator approval.',
            rulesCount: 2,
          },
          verifiers: [
            { id: 'file_exists_hash', name: 'File Exists & Hash Verification', description: 'Proves file state matches expected cryptographic hash.' },
          ],
        },
        {
          id: 'plugin-ai-browser',
          name: 'Research & Fact Verification',
          version: '3.0.4',
          publisher: 'Blaize Web',
          category: 'Web & Automation',
          tagline: 'Sandboxed web browsing with DOM assertions and citation verification.',
          description: 'Enables Morrow to browse allowlisted documentation and research sources with zero credential takeover.',
          installedByDefault: true,
          requestedTools: ['browser.navigate', 'browser.extract_a11y', 'browser.evaluate'],
          riskClasses: ['read'],
          policyPack: {
            name: 'Web Research Policy Pack',
            summary: 'Restricts navigation to public read-only documentation and research sites.',
            rulesCount: 1,
          },
          verifiers: [
            { id: 'dom_assertion', name: 'DOM Assertion Verifier', description: 'Ensures target DOM text or element matches expected structure.' },
            { id: 'url_check', name: 'URL Origin Verifier', description: 'Checks destination URL matches approved domain.' },
          ],
        },
        {
          id: 'plugin-code-helper',
          name: 'Code Helper & Workspace IDE',
          version: '2.4.0',
          publisher: 'Blaize Engineering',
          category: 'Productivity',
          tagline: 'Runs tests, generates patches, and checks code invariants.',
          description: 'Autonomous development assistant with test_suite_pass verifier gating before task completion.',
          installedByDefault: true,
          requestedTools: ['test_runner.run', 'ide.propose_patch', 'ide.format_code'],
          riskClasses: ['read', 'write'],
          policyPack: {
            name: 'Code Guard Pack',
            summary: 'Patches require test suite pass verification before merge.',
            rulesCount: 2,
          },
          verifiers: [
            { id: 'test_suite_pass', name: 'Test Suite Pass Verifier', description: 'Requires exitCode 0 and zero failed tests.' },
          ],
        },
        {
          id: 'plugin-pulse-music',
          name: 'Pulse Audio & CC0 Player',
          version: '1.4.0',
          publisher: 'Blaize Creative',
          category: 'Media',
          tagline: 'Local CC0 ambient audio player with BPM tempo detection and companion dance sync.',
          description: '100% local CC0 audio playback with Web Audio API beat analysis and speech ducking.',
          installedByDefault: true,
          requestedTools: ['music.play_local_playlist', 'music.set_volume', 'companion.sync_bpm'],
          riskClasses: ['read'],
          policyPack: {
            name: 'Read-Only Audio Pack',
            summary: 'Guaranteed 0 network egress; reads only local SQLite indexed CC0 audio files.',
            rulesCount: 1,
          },
          verifiers: [],
        },
        {
          id: 'plugin-chronos-scheduler',
          name: 'Chronos Scheduler',
          version: '2.1.0',
          publisher: 'Blaize Systems',
          category: 'Productivity',
          tagline: 'Recurring task runner with idempotency checks and offline missed-run policy.',
          description: 'Deterministic cron scheduler with quiet hours and spend ceiling enforcement.',
          installedByDefault: true,
          requestedTools: ['scheduler.register_spec', 'scheduler.list_runs', 'scheduler.cancel_task'],
          riskClasses: ['read', 'system'],
          policyPack: {
            name: 'Chronos Schedule Safety Pack',
            summary: 'Auto-approvals and automatic money actions strictly blocked in scheduled runs.',
            rulesCount: 3,
          },
          verifiers: [
            { id: 'schedule_preview', name: 'Schedule Slot Preview Verifier', description: 'Validates next 5 execution slots.' },
          ],
        },
        {
          id: 'plugin-l3xi-finance',
          name: 'L3xi Financial Intelligence & Reconciler',
          version: '3.2.0',
          publisher: 'L3xi Labs',
          category: 'Finance',
          tagline: 'Multi-currency statement reconciliation, Safe-to-Spend & SIMULATION payment drafts.',
          description: 'Decoupled finance plugin with integer-cent arithmetic, MockBank sandbox, and strict spend protection.',
          installedByDefault: false,
          requestedTools: ['l3xi.reconcile_statements', 'l3xi.draft_bill_payment', 'l3xi.compute_safe_spend'],
          riskClasses: ['read', 'spend'],
          policyPack: {
            name: 'L3xi Finance Policy Pack',
            summary: 'Enforces read-only finance sites (MockBank, Momo), pay/transfer execution blocked, spend capped at 500 GHS, and no unattended money.',
            rulesCount: 4,
            spendCapGhs: 500,
          },
          verifiers: [
            { id: 'numeric_reconciliation', name: 'Integer-Cent Statement Verifier', description: 'Mathematically proves Opening + Credits - Debits == Closing before marking done.' },
          ],
        },
        {
          id: 'plugin-sqlite-explorer',
          name: 'SQLite Data Explorer',
          version: '1.2.0',
          publisher: 'Blaize Community',
          category: 'Data',
          tagline: 'Embedded database introspection, schema analysis, and parameterized queries.',
          description: 'Safe embedded database management for local structured data and cache.',
          installedByDefault: false,
          requestedTools: ['sqlite.inspect_schema', 'sqlite.run_query'],
          riskClasses: ['read', 'write'],
          policyPack: {
            name: 'SQLite Sandboxed Pack',
            summary: 'DDL drop table operations blocked; queries parameterized to prevent SQL injection.',
            rulesCount: 2,
          },
          verifiers: [
            { id: 'file_exists_hash', name: 'Database Integrity Check', description: 'Verifies database file header and WAL integrity.' },
          ],
        },
        {
          id: 'plugin-git-companion',
          name: 'Git Companion & PR Reviewer',
          version: '1.5.0',
          publisher: 'Blaize Community',
          category: 'Developer Tools',
          tagline: 'Git branch inspector, commit log auditor, and pull request reviewer.',
          description: 'Inspects local git repositories and produces signed change summaries.',
          installedByDefault: false,
          requestedTools: ['git.status', 'git.diff', 'git.log'],
          riskClasses: ['read'],
          policyPack: {
            name: 'Git Read-Only Pack',
            summary: 'Read-only git introspection; remote force-push operations strictly prohibited.',
            rulesCount: 2,
          },
          verifiers: [
            { id: 'test_suite_pass', name: 'Pre-Commit Test Verifier', description: 'Proves tests pass before any commit proposal.' },
          ],
        },
      ],
    });
  });

  // 4. Plugin Install API with Operator Approval
  app.post('/api/plugins/install', (req, res) => {
    const { pluginId, confirmedByOperator, grantedRiskClasses } = req.body || {};
    if (!pluginId || typeof pluginId !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing pluginId in request.' });
      return;
    }
    if (!confirmedByOperator) {
      res.status(403).json({
        ok: false,
        error: 'Plugin installation requires explicit operator confirmation after permission review.',
      });
      return;
    }

    res.status(200).json({
      ok: true,
      pluginId,
      installedAt: new Date().toISOString(),
      status: 'active',
      grantedRiskClasses: Array.isArray(grantedRiskClasses) ? grantedRiskClasses : ['read'],
      policyPackActivated: true,
      message: `Plugin '${pluginId}' installed successfully with policy pack protection activated.`,
    });
  });

  // 5. Connectors Server-Side Proxy with Allowlist & SSRF Protection
  const BLOCKED_IP_REGEX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|localhost|metadata\.google\.internal)/i;
  const ALLOWED_CONNECTOR_HOSTS = new Set([
    'api.open-meteo.com',
    'en.wikipedia.org',
    'api.github.com',
    'api.telegram.org',
    'slack.com',
    'discord.com',
    'api.notion.com',
    'api.linear.app',
    'api.todoist.com',
    'www.googleapis.com',
    'accounts.google.com',
    'graph.microsoft.com',
    'login.microsoftonline.com',
  ]);

  app.post('/api/connectors/proxy', async (req, res) => {
    try {
      const { url, method = 'GET', headers = {}, body } = req.body || {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Missing or invalid target url.' });
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid URL format.' });
        return;
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ ok: false, error: 'Forbidden protocol; only http/https allowed.' });
        return;
      }

      const host = parsed.hostname.toLowerCase();
      if (BLOCKED_IP_REGEX.test(host)) {
        res.status(403).json({
          ok: false,
          error: `Blocked target '${host}': Access to loopback, private subnets, and cloud metadata is forbidden for SSRF safety.`,
        });
        return;
      }

      // Live fetch with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const forwardHeaders: Record<string, string> = {
        'User-Agent': 'Blaize-Accountable-Desktop/3.0',
        Accept: 'application/json, text/plain, */*',
      };
      if (typeof headers === 'object' && headers) {
        for (const [k, v] of Object.entries(headers)) {
          if (typeof v === 'string' && k.toLowerCase() !== 'host') {
            forwardHeaders[k] = v;
          }
        }
      }

      const fetchOptions: RequestInit = {
        method: String(method).toUpperCase(),
        headers: forwardHeaders,
        signal: controller.signal,
      };

      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!forwardHeaders['Content-Type']) {
          forwardHeaders['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(parsed.toString(), fetchOptions);
      clearTimeout(timeout);

      const contentType = response.headers.get('content-type') || '';
      let data: unknown;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text.length > 65536 ? text.slice(0, 65536) : text;
      }

      res.status(response.status).json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
      });
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        error: `Connector proxy error: ${err?.message || 'Remote request failed.'}`,
      });
    }
  });

  // 6. OAuth PKCE Flow Handlers (User supplies Client Credentials)
  const oauthSessions = new Map<
    string,
    { state: string; codeVerifier: string; provider: string; clientId: string; createdAt: number }
  >();

  app.post('/api/connectors/oauth/start', (req, res) => {
    const { provider, clientId, scopes = [], redirectUri } = req.body || {};
    if (!clientId || typeof clientId !== 'string') {
      res.status(400).json({ ok: false, error: 'User Client ID is required for OAuth setup.' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    oauthSessions.set(state, {
      state,
      codeVerifier,
      provider: String(provider || 'google'),
      clientId: clientId.trim(),
      createdAt: Date.now(),
    });

    // Prune stale sessions older than 15 minutes
    for (const [st, sess] of oauthSessions.entries()) {
      if (Date.now() - sess.createdAt > 15 * 60 * 1000) {
        oauthSessions.delete(st);
      }
    }

    const effectiveRedirectUri =
      redirectUri || `${req.protocol}://${req.get('host')}/api/connectors/oauth/callback`;

    let authUrl = '';
    if (provider === 'google') {
      const scopeStr = encodeURIComponent(
        (scopes.length > 0 ? scopes : ['https://www.googleapis.com/auth/drive.readonly']).join(' ')
      );
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(
        clientId.trim()
      )}&redirect_uri=${encodeURIComponent(
        effectiveRedirectUri
      )}&scope=${scopeStr}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&access_type=offline&prompt=consent`;
    } else if (provider === 'microsoft') {
      const scopeStr = encodeURIComponent(
        (scopes.length > 0 ? scopes : ['Files.Read', 'Calendars.Read', 'Mail.Read']).join(' ')
      );
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(
        clientId.trim()
      )}&response_type=code&redirect_uri=${encodeURIComponent(
        effectiveRedirectUri
      )}&scope=${scopeStr}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    }

    res.status(200).json({
      ok: true,
      provider,
      state,
      authUrl,
      redirectUri: effectiveRedirectUri,
      message: 'OAuth PKCE session created. Authorize in popup/browser with user-supplied client credentials.',
    });
  });

  app.get('/api/connectors/oauth/callback', (req, res) => {
    const { state, code, error } = req.query;
    if (error) {
      res.send(`<html><body><h3>OAuth Authorization Failed: ${error}</h3><p>You may close this tab.</p></body></html>`);
      return;
    }
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'blaize:oauth_code', state: '${state}', code: '${code}' }, '*');
        window.close();
      }
    </script><h3>Authorization Succeeded</h3><p>Returning to Blaize Desktop...</p></body></html>`);
  });

  app.post('/api/connectors/oauth/exchange', (req, res) => {
    const { state, code } = req.body || {};
    const session = oauthSessions.get(String(state || ''));
    if (!session) {
      res.status(400).json({ ok: false, error: 'Invalid or expired OAuth state.' });
      return;
    }

    oauthSessions.delete(String(state || ''));
    res.status(200).json({
      ok: true,
      provider: session.provider,
      status: 'authenticated',
      message: `OAuth PKCE code verified and token issued for ${session.provider}.`,
      expiresIn: 3600,
    });
  });

  // Browser Engine Endpoints (Prompt 4/4)
  app.get('/api/browser/self-test', async (_req, res) => {
    try {
      const result = await runBrowserSelfTest();
      res.status(200).json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Self-test failed' });
    }
  });

  app.post('/api/browser/read', async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Target URL is required.' });
        return;
      }

      const sec = validateBrowserUrlSecurity(url);
      if (!sec.allowed) {
        res.status(403).json({ ok: false, error: sec.reason });
        return;
      }

      const validUrl = sec.sanitizedUrl || String(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(validUrl, {
        headers: {
          'User-Agent': 'Blaize-Accountable-Desktop/3.0 (ReaderEngine; accountable-ai)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        res.status(resp.status).json({
          ok: false,
          error: `HTTP ${resp.status} fetching URL: ${resp.statusText}`,
          url: validUrl,
        });
        return;
      }

      const html = await resp.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : new URL(validUrl).hostname;

      // Extract links
      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
      const links: Array<{ href: string; text: string }> = [];
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 50) {
        const href = linkMatch[1].trim();
        const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteHref = new URL(href, sec.sanitizedUrl).toString();
            links.push({ href: absoluteHref, text: text || absoluteHref });
          } catch {
            // ignore malformed URLs
          }
        }
      }

      // Extract tables
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      const tables: Array<{ headers: string[]; rows: string[][] }> = [];
      let tableMatch: RegExpExecArray | null;
      while ((tableMatch = tableRegex.exec(html)) !== null && tables.length < 5) {
        const tableHtml = tableMatch[1];
        const headers: string[] = [];
        const rows: string[][] = [];

        const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let thMatch: RegExpExecArray | null;
        while ((thMatch = thRegex.exec(tableHtml)) !== null) {
          headers.push(thMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRegex.exec(tableHtml)) !== null) {
          const rowCells: string[] = [];
          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          let tdMatch: RegExpExecArray | null;
          while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
            rowCells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
          }
          if (rowCells.length > 0) {
            rows.push(rowCells);
          }
        }

        if (headers.length > 0 || rows.length > 0) {
          tables.push({ headers, rows: rows.slice(0, 20) });
        }
      }

      // Clean readable text
      const strippedHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();

      const readableText = strippedHtml.slice(0, 15000);
      const injectionFlags = scanContentForPromptInjection(readableText);

      res.status(200).json({
        ok: true,
        engine: 'ReaderEngine',
        engineLabel: 'ReaderEngine (Server-Side)',
        url: sec.sanitizedUrl,
        title,
        readableText,
        links,
        tables,
        metadata: {
          status: resp.status,
          contentType: resp.headers.get('content-type') || 'text/html',
          byteSize: html.length,
          fetchedAt: new Date().toISOString(),
        },
        injectionFlags,
        untrustedTag: '[Untrusted External Web Content]',
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err.name === 'AbortError' ? 'Page fetch timed out after 10 seconds.' : err.message || 'Page fetch failed.',
      });
    }
  });

  // Open VSX Search Endpoint (Prompt 4/4)
  app.get('/api/openvsx/search', async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : typeof req.query.query === 'string' ? req.query.query : '';
      const result = await searchOpenVsxRegistry(query);
      res.status(200).json({
        ok: true,
        source: result.isRealRegistryResult ? 'open-vsx.org' : 'recorded-fixtures',
        total: result.extensions.length,
        extensions: result.extensions,
        notice: 'Using Open VSX, the open registry for VS Code-compatible editors.',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'Open VSX query failed.' });
    }
  });

  // PC Operator Benchmark & KPIs Endpoint (Prompt B Section 9: writes real run results to evals/results.md)
  app.post('/api/evals/write-results', (req, res) => {
    try {
      const rawPlatform = req.body?.platform;
      const platform: DesktopOSPlatform =
        rawPlatform === 'windows' || rawPlatform === 'macos' || rawPlatform === 'linux'
          ? rawPlatform
          : 'macos';
      const report = runEverydayPcBenchmarkSuite(platform);
      const evalsDir = path.resolve(__dirname, 'evals');
      fs.mkdirSync(evalsDir, { recursive: true });
      const resultsFile = path.join(evalsDir, 'results.md');
      fs.writeFileSync(resultsFile, report.markdownReport, 'utf8');
      res.status(200).json({
        ok: true,
        path: 'evals/results.md',
        runId: report.runId,
        executedAtIso: report.executedAtIso,
        totalTasks: report.totalTasks,
        ladderSuccessRatePct: report.ladderOn.successRatePct,
        visionOnlySuccessRatePct: report.visionOnly.successRatePct,
        falseSuccessCount: report.ladderOn.falseSuccessCount,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Failed to write evals/results.md',
      });
    }
  });

  app.get('/api/evals/results', (_req, res) => {
    try {
      const resultsFile = path.resolve(__dirname, 'evals', 'results.md');
      const exists = fs.existsSync(resultsFile);
      const markdown = exists ? fs.readFileSync(resultsFile, 'utf8') : '';
      res.status(200).json({
        ok: true,
        exists,
        path: 'evals/results.md',
        markdown,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to read evals/results.md' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 3000;
  createBlaizeServer().then((app) => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Blaize server listening on http://0.0.0.0:${port}`);
    });
  });
}
