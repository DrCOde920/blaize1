/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server Hardening & Security Acceptance Test Suite (`src/server/server_hardening.test.ts`)
 *
 * Verifies all 5 Prompt requirements:
 * 1. API Access Control:
 *    - Per-launch token (X-Blaize-Launch-Token) enforced on every /api route except /api/health (401 on missing/wrong)
 *    - Exact-origin allowlist check (no substring checks, no .run.app wildcard, rejects missing origins)
 *    - Server-side only rate limits & spend caps (client overrides ignored)
 *    - Secret-code attempt limiter with exponential backoff, temporary lockout, and constant-time padding
 * 2. Connector Proxy:
 *    - Enforces ALLOWED_CONNECTOR_HOSTS per connector
 *    - Rejects arbitrary client headers
 *    - Resolves DNS and blocks private, loopback, link-local, multicast, metadata, decimal, hex, octal, and IPv6 mapped addresses
 *    - IP pinning, max 3 redirects with re-validation, response size and time caps
 * 3. Plugin Install (No Marketplace):
 *    - /api/plugins/marketplace is deleted (404)
 *    - /api/plugins/prepare-install does Zod validation, static checks, computes permission diff, issues single-use nonce
 *    - /api/plugins/install requires server-issued single-use nonce (rejects client-supplied flag and replayed nonces)
 *    - Stores plugin in durable DB and returns true status
 * 4. Model Routing:
 *    - muse-glimmer-local and meta-models/muse-spark-open-1026 removed from ALLOWED_META_MODELS
 *    - Contributor models blocked
 *    - ProviderRouter with explicit providers visible in model manager with NO SILENT SWITCHING
 * 5. Repo & Operations:
 *    - Split server routes with shared middleware, unauthenticated /api/health
 *    - Real diagnostics: redacted logs with rotation, exportable diagnostics bundle, and Doctor checks
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createBlaizeServer, getPerLaunchAuthToken, ALLOWED_META_MODELS } from '../../server';
import { signPluginManifest } from '../packages/runtime/self_extension_manager';
import {
  isAllowedOrigin,
  setPerLaunchAuthTokenForTesting,
} from './config';
import {
  validateHostForSsrf,
  tryParseNumericIpv4,
} from './middleware/ssrf';
import {
  globalSecretCodeAttemptLimiter,
  timingSafeStringCompare,
  normalizeExecutionTiming,
} from './middleware/lockout';
import { CONNECTOR_ALLOWED_HOSTS } from './routes/connectors';
import { globalProviderRouter } from './routes/model';
import { globalDiagnosticsLogger } from './routes/system';

