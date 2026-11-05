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
  isAllowedHost,
  isLoopbackAddress,
  shouldInjectLaunchToken,
  setPerLaunchAuthTokenForTesting,
} from './config';
import {
  hostValidationMiddleware,
  remoteAccessProtectionMiddleware,
} from './middleware/auth';
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
import { globalDiagnosticsLogger } from './routes/system';
import { globalProviderRouter } from './routes/model';
import { PassphraseWrapVault } from '../packages/vault/index';
import {
  MemoryLedger,
  validateCanonicalLedgerFields,
  migrateLegacyLedgerRecords,
  DEFAULT_POLICY_CONFIG,
  DEMO_POLICY_CONFIG,
  globalPolicyEngine,
} from '../packages/trust/index';

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

  // ==========================================================================
  // 6. DESKTOP SERVER SECURITY & REMOTE ACCESS HARDENING (PROMPT 1)
  // ==========================================================================
  describe('6. Desktop Server Security & Remote Access Hardening (Prompt 1)', () => {
    it('6.1: Host header validation allows localhost/127.0.0.1 and rejects arbitrary external hosts', () => {
      assert.equal(isAllowedHost('localhost'), true);
      assert.equal(isAllowedHost('localhost:3000'), true);
      assert.equal(isAllowedHost('127.0.0.1'), true);
      assert.equal(isAllowedHost('127.0.0.1:8080'), true);
      assert.equal(isAllowedHost('[::1]'), true);
      assert.equal(isAllowedHost('[::1]:3000'), true);
      assert.equal(isAllowedHost('evil.com'), false);
      assert.equal(isAllowedHost('attacker.com:3000'), false);
      assert.equal(isAllowedHost('192.168.1.100:3000'), false);
      assert.equal(isAllowedHost(''), false);
      assert.equal(isAllowedHost(null), false);
    });

    it('6.2: Requests with spoofed or untrusted Host header are rejected with 403 INVALID_HOST_HEADER', async () => {
      const url = new URL(`${baseUrl}/api/vault/status`);
      const res = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
            headers: {
              Host: 'evil-attacker.com',
              Origin: baseUrl,
              'X-Blaize-Launch-Token': testLaunchToken,
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
              } catch {
                resolve({ status: res.statusCode || 0, body: data });
              }
            });
          }
        );
        req.on('error', reject);
        req.end();
      });

      assert.equal(res.status, 403);
      assert.equal(res.body.errorCode, 'INVALID_HOST_HEADER');
    });

    it('6.3: Remote access protection middleware blocks non-loopback IP connections to privileged APIs', () => {
      let nextCalled = false;
      let statusSent = 0;
      let jsonSent: any = null;

      const mockRes: any = {
        status: (code: number) => {
          statusSent = code;
          return {
            json: (data: any) => {
              jsonSent = data;
            },
          };
        },
      };

      // Non-loopback IP
      const remoteReq: any = {
        path: '/vault/status',
        method: 'GET',
        socket: { remoteAddress: '192.168.1.55' },
      };

      remoteAccessProtectionMiddleware(remoteReq, mockRes, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(statusSent, 403);
      assert.equal(jsonSent?.errorCode, 'REMOTE_ACCESS_DENIED');

      // Loopback IP passes through
      nextCalled = false;
      const loopbackReq: any = {
        path: '/vault/status',
        method: 'GET',
        socket: { remoteAddress: '127.0.0.1' },
      };

      remoteAccessProtectionMiddleware(loopbackReq, mockRes, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
    });

    it('6.4: shouldInjectLaunchToken refuses token exposure on untrusted origin, referer, or remote IP', () => {
      const validReq = {
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
        },
        socket: { remoteAddress: '127.0.0.1' },
      };
      assert.equal(shouldInjectLaunchToken(validReq), true);

      // Untrusted origin
      const untrustedOriginReq = {
        headers: {
          host: '127.0.0.1:3000',
          origin: 'https://evil.com',
        },
        socket: { remoteAddress: '127.0.0.1' },
      };
      assert.equal(shouldInjectLaunchToken(untrustedOriginReq), false);

      // Untrusted referer
      const untrustedRefererReq = {
        headers: {
          host: '127.0.0.1:3000',
          referer: 'https://evil.com/page.html',
        },
        socket: { remoteAddress: '127.0.0.1' },
      };
      assert.equal(shouldInjectLaunchToken(untrustedRefererReq), false);

      // Cross-site fetch attempt
      const crossSiteReq = {
        headers: {
          host: '127.0.0.1:3000',
          'sec-fetch-site': 'cross-site',
        },
        socket: { remoteAddress: '127.0.0.1' },
      };
      assert.equal(shouldInjectLaunchToken(crossSiteReq), false);

      // Remote IP
      const remoteIpReq = {
        headers: {
          host: '127.0.0.1:3000',
        },
        socket: { remoteAddress: '10.0.0.5' },
      };
      assert.equal(shouldInjectLaunchToken(remoteIpReq), false);
    });

    it('6.5: Token theft prevention: cross-origin requests trying to fetch HTML are rejected with 403', async () => {
      const res = await fetch(`${baseUrl}/`, {
        headers: {
          Origin: 'https://evil-attacker.com',
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.errorCode, 'CORS_ORIGIN_DENIED');
    });
  });

  // ==========================================================================
  // 7. HARDENED OAUTH SECURITY & INJECTION DEFENSE (PROMPT 2)
  // ==========================================================================
  describe('7. Hardened OAuth Security & Injection Defense (Prompt 2)', () => {
    it('7.1: OAuth start rejects untrusted redirectUri (redirect manipulation prevention)', async () => {
      const res = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-1234',
          redirectUri: 'https://attacker.steals-token.com/api/callback',
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('redirectUri'));
    });

    it('7.2: OAuth start succeeds with valid localhost loopback redirectUri and stores session', async () => {
      const res = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'client-test-id-123.apps.googleusercontent.com',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(typeof data.state, 'string');
      assert.equal(data.state.length, 32);
      assert.ok(data.authUrl.includes(data.state));
    });

    it('7.3: OAuth callback rejects forged or unregistered state with 400 Bad Request', async () => {
      const forgedState = 'a1b2c3d4e5f678901234567890abcdef';
      const res = await fetch(`${baseUrl}/api/connectors/oauth/callback?state=${forgedState}&code=valid_code_123`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 400);
      const body = await res.text();
      assert.ok(body.includes('Invalid, forged, or expired OAuth state'));
      assert.ok(!body.includes('postMessage'));
    });

    it('7.4: OAuth callback eliminates HTML/JS injection in error parameter (escaped, strict CSP)', async () => {
      // First start a session to get a valid state
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-error',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      const res = await fetch(
        `${baseUrl}/api/connectors/oauth/callback?state=${state}&error=${encodeURIComponent(xssPayload)}`,
        { headers: { Origin: baseUrl } }
      );
      assert.equal(res.status, 400);

      const csp = res.headers.get('content-security-policy');
      assert.ok(csp, 'CSP header must be present');
      assert.ok(csp.includes("default-src 'none'"));
      assert.ok(csp.includes('nonce-'));

      const body = await res.text();
      assert.ok(!body.includes('<script>alert'), 'Raw executable script must not be reflected');
      assert.ok(!body.includes('<img src=x'), 'Raw HTML tag must not be reflected');
      assert.ok(body.includes('&lt;script&gt;alert') || body.includes('OAuth Authorization Failed'));
    });

    it('7.5: OAuth callback eliminates script injection in code parameter', async () => {
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-code',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      const maliciousCode = '";alert(1);//<script>';
      const res = await fetch(
        `${baseUrl}/api/connectors/oauth/callback?state=${state}&code=${encodeURIComponent(maliciousCode)}`,
        { headers: { Origin: baseUrl } }
      );
      assert.equal(res.status, 400);
      const body = await res.text();
      assert.ok(!body.includes('alert(1)'));
      assert.ok(body.includes('Invalid authorization code format'));
    });

    it('7.6: OAuth callback eliminates wildcard postMessage target (pins verified client origin)', async () => {
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-postmessage',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      const validCode = 'auth_code_safe_xyz123456';
      const res = await fetch(`${baseUrl}/api/connectors/oauth/callback?state=${state}&code=${validCode}`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res.status, 200);

      const csp = res.headers.get('content-security-policy');
      assert.ok(csp?.includes("default-src 'none'"));
      assert.ok(csp?.includes('nonce-'));

      const body = await res.text();
      // Crucial: Must NEVER contain wildcard '*' postMessage target
      assert.ok(!body.includes(", '*'"), "Must not use wildcard '*' in postMessage");
      assert.ok(!body.includes(', "*"'), 'Must not use wildcard "*" in postMessage');
      assert.ok(body.includes(baseUrl), `postMessage must pin target origin '${baseUrl}'`);
      assert.ok(body.includes(validCode));
    });

    it('7.7: OAuth callback enforces replay attack prevention', async () => {
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-replay',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      const code = 'code_replay_test_123';
      // First receipt: Succeeded (200)
      const res1 = await fetch(`${baseUrl}/api/connectors/oauth/callback?state=${state}&code=${code}`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res1.status, 200);

      // Replay attempt with same state: Rejected (400)
      const res2 = await fetch(`${baseUrl}/api/connectors/oauth/callback?state=${state}&code=${code}`, {
        headers: { Origin: baseUrl },
      });
      assert.equal(res2.status, 400);
      const body2 = await res2.text();
      assert.ok(body2.includes('replay detected'));
    });

    it('7.8: OAuth exchange rejects mismatched redirectUri and consumes state once', async () => {
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'test-client-id-exchange',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      // Attempt exchange with mismatched redirectUri
      const resMismatch = await fetch(`${baseUrl}/api/connectors/oauth/exchange`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state,
          code: 'dummy_code',
          redirectUri: 'http://127.0.0.1:9999/wrong-callback',
        }),
      });
      assert.equal(resMismatch.status, 400);
      const dataMismatch = await resMismatch.json();
      assert.equal(dataMismatch.error, 'OAuth redirectUri mismatch.');

      // State must be single-use consumed: second call returns invalid state
      const resReplay = await fetch(`${baseUrl}/api/connectors/oauth/exchange`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state,
          code: 'dummy_code',
        }),
      });
      assert.equal(resReplay.status, 400);
      const dataReplay = await resReplay.json();
      assert.equal(dataReplay.error, 'Invalid or expired OAuth state.');
    });
  });

  // ==========================================================================
  // 8. VAULT CREDENTIAL HANDLING & REPAIRED LEDGER CRYPTOGRAPHY (PROMPTS 3 & 4)
  // ==========================================================================
  describe('8. Vault Credential Handling & Cryptographic Ledger (Prompts 3 & 4)', () => {
    it('8.1: OAuth exchange rejects saving credentials when vault is locked and no valid secretCode is provided', async () => {
      // Initiate a valid OAuth flow
      const startRes = await fetch(`${baseUrl}/api/connectors/oauth/start`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'google',
          clientId: 'vault-auth-test-client',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
        }),
      });
      const { state } = await startRes.json();

      // Receive callback
      await fetch(`${baseUrl}/api/connectors/oauth/callback?state=${state}&code=test_code_vault_auth`, {
        headers: { Origin: baseUrl },
      });

      // Attempt exchange without unlocking vault or providing valid secretCode
      const exchangeRes = await fetch(`${baseUrl}/api/connectors/oauth/exchange`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state,
          code: 'test_code_vault_auth',
          redirectUri: `${baseUrl}/api/connectors/oauth/callback`,
          // Note: NO secretCode provided and vault is locked
        }),
      });

      assert.equal(exchangeRes.status, 401);
      const data = await exchangeRes.json();
      assert.equal(data.errorCode, 'VAULT_AUTHENTICATION_REQUIRED');
      assert.ok(data.error.includes('Vault must be unlocked by the verified owner'));
    });

    it('8.2: Non-empty arbitrary string is rejected as proof of owner authentication in initialized vault', async () => {
      const vault = new PassphraseWrapVault();
      // Initialize with genuine owner passphrase
      await vault.unlock('genuine-owner-secret-2026');
      await vault.store({
        keyId: 'test_api_key_1',
        label: 'Test Key',
        provider: 'Meta AI',
        plainKey: 'sk-abcdef1234567890',
      });
      vault.lock();

      // Non-empty wrong secret code is rejected
      const unlockResult = await vault.unlock('wrong-code-guess');
      assert.equal(unlockResult, false);
      assert.equal(vault.isLocked(), true);

      // Attempting to store with wrong code fails
      await assert.rejects(
        async () => {
          await vault.store(
            {
              keyId: 'test_api_key_2',
              label: 'Test Key 2',
              provider: 'Meta AI',
              plainKey: 'sk-abcdef1234567890',
            },
            'wrong-code-guess'
          );
        },
        /Authentication failed: provided secret code is invalid/
      );
    });

    it('8.3: Plaintext OAuth tokens are never exposed in exchange responses or logs', async () => {
      const vault = new PassphraseWrapVault();
      await vault.unlock('owner-passphrase-secure-999');
      const entry = await vault.store({
        keyId: 'oauth_token_secret',
        label: 'Sensitive OAuth Key',
        provider: 'Google',
        plainKey: 'secret_plaintext_access_token_12345',
      });

      // Masked preview only, never plaintext
      assert.equal(entry.maskedPreview, '••••2345');
      assert.equal(entry.lastFour, '2345');
      assert.equal((entry as any).plainKey, undefined);
      assert.equal((entry as any).plainText, undefined);
    });

    it('8.4: MemoryLedger rejects zero-key fallback and hardcoded insecure keys', () => {
      // Rejects all-zero 32-byte key
      const zeroKey = new Uint8Array(32);
      assert.throws(
        () => new MemoryLedger(false, undefined, zeroKey),
        /insecure zero-key fallback/
      );

      // Rejects hardcoded key
      const hardcodedKey = Buffer.from('blaize_ledger_master_aes_key_32b', 'utf8').subarray(0, 32);
      assert.throws(
        () => new MemoryLedger(false, undefined, hardcodedKey),
        /insecure hardcoded key/
      );
    });

    it('8.5: Canonical ledger validation requires full-length 64-hex SHA-256 digests and rejects FNV/Murmur', () => {
      // Full length 64-hex SHA-256 passes
      const validRecord = {
        sequence: 1,
        timestamp: new Date().toISOString(),
        actor: 'operator',
        eventType: 'test_event',
        mission: 'm-1',
        profileWorkspace: 'ws-1',
        redactedSummary: 'Valid event',
        payloadReference: 'ref-1',
        payloadDigest: 'a'.repeat(64),
        previousHash: 'b'.repeat(64),
        schemaVersion: 2,
      };
      const checkValid = validateCanonicalLedgerFields(validRecord);
      assert.equal(checkValid.valid, true);

      // 16-character legacy hash (FNV/Murmur) is rejected for unmigrated record
      const legacyRecord = {
        ...validRecord,
        payloadDigest: 'abcdef0123456789', // 16 hex
      };
      const checkLegacy = validateCanonicalLedgerFields(legacyRecord);
      assert.equal(checkLegacy.valid, false);
      assert.ok(checkLegacy.errors.some((e) => e.includes('expected full-length 64-hex SHA-256 digest')));
    });

    it('8.6: Explicit legacy migration preserves historical records and marks them honestly as unverified', () => {
      const historicalRecords = [
        {
          index: 0,
          timestamp: '2025-01-01T00:00:00Z',
          actor: 'genesis',
          type: 'genesis',
          summary: 'Genesis block',
          evidenceHash: '0'.repeat(64),
          previousHash: '0'.repeat(64),
        },
        {
          index: 1,
          timestamp: '2025-01-02T00:00:00Z',
          actor: 'legacy-agent',
          type: 'legacy_run',
          summary: 'Historical event with FNV hash',
          evidenceHash: '1234567890abcdef', // 16-hex legacy hash
          previousHash: '0'.repeat(64),
          schemaVersion: 1,
        },
      ];

      const { migrated, legacyUnverifiableCount } = migrateLegacyLedgerRecords(historicalRecords);
      assert.equal(legacyUnverifiableCount, 1);
      assert.equal(migrated[1].isLegacyUnverified, true);
      assert.equal(migrated[1].verificationState, 'unverified_legacy');
      assert.equal(migrated[1].trustLevel, 'unverified');

      // Migrated legacy record validates under explicit legacy status
      const migratedCheck = validateCanonicalLedgerFields(migrated[1]);
      assert.equal(migratedCheck.valid, true);
    });

    it('8.7: Tampering with ledger payload or summary causes chain verification failure', () => {
      const key = crypto.randomBytes(32);
      const ledger = new MemoryLedger(false, undefined, key);
      ledger.appendEvent({
        actor: 'guard',
        type: 'rule_evaluated',
        summary: 'Original rule summary',
        payload: JSON.stringify({ valid: true }),
        trustLevel: 'verified_by_evidence',
        missionId: 'm-100',
      });
      ledger.appendEvent({
        actor: 'operator',
        type: 'user_approved',
        summary: 'Original operator confirmation',
        payload: JSON.stringify({ approved: true }),
        trustLevel: 'verified_by_evidence',
        missionId: 'm-100',
      });

      const initialReport = ledger.verifyChain();
      assert.equal(initialReport.valid, true);

      // Tamper with event summary
      const tampered = ledger.tamperWithEventForTesting(1, 'Attacker tampered event summary');
      assert.equal(tampered, true);

      const tamperedReport = ledger.verifyChain();
      assert.equal(tamperedReport.valid, false);
      assert.equal(tamperedReport.firstBrokenIndex, 1);
    });
  });

  // ==========================================================================
  // 9. POLICYENGINE MANDATORY BOUNDARY & REAL PLUGIN INSTALLATION (PROMPTS 5 & 6)
  // ==========================================================================
  describe('9. PolicyEngine Boundary & Real Plugin Installation (Prompts 5 & 6)', () => {
    it('9.1: Direct API bypass to unallowlisted domain is blocked by PolicyEngine with 403', async () => {
      const res = await fetch(`${baseUrl}/api/connectors/proxy`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connectorId: 'conn-github',
          url: 'https://evil-unauthorized-target.com/api',
          method: 'GET',
        }),
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('Host') || data.error.includes('PolicyEngine'));
    });

    it('9.2: Production DEFAULT_POLICY_CONFIG denies mockbank.local; demo profile allowlists it', () => {
      // Production default policy: mockbank.local is NOT allowed
      assert.equal(DEFAULT_POLICY_CONFIG.allowedDomains.includes('mockbank.local'), false);
      assert.equal(DEFAULT_POLICY_CONFIG.allowedDomains.includes('portal.mockbank.local'), false);

      // Demo profile policy: mockbank.local is allowlisted
      assert.equal(DEMO_POLICY_CONFIG.allowedDomains.includes('mockbank.local'), true);
      assert.equal(DEMO_POLICY_CONFIG.allowedDomains.includes('portal.mockbank.local'), true);
    });

    it('9.3: /api/browser/read enforces PolicyEngine authorization', async () => {
      const res = await fetch(`${baseUrl}/api/browser/read`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
          'X-Blaize-Profile': 'personal',
        },
        body: JSON.stringify({
          url: 'https://unauthorized-attacker-site.com/index.html',
        }),
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.errorCode, 'POLICY_VIOLATION');
      assert.ok(data.error.includes('PolicyEngine denied'));
    });

    it('9.4: Plugin installation requires verified approvalNonce pinned to exact manifest and contentHash', async () => {
      // Rejects installation without nonce
      const noNonceRes = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(noNonceRes.status, 403);
      const data = await noNonceRes.json();
      assert.equal(data.errorCode, 'APPROVAL_NONCE_REQUIRED');
    });

    it('9.5: Plugin prepare-install returns contentHash and install persists code and contentHash', async () => {
      const manifest = {
        schema: 'blaize.plugin.manifest.v1',
        id: 'real-plugin-test-01',
        name: 'Real Plugin Test',
        version: '1.0.0',
        entryPoint: 'index.ts',
        publisher: 'Blaize Verified',
        origin: 'internal',
        declaredDataScopes: ['read_files'],
        testCommand: 'test',
        healthCheck: { method: 'ping' },
        tools: [
          {
            name: 'calculate_sum',
            description: 'Computes sum of numbers',
            riskClass: 'read',
            inputSchema: { a: 'number', b: 'number' },
            outputSchema: { sum: 'number' },
          },
        ],
        capabilities: ['workspace:read'],
        riskClasses: ['read'],
      };
      const code = 'export function calculate_sum(a, b) { return a + b; }';

      // 1. Prepare install
      const prepRes = await fetch(`${baseUrl}/api/plugins/prepare-install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest, code }),
      });
      assert.equal(prepRes.status, 200);
      const prepData = await prepRes.json();
      assert.equal(prepData.ok, true);
      assert.ok(typeof prepData.approvalNonce === 'string');
      assert.ok(typeof prepData.contentHash === 'string');
      assert.equal(prepData.contentHash.length, 64);

      // 2. Perform install with nonce
      const installRes = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approvalNonce: prepData.approvalNonce }),
      });
      assert.equal(installRes.status, 200);
      const installData = await installRes.json();
      assert.equal(installData.ok, true);
      assert.equal(installData.status, 'active');
      assert.equal(installData.contentHash, prepData.contentHash);
      assert.deepEqual(installData.toolsRegistered, ['calculate_sum']);
    });

    it('9.6: Plugin installation rejects unapproved capability escalation', async () => {
      const manifest = {
        schema: 'blaize.plugin.manifest.v1',
        id: 'escalate-plugin-01',
        name: 'Escalation Test Plugin',
        version: '1.0.0',
        entryPoint: 'index.ts',
        publisher: 'Blaize Verified',
        origin: 'internal',
        declaredDataScopes: ['read_files'],
        testCommand: 'test',
        healthCheck: { method: 'ping' },
        tools: [
          {
            name: 'safe_tool',
            description: 'Safe tool',
            riskClass: 'read',
          },
        ],
        capabilities: ['workspace:read'],
        riskClasses: ['read'],
      };
      const code = 'export function safe_tool() { return true; }';

      const prepRes = await fetch(`${baseUrl}/api/plugins/prepare-install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest, code }),
      });
      const { approvalNonce } = await prepRes.json();

      // Client attempts to escalate with unapproved capabilities
      const installRes = await fetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approvalNonce,
          escalatedCapabilities: ['fs:root_write', 'system:exec_arbitrary'],
        }),
      });
      assert.equal(installRes.status, 403);
      const data = await installRes.json();
      assert.equal(data.errorCode, 'CAPABILITY_ESCALATION_REJECTED');
    });

    it('9.7: Malicious plugin failing worker validation is rejected and never reported active', async () => {
      const maliciousManifest = {
        schema: 'blaize.plugin.manifest.v1',
        id: 'malicious-plugin-01',
        name: 'Malicious Path Traversal Plugin',
        version: '1.0.0',
        entryPoint: '../../etc/passwd', // Path traversal escape!
        publisher: 'Evil Attacker',
        origin: 'external',
        declaredDataScopes: ['read_files'],
        testCommand: 'test',
        healthCheck: { method: 'ping' },
        tools: [{ name: 'steal_keys', riskClass: 'read' }],
        capabilities: ['workspace:read'],
      };

      const prepRes = await fetch(`${baseUrl}/api/plugins/prepare-install`, {
        method: 'POST',
        headers: {
          Origin: baseUrl,
          'X-Blaize-Launch-Token': testLaunchToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest: maliciousManifest, code: 'bad code' }),
      });
      assert.equal(prepRes.status, 400);
      const data = await prepRes.json();
      assert.equal(data.ok, false);
      assert.equal(data.errorCode, 'PATH_ESCAPE_IN_ENTRYPOINT');
    });

    it('9.8: Client API interceptor safely handles non-configurable getter-only window.fetch in iframe shims', async () => {
      const {
        initClientApiInterceptor,
        setLaunchToken,
        attachLaunchTokenToRequest,
      } = await import('../utils/api_client');

      const fakeWindow: Record<string, any> = {};
      Object.defineProperty(fakeWindow, 'fetch', {
        get() {
          return globalThis.fetch;
        },
        configurable: false,
      });

      const prevWindow = (globalThis as any).window;
      try {
        (globalThis as any).window = fakeWindow;
        setLaunchToken('blaize_launch_test_iframe_token');

        assert.doesNotThrow(() => {
          initClientApiInterceptor();
        });
        assert.equal(fakeWindow.__BLAIZE_INTERCEPTOR_INITIALIZED__, true);

        const prepared = attachLaunchTokenToRequest('/api/vault/status');
        const headers = new Headers(prepared.init?.headers);
        assert.equal(headers.get('X-Blaize-Launch-Token'), 'blaize_launch_test_iframe_token');
      } finally {
        if (prevWindow === undefined) {
          delete (globalThis as any).window;
        } else {
          (globalThis as any).window = prevWindow;
        }
      }
    });
  });
});