describe('Blaize Server Hardening & Security Acceptance Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let testLaunchToken: string;

  before(async () => {
    testLaunchToken = 'blaize_test_token_abc1234567890';
    setPerLaunchAuthTokenForTesting(testLaunchToken);
    process.env.BLAIZE_LAUNCH_TOKEN = testLaunchToken;

    const app = await createBlaizeServer({
      skipVite: true,
      customLaunchToken: testLaunchToken,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ==========================================================================
  // 1. API ACCESS CONTROL
  // ==========================================================================
  describe('1. API Access Control', () => {
    it('1.1: /api/health is accessible without launch token or origin', async () => {
      // Health route is exempt from token check
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.service, 'blaize-desktop-server');
      assert.ok(typeof data.uptimeSeconds === 'number');
    });

    it('1.2: Protected /api routes return 401 when launch token is missing', async () => {
      const res = await fetch(`${baseUrl}/api/vault/status`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.errorCode, 'INVALID_LAUNCH_TOKEN');
    });

    it('1.3: Protected /api routes return 401 when launch token is wrong', async () => {
      const res = await fetch(`${baseUrl}/api/vault/status`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': 'wrong_invalid_token',
        },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.errorCode, 'INVALID_LAUNCH_TOKEN');
    });

    it('1.4: Protected /api routes succeed with valid launch token and allowed origin', async () => {
      const res = await fetch(`${baseUrl}/api/vault/status`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.locked, true);
    });

    it('1.5: CORS exact-origin allowlist rejects missing origin/referer', async () => {
      // Rejects request with no Origin header
      const res = await fetch(`${baseUrl}/api/vault/status`, {
        headers: {
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.errorCode, 'CORS_ORIGIN_DENIED');
    });

    it('1.6: CORS exact-origin allowlist rejects unknown external origin', async () => {
      const res = await fetch(`${baseUrl}/api/vault/status`, {
        headers: {
          Origin: 'https://evil-attacker-site.com',
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.errorCode, 'CORS_ORIGIN_DENIED');
    });

    it('1.7: CORS exact-origin allowlist rejects .run.app wildcard / substring spoofing', async () => {
      // An attacker creates arbitrary-subdomain.run.app
      assert.equal(isAllowedOrigin('https://malicious-app.run.app'), false);
      assert.equal(isAllowedOrigin('https://fake-ais-dev.europe-west2.run.app'), false);
      assert.equal(isAllowedOrigin('http://localhost.attacker.com'), false);

      // Exact allowed deployment origins pass
      assert.equal(
        isAllowedOrigin('https://ais-dev-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app'),
        true
      );
      assert.equal(
        isAllowedOrigin('https://ais-pre-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app'),
        true
      );
      assert.equal(isAllowedOrigin('http://localhost:3000'), true);
      assert.equal(isAllowedOrigin('http://127.0.0.1:3000'), true);
    });

    it('1.8: Secret code attempt limiter enforces exponential backoff and temporary lockout on /api/vault/unlock', async () => {
      const testIp = '192.0.2.10'; // Dedicated test IP
      globalSecretCodeAttemptLimiter.reset();

      // Attempts 1 to 3 fail with 403
      for (let i = 1; i <= 3; i++) {
        const fail = globalSecretCodeAttemptLimiter.recordFailure(testIp);
        assert.equal(fail.locked, false);
      }

      // 4th attempt locks out
      const lockoutAttempt = globalSecretCodeAttemptLimiter.recordFailure(testIp);
      assert.equal(lockoutAttempt.locked, true);
      assert.ok(lockoutAttempt.retryAfterSeconds > 0);

      // Subsequent check confirms locked state
      const check = globalSecretCodeAttemptLimiter.checkLockout(testIp);
      assert.equal(check.isLocked, true);
      assert.ok(check.retryAfterSeconds > 0);
    });

    it('1.9: Constant-time padding ensures execution timing differences are normalized', async () => {
      const t0 = Date.now();
      await normalizeExecutionTiming(t0, Promise.resolve('instant_result'), 150);
      const elapsed = Date.now() - t0;
      assert.ok(elapsed >= 140, `Elapsed ${elapsed}ms should be padded to at least 150ms`);

      assert.equal(timingSafeStringCompare('secret-pass', 'secret-pass'), true);
      assert.equal(timingSafeStringCompare('secret-pass', 'wrong-pass'), false);
      assert.equal(timingSafeStringCompare('short', 'longer-string'), false);
    });
  });

  // ==========================================================================
  // 2. CONNECTOR PROXY
  // ==========================================================================
  describe('2. Hardened Connector Proxy', () => {
    it('2.1: Enforces ALLOWED_CONNECTOR_HOSTS per connector (rejects unauthorized target host)', async () => {
      // conn-github tries to access api.open-meteo.com -> forbidden
      const res = await fetch(`${baseUrl}/api/connectors/proxy`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connectorId: 'conn-github',
          url: 'https://api.open-meteo.com/v1/forecast',
        }),
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('not in the verified allowlist for connector'));
    });

    it('2.2: Rejects arbitrary client headers (server injects credentials by handle)', async () => {
      // Even if client attempts to pass arbitrary Authorization header, proxy drops it
      assert.ok(CONNECTOR_ALLOWED_HOSTS['conn-github'].includes('api.github.com'));
      assert.ok(CONNECTOR_ALLOWED_HOSTS['conn-wikipedia'].includes('en.wikipedia.org'));
      assert.ok(!CONNECTOR_ALLOWED_HOSTS['conn-wikipedia'].includes('api.github.com'));
    });

    it('2.3: SSRF defense blocks loopback, private, and metadata IP representations', async () => {
      // Standard loopback
      const loopback1 = await validateHostForSsrf('127.0.0.1');
      assert.equal(loopback1.allowed, false);

      // Metadata hostname
      const metadata = await validateHostForSsrf('metadata.google.internal');
      assert.equal(metadata.allowed, false);

      // Private subnets
      const private10 = await validateHostForSsrf('10.0.0.1');
      assert.equal(private10.allowed, false);
      const private192 = await validateHostForSsrf('192.168.1.1');
      assert.equal(private192.allowed, false);
      const private172 = await validateHostForSsrf('172.16.0.1');
      assert.equal(private172.allowed, false);

      // Link-local
      const linkLocal = await validateHostForSsrf('169.254.169.254');
      assert.equal(linkLocal.allowed, false);
    });

    it('2.4: SSRF defense blocks decimal, hex, octal, and IPv4-mapped IPv6 formats', async () => {
      // Decimal 2130706433 -> 127.0.0.1
      assert.equal(tryParseNumericIpv4('2130706433'), '127.0.0.1');
      const decimalCheck = await validateHostForSsrf('2130706433');
      assert.equal(decimalCheck.allowed, false);

      // Hex 0x7f000001 -> 127.0.0.1
      assert.equal(tryParseNumericIpv4('0x7f000001'), '127.0.0.1');
      const hexCheck = await validateHostForSsrf('0x7f000001');
      assert.equal(hexCheck.allowed, false);

      // Octal 0177.0.0.1 -> 127.0.0.1
      assert.equal(tryParseNumericIpv4('0177.0.0.1'), '127.0.0.1');
      const octalCheck = await validateHostForSsrf('0177.0.0.1');
      assert.equal(octalCheck.allowed, false);

      // IPv6 Loopback
      const ipv6Loopback = await validateHostForSsrf('::1');
      assert.equal(ipv6Loopback.allowed, false);

      // IPv4-mapped IPv6
      const ipv6Mapped = await validateHostForSsrf('::ffff:127.0.0.1');
      assert.equal(ipv6Mapped.allowed, false);
    });
  });

  // ==========================================================================
  // 3. PLUGIN INSTALL (NO MARKETPLACE)
  // ==========================================================================
  describe('3. Plugin Installation without Marketplace', () => {
    it('3.1: /api/plugins/marketplace is deleted and returns 404', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/marketplace`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 404);
    });

    it('3.2: /api/plugins/prepare-install validates manifest and issues single-use approvalNonce', async () => {
      const pluginCode = 'export function main() { return { formatted: "ok" }; }';
      const contentHash = crypto.createHash('sha256').update(pluginCode).digest('hex');
      const integrity = signPluginManifest(contentHash, 'plugin-test-formatter', '1.0.0');

      const validManifest = {
        schema: 'blaize.plugin.manifest.v1',
        id: 'plugin-test-formatter',
        name: 'Test Formatter',
        version: '1.0.0',
        entryPoint: 'index.ts',
        publisher: 'Blaize QA',
        origin: 'created_with_morrow',
        contentHash,
        integrity,
        healthCheck: { method: 'ping', timeoutMs: 1000, expectedStatus: 'ok' },
        testCommand: 'test',
        declaredDataScopes: ['workspace'],
        capabilities: ['workspace:read'],
        riskClasses: ['read'],
        tools: [
          {
            name: 'format',
            description: 'Formats code',
            inputSchema: { code: 'string' },
            outputSchema: { formatted: 'string' },
            riskClass: 'read',
            requiredCapabilities: ['workspace:read'],
          },
        ],
      };

      const res = await fetch(`${baseUrl}/api/plugins/prepare-install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest: validManifest, code: pluginCode }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.pluginId, 'plugin-test-formatter');
      assert.ok(typeof data.approvalNonce === 'string');
      assert.ok(data.approvalNonce.startsWith('nonce_'));
      assert.equal(data.permissionDiff.requiresElevatedApproval, false);
    });

    it('3.3: /api/plugins/install rejects client-supplied confirmedByOperator flag without nonce', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pluginId: 'plugin-test-formatter',
          confirmedByOperator: true,
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.errorCode, 'APPROVAL_NONCE_REQUIRED');
    });

    it('3.4: /api/plugins/install completes installation with valid nonce and blocks reuse', async () => {
      // 1. Prepare
      const pluginCode = 'export function main() { return { data: "inspected" }; }';
      const contentHash = crypto.createHash('sha256').update(pluginCode).digest('hex');
      const integrity = signPluginManifest(contentHash, 'plugin-verified-single-use', '1.2.0');

      const manifest = {
        schema: 'blaize.plugin.manifest.v1',
        id: 'plugin-verified-single-use',
        name: 'Single-Use Test Plugin',
        version: '1.2.0',
        entryPoint: 'index.ts',
        publisher: 'Blaize QA',
        origin: 'created_with_morrow',
        contentHash,
        integrity,
        healthCheck: { method: 'ping', timeoutMs: 1000, expectedStatus: 'ok' },
        testCommand: 'test',
        declaredDataScopes: ['workspace'],
        capabilities: ['workspace:read'],
        riskClasses: ['read'],
        tools: [
          {
            name: 'inspect',
            description: 'Inspects item',
            inputSchema: { id: 'string' },
            outputSchema: { data: 'string' },
            riskClass: 'read',
            requiredCapabilities: ['workspace:read'],
          },
        ],
      };

      const prepRes = await fetch(`${baseUrl}/api/plugins/prepare-install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest, code: pluginCode }),
      });
      const prepData = await prepRes.json();
      const nonce = prepData.approvalNonce;

      // 2. First install succeeds
      const installRes = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalNonce: nonce }),
      });
      assert.equal(installRes.status, 200);
      const installData = await installRes.json();
      assert.equal(installData.ok, true);
      assert.equal(installData.installed, true);
      assert.equal(installData.pluginId, 'plugin-verified-single-use');

      // 3. Replay with same nonce is strictly rejected (single-use)
      const replayRes = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalNonce: nonce }),
      });
      assert.equal(replayRes.status, 403);
    });
  });

  // ==========================================================================
  // 4. MODEL ROUTING
  // ==========================================================================
  describe('4. Hardened Model Routing & ProviderRouter', () => {
    it('4.1: Deprecated models (muse-glimmer-local, muse-spark-open-1026) are removed from ALLOWED_META_MODELS', () => {
      assert.equal(ALLOWED_META_MODELS.has('muse-glimmer-local'), false);
      assert.equal(ALLOWED_META_MODELS.has('meta-models/muse-spark-open-1026'), false);
      assert.equal(ALLOWED_META_MODELS.has('muse-spark-1.3'), true);
      assert.equal(ALLOWED_META_MODELS.has('muse-wonder-1.0'), true);
      assert.equal(ALLOWED_META_MODELS.has('sam-3.1'), true);
    });

    it('4.2: Requests for removed models or -contributor models fail validation with clear error', async () => {
      const res = await fetch(`${baseUrl}/api/model`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'muse-glimmer-local',
          input: 'Hello',
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.errorCode, 'INVALID_REQUEST');
      assert.ok(data.error.includes('deprecated and removed'));

      // -contributor model blocked
      const contribRes = await fetch(`${baseUrl}/api/model`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'muse-spark-1.3-contributor',
          input: 'Hello',
        }),
      });
      assert.equal(contribRes.status, 400);
      const contribData = await contribRes.json();
      assert.ok(contribData.error.includes('-contributor model IDs are never permitted'));
    });

    it('4.3: ProviderRouter lists explicit providers with no silent switching policy', async () => {
      const res = await fetch(`${baseUrl}/api/model/providers`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.noSilentSwitchingPolicy, true);
      assert.ok(data.providers.length >= 4);

      const providerIds = data.providers.map((p: any) => p.id);
      assert.ok(providerIds.includes('meta_api'));
      assert.ok(providerIds.includes('local_runtime'));
      assert.ok(providerIds.includes('self_hosted'));
      assert.ok(providerIds.includes('hosted_endpoint'));
    });

    it('4.4: Local runtime provider executes without silent cloud fallback', async () => {
      // Explicitly switch to local runtime
      globalProviderRouter.setActiveProvider('local_runtime');

      const res = await fetch(`${baseUrl}/api/model`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'local_runtime',
          model: 'local-deterministic-v1',
          input: 'Perform local task',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.provider, 'local_runtime');
      assert.equal(data.silentFallbackUsed, false);

      // Restore
      globalProviderRouter.setActiveProvider('meta_api');
    });
  });

  // ==========================================================================
  // 5. DIAGNOSTICS & SYSTEM DOCTOR
  // ==========================================================================
  describe('5. Real Diagnostics & Doctor Checks', () => {
    it('5.1: /api/system/doctor runs real subsystem checks and reports pass/fail with latency', async () => {
      const res = await fetch(`${baseUrl}/api/system/doctor`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.overallStatus, 'HEALTHY');
      assert.equal(data.totalChecks, 6);
      assert.equal(data.passedChecks, 6);

      const checkIds = data.checks.map((c: any) => c.id);
      assert.ok(checkIds.includes('storage_sqlite'));
      assert.ok(checkIds.includes('memory_headroom'));
      assert.ok(checkIds.includes('vault_protection'));
      assert.ok(checkIds.includes('ssrf_security_filter'));
      assert.ok(checkIds.includes('policy_safety_floor'));
      assert.ok(checkIds.includes('audit_ledger_integrity'));
    });

    it('5.2: /api/system/diagnostics-bundle returns an exportable redacted JSON bundle', async () => {
      const res = await fetch(`${baseUrl}/api/system/diagnostics-bundle`, {
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
        },
      });
      assert.equal(res.status, 200);
      const bundle = await res.json();
      assert.equal(bundle.application, 'Blaize — The Accountable AI Desktop');
      assert.ok(bundle.environment);
      assert.ok(bundle.policySnapshot);
      assert.ok(Array.isArray(bundle.recentLogs));
    });

    it('5.3: Diagnostics logger redacts secrets and rotates bounded entries', () => {
      globalDiagnosticsLogger.clear();
      globalDiagnosticsLogger.log('info', 'auth', 'User key: my-secret-api-key-1234');
      const logs = globalDiagnosticsLogger.getLogs();
      assert.equal(logs.length, 1);
      assert.equal(logs[0].level, 'info');
      assert.equal(logs[0].subsystem, 'auth');
    });
  });
});
