/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 — Comprehensive Tests for Real Connectors & Time-Correct Scheduler
 * Covers Requirements 1 through 12.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  getConnectorProviderAdapter,
  CONNECTOR_PROVIDER_ADAPTERS,
  invokeConnectorAdapterTool,
  OAuthPkceLifecycleManager,
  globalConnectorRateLimiter,
  clearConnectorIdempotencyCache,
  parseRssOrAtomXml,
  parseIcsCalendarText,
  parseCronExpression,
  computeNextRunsInTimeZone,
  isValidIanaTimeZone,
  DurableSchedulerEngine,
  testConnectorReal,
  INITIAL_CONNECTOR_MANIFESTS,
} from './index';
import { PassphraseWrapVault } from '../vault';
import { globalApprovalTokenStore } from '../trust';

// ============================================================================
// 1. CONNECTOR HONEST STATUSES & SEPARATED LIFECYCLE (Reqs 1, 2, 3, 5, 6)
// ============================================================================

test('Phase 10 Req 1 & 6: Catalogue-only connectors report NOT_CONFIGURED and never return generic success', async () => {
  const allAdapters = Object.values(CONNECTOR_PROVIDER_ADAPTERS);
  const realAdapters = allAdapters.filter((a) => a.adapterImplemented);
  const catalogueOnly = allAdapters.filter((a) => !a.adapterImplemented);

  assert.ok(realAdapters.length >= 7, 'At least 7 real provider adapters must be implemented');
  assert.ok(
    catalogueOnly.length >= 10,
    'Catalogue-only integrations must be explicitly marked adapterImplemented: false'
  );

  for (const cat of catalogueOnly) {
    const connTest = await cat.testConnection({ mode: 'live' });
    assert.equal(connTest.status, 'not_configured');
    assert.equal(connTest.evidenceClass, 'NOT_CONFIGURED');
    assert.equal(connTest.connectionTestProvesAllToolsWork, false);

    const disc = await cat.discoverCapabilities({ mode: 'live' });
    assert.equal(disc.status, 'not_configured');
    assert.equal(disc.evidenceClass, 'NOT_CONFIGURED');

    const manifest = INITIAL_CONNECTOR_MANIFESTS.find((m) => m.id === cat.connectorId);
    assert.ok(manifest, `Manifest exists for ${cat.connectorId}`);
    assert.equal(manifest.status, 'not_configured');
    assert.equal(manifest.adapterImplemented, false);
  }
});

test('Phase 10 Req 1: Fixture mode returns SIMULATED (never CONNECTED); missing credentials return NEEDS_SETUP; failed HTTP returns FAILED without fixture fallback', async () => {
  const weatherManifest = INITIAL_CONNECTOR_MANIFESTS.find((m) => m.id === 'conn-weather')!;

  // 1. Fixture mode -> SIMULATED
  const simRes = await testConnectorReal({ connector: weatherManifest, mode: 'mock' });
  assert.equal(simRes.status, 'simulated');
  assert.equal(simRes.evidenceClass, 'SIMULATED');

  // 2. Missing credentials on OAuth/PAT connector -> NEEDS_SETUP
  const githubManifest = INITIAL_CONNECTOR_MANIFESTS.find((m) => m.id === 'conn-github')!;
  const needsSetupRes = await testConnectorReal({ connector: githubManifest, mode: 'live' });
  assert.equal(needsSetupRes.status, 'needs_setup');
  assert.equal(needsSetupRes.ok, false);
  assert.equal(needsSetupRes.evidenceClass, 'NEEDS_SETUP');

  // 3. Upstream HTTP 503 error in live mode -> error/FAILED, never falls back to fixture
  const failRes = await testConnectorReal({
    connector: weatherManifest,
    mode: 'live',
    transport: async () => ({
      ok: false,
      status: 503,
      headers: {},
      text: 'Service Unavailable',
      json: { error: 'upstream_down' },
    }),
  });
  assert.equal(failRes.status, 'error');
  assert.equal(failRes.ok, false);
  assert.equal(failRes.evidenceClass, 'FAILED');

  // 4. Schema mismatch in live mode -> error/FAILED
  const badSchemaRes = await testConnectorReal({
    connector: weatherManifest,
    mode: 'live',
    transport: async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: '{"unexpected":true}',
      json: { unexpected: true }, // Missing current_weather
    }),
  });
  assert.equal(badSchemaRes.status, 'error');
  assert.equal(badSchemaRes.ok, false);
  assert.equal(badSchemaRes.evidenceClass, 'FAILED');
});

test('Phase 10 Req 2: Connection test, capability discovery, and tool invocation are strictly separated', async () => {
  const githubAdapter = getConnectorProviderAdapter('conn-github')!;
  assert.ok(githubAdapter);
  assert.equal(githubAdapter.adapterImplemented, true);

  const vault = new PassphraseWrapVault();
  const secretCode = 'phase10-gh-vault-passphrase';
  await vault.store(
    {
      keyId: 'vault_conn_github',
      label: 'GitHub Read-Only Token',
      provider: 'conn-github',
      plainKey: 'ghp_readonly_token_abc123456',
    },
    secretCode
  );
  await vault.unlock(secretCode);

  const readOnlyTransport = async (req: { url: string }) => {
    if (req.url.endsWith('/user')) {
      return {
        ok: true,
        status: 200,
        headers: { 'x-oauth-scopes': 'repo:read' },
        text: JSON.stringify({ login: 'octocat', id: 1 }),
        json: { login: 'octocat', id: 1 },
      };
    }
    throw new Error('Unexpected URL');
  };

  // Step 1: testConnection succeeds because /user works with token
  const connRes = await githubAdapter.testConnection({
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedScopes: ['repo:read'],
    transport: readOnlyTransport,
  });
  assert.equal(connRes.status, 'connected');
  assert.equal(connRes.evidenceClass, 'REAL');
  assert.equal(connRes.connectionTestProvesAllToolsWork, false);

  // Step 2: discoverCapabilities inspects actual scopes and marks issues tools unavailable when only repo:read is granted
  const capRes = await githubAdapter.discoverCapabilities({
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedScopes: ['repo:read'],
    transport: readOnlyTransport,
  });
  assert.equal(capRes.status, 'connected');
  assert.equal(capRes.allToolsAvailable, false);
  const listIssuesCap = capRes.tools.find((c) => c.toolName === 'list_issues')!;
  const createIssueCap = capRes.tools.find((c) => c.toolName === 'create_issue')!;
  assert.equal(listIssuesCap.available, false);
  assert.deepEqual(listIssuesCap.missingScopes, ['issues:read']);
  assert.equal(createIssueCap.available, false);
  assert.equal(createIssueCap.requiresApproval, true);

  // Step 3: invokeConnectorAdapterTool blocks list_issues when 'issues:read' scope is missing
  const invokeBlockedScope = await invokeConnectorAdapterTool('conn-github', {
    toolName: 'list_issues',
    args: { owner: 'octo', repo: 'hello' },
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedCapabilities: ['connector:conn-github:list_issues'],
    grantedScopes: ['repo:read'], // missing 'issues:read'
    transport: readOnlyTransport,
  });
  assert.equal(invokeBlockedScope.ok, false);
  assert.equal(invokeBlockedScope.status, 'missing_scope');
  assert.equal(invokeBlockedScope.evidenceClass, 'BLOCKED');
  assert.equal(invokeBlockedScope.error?.code, 'MISSING_OAUTH_SCOPE');
});

test('Phase 10 Req 3 & 5: Real adapter tool invocations, PolicyEngine, exact capability grant, approval requirement, pagination, rate limit, retry & verifier', async () => {
  globalConnectorRateLimiter.reset();
  clearConnectorIdempotencyCache();

  // 1. Weather live read tool + verifier
  const weatherRes = await invokeConnectorAdapterTool('conn-weather', {
    toolName: 'get_current_weather',
    args: { latitude: 35.68, longitude: 139.76 },
    mode: 'live',
    grantedCapabilities: ['connector:conn-weather:get_current_weather'],
    transport: async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: JSON.stringify({
        current_weather: { temperature: 19.4, windspeed: 8.2, weathercode: 1, time: '2026-11-03T12:00' },
      }),
      json: {
        current_weather: { temperature: 19.4, windspeed: 8.2, weathercode: 1, time: '2026-11-03T12:00' },
      },
    }),
  });
  assert.equal(weatherRes.ok, true);
  assert.equal(weatherRes.evidenceClass, 'REAL');
  assert.equal(weatherRes.verified, true);
  assert.equal((weatherRes.output as { temperatureC: number }).temperatureC, 19.4);

  // 2. Missing exact capability grant -> BLOCKED
  const deniedCapRes = await invokeConnectorAdapterTool('conn-weather', {
    toolName: 'get_current_weather',
    args: { latitude: 35.68, longitude: 139.76 },
    mode: 'live',
    grantedCapabilities: ['connector:conn-weather:other_tool'], // missing get_current_weather
  });
  assert.equal(deniedCapRes.ok, false);
  assert.equal(deniedCapRes.status, 'missing_capability');
  assert.equal(deniedCapRes.evidenceClass, 'BLOCKED');

  // 3. RSS/Atom real XML parser and tool invocation with pagination
  const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Blaize Engineering Blog</title>
        <item>
          <guid>post-101</guid>
          <title>Phase 10 Connectors</title>
          <link>https://example.com/post-101</link>
          <pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate>
        </item>
        <item>
          <guid>post-102</guid>
          <title>Time-Correct Cron</title>
          <link>https://example.com/post-102</link>
          <pubDate>Tue, 03 Nov 2026 11:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;
  const parsedFeed = parseRssOrAtomXml(sampleRssXml);
  assert.equal(parsedFeed.feedTitle, 'Blaize Engineering Blog');
  assert.equal(parsedFeed.items.length, 2);

  const rssToolRes = await invokeConnectorAdapterTool('conn-rss-atom', {
    toolName: 'read_feed_items',
    args: { feedUrl: 'https://example.com/feed.xml' },
    pagination: { pageSize: 1 },
    mode: 'live',
    grantedCapabilities: ['connector:conn-rss-atom:read_feed_items'],
    transport: async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: sampleRssXml,
    }),
  });
  assert.equal(rssToolRes.ok, true);
  assert.equal(rssToolRes.pagination?.hasMore, true);
  assert.equal(rssToolRes.pagination?.nextCursor, '1');

  // 4. Calendar ICS real RFC 5545 parser and tool invocation
  const sampleIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Team Schedule',
    'BEGIN:VEVENT',
    'UID:evt-1@blaize.local',
    'SUMMARY:Architecture Sync',
    'DTSTART:20261103T150000Z',
    'DTEND:20261103T160000Z',
    'LOCATION:Room 42',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const parsedIcs = parseIcsCalendarText(sampleIcs);
  assert.equal(parsedIcs.calendarName, 'Team Schedule');
  assert.equal(parsedIcs.events.length, 1);
  assert.equal(parsedIcs.events[0].summary, 'Architecture Sync');
  assert.equal(parsedIcs.events[0].dtstart, '20261103T150000Z');

  const icsRes = await invokeConnectorAdapterTool('conn-calendar-ics', {
    toolName: 'list_upcoming_events',
    args: { icsUrl: 'https://example.com/cal.ics' },
    mode: 'live',
    grantedCapabilities: ['connector:conn-calendar-ics:list_upcoming_events'],
    transport: async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: sampleIcs,
    }),
  });
  assert.equal(icsRes.ok, true);
  assert.equal((icsRes.output as { events: unknown[] }).events.length, 1);

  // 5. Scoped Local Folder real filesystem adapter & path traversal defense
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-phase10-folder-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'Hello from real scoped folder', 'utf8');

    const readOk = await invokeConnectorAdapterTool('conn-local-folder', {
      toolName: 'read_text_file',
      args: { relativePath: 'notes.txt' },
      mode: 'live',
      workspaceRoot: tmpDir,
      grantedCapabilities: ['connector:conn-local-folder:read_text_file'],
    });
    assert.equal(readOk.ok, true);
    assert.equal((readOk.output as { content: string }).content, 'Hello from real scoped folder');

    const traversalAttempt = await invokeConnectorAdapterTool('conn-local-folder', {
      toolName: 'read_text_file',
      args: { relativePath: '../../etc/passwd' },
      mode: 'live',
      workspaceRoot: tmpDir,
      grantedCapabilities: ['connector:conn-local-folder:read_text_file'],
    });
    assert.equal(traversalAttempt.ok, false);
    assert.equal(traversalAttempt.status, 'blocked_by_rule');
    assert.equal(traversalAttempt.evidenceClass, 'BLOCKED');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 6. GitHub write tool requires single-use ScopedApprovalToken
  const vault = new PassphraseWrapVault();
  const secretCode = 'phase10-gh-write-pass';
  await vault.store(
    {
      keyId: 'vault_conn_github',
      label: 'GitHub Write Token',
      provider: 'conn-github',
      plainKey: 'ghp_write_token_xyz987654',
    },
    secretCode
  );
  await vault.unlock(secretCode);

  const writeArgs = { owner: 'octo', repo: 'hello', title: 'Bug report', body: 'Details' };
  const noApprovalWrite = await invokeConnectorAdapterTool('conn-github', {
    toolName: 'create_issue',
    args: writeArgs,
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedCapabilities: ['connector:conn-github:create_issue'],
    grantedScopes: ['issues:write'],
  });
  assert.equal(noApprovalWrite.ok, false);
  assert.equal(noApprovalWrite.status, 'needs_approval');
  assert.equal(noApprovalWrite.evidenceClass, 'WAITING_FOR_APPROVAL');

  // Issue single-use approval token matching exact tool, target & args
  const token = globalApprovalTokenStore.issueToken({
    toolOrActionName: 'connector.create_issue',
    target: 'conn-github:create_issue',
    payload: writeArgs,
    profileId: 'personal',
    ttlMs: 60_000,
  });

  const approvedWrite = await invokeConnectorAdapterTool('conn-github', {
    toolName: 'create_issue',
    args: writeArgs,
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedCapabilities: ['connector:conn-github:create_issue'],
    grantedScopes: ['issues:write'],
    approvalToken: token,
    transport: async () => ({
      ok: true,
      status: 201,
      headers: {},
      text: JSON.stringify({ number: 42, html_url: 'https://github.com/octo/hello/issues/42', state: 'open' }),
      json: { number: 42, html_url: 'https://github.com/octo/hello/issues/42', state: 'open' },
    }),
  });
  assert.equal(approvedWrite.ok, true);
  assert.equal(approvedWrite.evidenceClass, 'REAL');
  assert.equal((approvedWrite.output as { issueNumber: number }).issueNumber, 42);

  // Re-using the same single-use approval token must fail
  const replayWrite = await invokeConnectorAdapterTool('conn-github', {
    toolName: 'create_issue',
    args: writeArgs,
    mode: 'live',
    vault,
    vaultKeyId: 'vault_conn_github',
    grantedCapabilities: ['connector:conn-github:create_issue'],
    grantedScopes: ['issues:write'],
    approvalToken: token,
  });
  assert.equal(replayWrite.ok, false);
  assert.equal(replayWrite.status, 'needs_approval');
  assert.equal(replayWrite.evidenceClass, 'WAITING_FOR_APPROVAL');

  // 7. Retry/backoff on transient HTTP 503 for idempotent read tool
  let attempts = 0;
  const retryWeatherRes = await invokeConnectorAdapterTool('conn-weather', {
    toolName: 'get_current_weather',
    args: { latitude: 40.71, longitude: -74.0 },
    mode: 'live',
    grantedCapabilities: ['connector:conn-weather:get_current_weather'],
    transport: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, status: 503, headers: {}, text: 'Transient timeout' };
      }
      return {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          current_weather: { temperature: 14.2, windspeed: 11.0, weathercode: 0, time: '2026-11-03T12:00' },
        }),
        json: {
          current_weather: { temperature: 14.2, windspeed: 11.0, weathercode: 0, time: '2026-11-03T12:00' },
        },
      };
    },
  });
  assert.equal(retryWeatherRes.ok, true);
  assert.equal(retryWeatherRes.attempts, 2);

  // 8. Rate limiter enforcement
  globalConnectorRateLimiter.reset();
  const weatherAdapter = getConnectorProviderAdapter('conn-weather')!;
  const limitPerMin = weatherAdapter.toolSchemas.get_current_weather.rateLimitPerMinute;
  const nowMs = Date.now();
  for (let i = 0; i < limitPerMin; i++) {
    globalConnectorRateLimiter.checkAndConsume('conn-weather:get_current_weather', limitPerMin, nowMs);
  }
  const rlDenied = await invokeConnectorAdapterTool('conn-weather', {
    toolName: 'get_current_weather',
    args: { latitude: 40.71, longitude: -74.0 },
    mode: 'live',
    grantedCapabilities: ['connector:conn-weather:get_current_weather'],
  });
  assert.equal(rlDenied.ok, false);
  assert.equal(rlDenied.error?.code, 'RATE_LIMIT_EXCEEDED');
  globalConnectorRateLimiter.reset();
});

// ============================================================================
// 2. OAUTH 2.0 PKCE + ENCRYPTED VAULT LIFECYCLE (Req 4)
// ============================================================================

test('Phase 10 Req 4: OAuth PKCE S256 challenge, state & redirectUri validation, encrypted Vault storage, token refresh & revocation', async () => {
  const vault = new PassphraseWrapVault();
  const secretCode = 'phase10-vault-passphrase-secret';
  await vault.unlock(secretCode);
  const oauth = new OAuthPkceLifecycleManager(vault);

  // 1. Reject insecure non-loopback HTTP redirect URI
  const badRedirect = oauth.startFlow({
    connectorId: 'conn-google-workspace',
    clientId: 'client-123',
    redirectUri: 'http://evil.example.com/callback',
    requestedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  assert.equal(badRedirect.ok, false);
  assert.equal(badRedirect.error?.code, 'OAUTH_REDIRECT_INVALID');

  // 2. Start valid PKCE S256 session
  const authStart = oauth.startFlow({
    connectorId: 'conn-google-workspace',
    clientId: 'client-123',
    redirectUri: 'http://127.0.0.1:3000/api/connectors/oauth/callback',
    requestedScopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    nowEpochMs: 1_700_000_000_000,
  });

  assert.equal(authStart.ok, true);
  assert.equal(authStart.codeChallengeMethod, 'S256');
  const expectedChallenge = crypto
    .createHash('sha256')
    .update(authStart.codeVerifier!, 'ascii')
    .digest('base64url');
  assert.equal(authStart.codeChallenge, expectedChallenge);
  assert.ok(authStart.authorizationUrl!.includes(`code_challenge=${encodeURIComponent(expectedChallenge)}`));

  // 3. Reject state mismatch
  const wrongStateRes = await oauth.exchangeCodeForTokens({
    state: 'wrong-state-token',
    code: 'auth-code-xyz',
    redirectUri: 'http://127.0.0.1:3000/api/connectors/oauth/callback',
    vaultSecretCode: secretCode,
    transport: async () => ({ ok: true, status: 200, headers: {}, text: '{}' }),
  });
  assert.equal(wrongStateRes.ok, false);
  assert.equal(wrongStateRes.error?.code, 'OAUTH_STATE_INVALID');

  // 4. Exchange callback code and store secrets ONLY in Phase 3 encrypted vault
  const exchangeRes = await oauth.exchangeCodeForTokens({
    state: authStart.state!,
    code: 'auth-code-xyz',
    redirectUri: 'http://127.0.0.1:3000/api/connectors/oauth/callback',
    vaultSecretCode: secretCode,
    nowEpochMs: 1_700_000_010_000,
    transport: async (req) => {
      assert.ok(req.body?.includes(`code_verifier=${encodeURIComponent(authStart.codeVerifier!)}`));
      return {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          access_token: 'ya29.secret_access_token_1',
          refresh_token: '1//secret_refresh_token_1',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly',
          token_type: 'Bearer',
        }),
        json: {
          access_token: 'ya29.secret_access_token_1',
          refresh_token: '1//secret_refresh_token_1',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly',
          token_type: 'Bearer',
        },
      };
    },
  });

  assert.equal(exchangeRes.ok, true);
  assert.equal(exchangeRes.metadata?.connectorId, 'conn-google-workspace');
  assert.deepEqual(exchangeRes.metadata?.grantedScopes, [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);

  // Replaying the same state must fail (single-use state)
  const replayStateRes = await oauth.exchangeCodeForTokens({
    state: authStart.state!,
    code: 'auth-code-xyz',
    redirectUri: 'http://127.0.0.1:3000/api/connectors/oauth/callback',
    vaultSecretCode: secretCode,
    transport: async () => ({ ok: true, status: 200, headers: {}, text: '{}' }),
  });
  assert.equal(replayStateRes.ok, false);
  assert.equal(replayStateRes.error?.code, 'OAUTH_STATE_INVALID');

  // 5. Inspect scopes without exposing raw token
  const scopeInspection = oauth.inspectScopes('conn-google-workspace', [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ]);
  assert.equal(scopeInspection.authenticated, true);
  assert.deepEqual(scopeInspection.missingScopes, ['https://www.googleapis.com/auth/gmail.send']);
  assert.equal(scopeInspection.hasAllRequiredScopes, false);

  // 6. Refresh access token and update encrypted Vault record
  const refreshRes = await oauth.refreshAccessToken({
    connectorId: 'conn-google-workspace',
    clientId: 'client-123',
    vaultSecretCode: secretCode,
    nowEpochMs: 1_700_003_600_000,
    transport: async (req) => {
      assert.ok(req.body?.includes('grant_type=refresh_token'));
      assert.ok(req.body?.includes(encodeURIComponent('1//secret_refresh_token_1')));
      return {
        ok: true,
        status: 200,
        headers: {},
        text: JSON.stringify({
          access_token: 'ya29.secret_access_token_2_rotated',
          refresh_token: '1//secret_refresh_token_2_rotated',
          expires_in: 3600,
        }),
        json: {
          access_token: 'ya29.secret_access_token_2_rotated',
          refresh_token: '1//secret_refresh_token_2_rotated',
          expires_in: 3600,
        },
      };
    },
  });
  assert.equal(refreshRes.ok, true);

  let rotatedTokenInVault = '';
  await vault.useForRequest('oauth_access_conn-google-workspace', async (plain) => {
    rotatedTokenInVault = plain;
    return true;
  });
  assert.equal(rotatedTokenInVault, 'ya29.secret_access_token_2_rotated');

  // 7. Revoke credentials and purge from Vault
  let providerRevokeCalled = false;
  const revokeRes = await oauth.revokeCredentials({
    connectorId: 'conn-google-workspace',
    vaultSecretCode: secretCode,
    transport: async () => {
      providerRevokeCalled = true;
      return { ok: true, status: 200, headers: {}, text: '' };
    },
  });
  assert.equal(revokeRes.ok, true);
  assert.equal(revokeRes.revokedInVault, true);
  assert.equal(revokeRes.revokedUpstream, true);
  assert.equal(providerRevokeCalled, true);

  const afterRevokeScope = oauth.inspectScopes('conn-google-workspace', [
    'https://www.googleapis.com/auth/calendar.readonly',
  ]);
  assert.equal(afterRevokeScope.authenticated, false);
});

// ============================================================================
// 3. CRON PARSING, TIMEZONES & DAYLIGHT SAVING TRANSITIONS (Reqs 7, 8, 12)
// ============================================================================

test('Phase 10 Req 7 & 8: 5-field cron parser and IANA timezone conversions', () => {
  assert.equal(isValidIanaTimeZone('America/New_York'), true);
  assert.equal(isValidIanaTimeZone('Europe/London'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('Invalid/No_Such_Zone'), false);

  const parsed = parseCronExpression('15,45 9-17/4 * * 1-5');
  assert.deepEqual([...parsed.minutes], [15, 45]);
  assert.deepEqual([...parsed.hours], [9, 13, 17]);
  assert.deepEqual([...parsed.daysOfWeek], [1, 2, 3, 4, 5]);

  // Verify no hardcoded 2026-10-29 dates: compute relative to an explicit reference clock in 2027
  const refTime = new Date('2027-06-14T12:00:00.000Z'); // Monday
  const runs = computeNextRunsInTimeZone({
    cronExpression: '0 9 * * 1-5', // 09:00 local Mon-Fri
    timeZone: 'America/New_York', // EDT is UTC-4 in June -> 13:00Z
    fromTime: refTime,
    count: 3,
  });

  assert.equal(runs.length, 3);
  assert.equal(runs[0].utcIso, '2027-06-14T13:00:00.000Z');
  assert.equal(runs[1].utcIso, '2027-06-15T13:00:00.000Z');
  assert.equal(runs[2].utcIso, '2027-06-16T13:00:00.000Z');
  assert.equal(runs[0].timeZone, 'America/New_York');
});

test('Phase 10 Req 8 & 12: Daylight-Saving Time (DST) Spring-Forward skipped hour and Fall-Back repeated hour', () => {
  // 1. US Spring-Forward 2026: Sunday, March 8, 2026 in America/New_York
  // At 02:00 local (07:00Z), clocks jump from 01:59 EST (UTC-5) to 03:00 EDT (UTC-4).
  // Therefore 02:30 local does NOT exist on 2026-03-08.
  const beforeSpringForward = new Date('2026-03-08T06:00:00.000Z'); // 01:00 EST

  // Policy A: strict_skip -> skips nonexistent 2026-03-08 02:30 and runs on 2026-03-09 02:30 EDT (06:30Z)
  const strictSkipRuns = computeNextRunsInTimeZone({
    cronExpression: '30 2 * * *',
    timeZone: 'America/New_York',
    fromTime: beforeSpringForward,
    count: 2,
    dstSpringForwardPolicy: 'strict_skip',
  });
  assert.equal(strictSkipRuns[0].utcIso, '2026-03-09T06:30:00.000Z');
  assert.equal(strictSkipRuns[0].localWallClockIso, '2026-03-09T02:30:00');

  // Policy B: shift_forward -> shifts nonexistent 2026-03-08 02:30 forward into the first valid minute after transition (03:00 EDT = 07:00Z)
  const shiftedRuns = computeNextRunsInTimeZone({
    cronExpression: '30 2 * * *',
    timeZone: 'America/New_York',
    fromTime: beforeSpringForward,
    count: 2,
    dstSpringForwardPolicy: 'shift_forward',
  });
  assert.equal(shiftedRuns[0].utcIso, '2026-03-08T07:00:00.000Z');
  assert.equal(shiftedRuns[1].utcIso, '2026-03-09T06:30:00.000Z');

  // 2. US Fall-Back 2026: Sunday, November 1, 2026 in America/New_York
  // Clocks fall back at 02:00 EDT:
  //   First 01:30 occurs at 05:30:00.000Z (EDT, UTC-4)
  //   Second 01:30 occurs at 06:30:00.000Z (EST, UTC-5)
  // A daily job at 01:30 (`30 1 * * *`) MUST run only ONCE on 2026-11-01 (at 05:30Z) and next on 2026-11-02 (at 06:30Z).
  const beforeFallBack = new Date('2026-11-01T04:50:00.000Z'); // 00:50 EDT
  const fallBackRuns = computeNextRunsInTimeZone({
    cronExpression: '30 1 * * *',
    timeZone: 'America/New_York',
    fromTime: beforeFallBack,
    count: 2,
  });
  assert.equal(fallBackRuns[0].utcIso, '2026-11-01T05:30:00.000Z', 'Fires on first occurrence of 01:30 local');
  assert.equal(
    fallBackRuns[1].utcIso,
    '2026-11-02T06:30:00.000Z',
    'Does NOT duplicate-fire on the second 01:30 local hour an hour later'
  );
});

// ============================================================================
// 4. DURABLE SCHEDULER: PERSISTENCE, IDEMPOTENCY, MISSED RUNS, POLICY ENGINE (Reqs 9, 10, 11, 12)
// ============================================================================

test('Phase 10 Req 9, 10, 11 & 12: DurableSchedulerEngine persistence, restart recovery, timezone updates, idempotency, missed-run policies, and PolicyEngine re-entry', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-phase10-sched-'));
  const stateFilePath = path.join(tmpDir, 'scheduler_state.json');

  try {
    const engine1 = new DurableSchedulerEngine({ stateFilePath });
    const createTimeMs = new Date('2026-11-03T08:00:00.000Z').getTime();

    assert.equal(
      engine1.getPowerOffCapabilities().canExecuteWhilePoweredOff,
      false,
      'Must never claim local jobs run while powered off'
    );

    // Create a schedule (verify default missedRunPolicy is 'skip')
    const sched = engine1.registerSchedule({
      id: 'sched-weather-brief',
      title: 'Morning Weather Check',
      prompt: 'Check London weather',
      cronExpression: '0 9 * * *',
      timeZone: 'UTC',
      enabled: true,
      risk: 'read',
      idempotent: true,
      requiresApprovalOrSensitive: false,
      requestedCapabilities: ['connector:conn-weather:get_current_weather'],
      targetConnectorId: 'conn-weather',
      targetToolName: 'get_current_weather',
      targetToolArgs: { latitude: 51.5, longitude: -0.12 },
      fromTime: createTimeMs,
    });

    assert.equal(sched.missedRunPolicy, 'skip', 'Default missed-run policy must be skip');
    assert.equal(sched.nextRunUtcIso, '2026-11-03T09:00:00.000Z');

    // Timezone change recalculates nextRunUtcIso accurately
    const updatedTz = engine1.updateScheduleTimeZone(
      'sched-weather-brief',
      'America/New_York', // EST is UTC-5 on Nov 3 -> 09:00 EST = 14:00Z
      createTimeMs
    );
    assert.equal(updatedTz.timeZone, 'America/New_York');
    assert.equal(updatedTz.nextRunUtcIso, '2026-11-03T14:00:00.000Z');

    // Switch back to UTC for slot execution tests
    engine1.updateScheduleTimeZone('sched-weather-brief', 'UTC', createTimeMs);

    // Restart recovery: load a second DurableSchedulerEngine from the same disk file
    const engine2 = new DurableSchedulerEngine({ stateFilePath });
    const recovered = engine2.getSchedule('sched-weather-brief')!;
    assert.ok(recovered);
    assert.equal(recovered.nextRunUtcIso, '2026-11-03T09:00:00.000Z');

    // Execute the 09:00Z slot through AgentRuntime + PolicyEngine
    let handlerCalls = 0;
    const execTimeMs = new Date('2026-11-03T09:00:05.000Z').getTime();
    const runRecord1 = await engine2.executeSlotAtRuntime({
      scheduleId: 'sched-weather-brief',
      slotUtcIso: '2026-11-03T09:00:00.000Z',
      nowEpochMs: execTimeMs,
      runtimeCeilingCapabilities: ['connector:conn-weather:get_current_weather'],
      executor: async () => {
        handlerCalls += 1;
        return { ok: true, summary: 'London 12C clear' };
      },
    });

    assert.equal(runRecord1.status, 'done');
    assert.equal(runRecord1.reenteredAgentRuntime, true);
    assert.equal(runRecord1.evaluatedByPolicyEngine, true);
    assert.equal(handlerCalls, 1);

    // Duplicate prevention: re-triggering the exact same slot (even on a restarted engine3) returns deduplicated without calling handler
    const engine3 = new DurableSchedulerEngine({ stateFilePath });
    const dupRecord = await engine3.executeSlotAtRuntime({
      scheduleId: 'sched-weather-brief',
      slotUtcIso: '2026-11-03T09:00:00.000Z',
      nowEpochMs: new Date('2026-11-03T09:01:00.000Z').getTime(),
      runtimeCeilingCapabilities: ['connector:conn-weather:get_current_weather'],
      executor: async () => {
        handlerCalls += 1;
        return { ok: true, summary: 'Should not run twice' };
      },
    });
    assert.equal(dupRecord.status, 'deduplicated');
    assert.equal(handlerCalls, 1, 'Idempotency key must prevent duplicate execution across restarts');

    // Missed-run reconciliation:
    // Suppose machine slept from Nov 3 09:05Z until Nov 6 10:00Z (missed Nov 4, Nov 5, Nov 6 09:00Z).
    // With default missedRunPolicy = 'skip', missed slot is skipped and nextRun advances to Nov 7 09:00Z.
    const wakeTimeMs = new Date('2026-11-06T10:00:00.000Z').getTime();
    const reconcileSkip = await engine3.reconcileMissedRuns({
      nowEpochMs: wakeTimeMs,
      runtimeCeilingCapabilities: ['connector:conn-weather:get_current_weather'],
      executor: async () => {
        handlerCalls += 1;
        return { ok: true, summary: 'Should not run on skip policy' };
      },
    });
    assert.deepEqual(reconcileSkip.skippedScheduleIds, ['sched-weather-brief']);
    assert.equal(engine3.getSchedule('sched-weather-brief')!.nextRunUtcIso, '2026-11-07T09:00:00.000Z');
    assert.equal(handlerCalls, 1);

    // Optional 'run_when_back' policy: executes ONCE when machine wakes up
    engine3.registerSchedule({
      id: 'sched-run-once-back',
      title: 'Catch-up Digest',
      prompt: 'Fetch RSS digest',
      cronExpression: '0 9 * * *',
      timeZone: 'UTC',
      enabled: true,
      missedRunPolicy: 'run_when_back',
      risk: 'read',
      idempotent: true,
      requiresApprovalOrSensitive: false,
      requestedCapabilities: ['connector:conn-rss-atom:read_feed_items'],
      fromTime: new Date('2026-11-03T08:00:00.000Z').getTime(),
    });

    let catchupCalls = 0;
    const reconcileCatchup = await engine3.reconcileMissedRuns({
      nowEpochMs: wakeTimeMs,
      runtimeCeilingCapabilities: ['connector:conn-rss-atom:read_feed_items'],
      executor: async () => {
        catchupCalls += 1;
        return { ok: true, summary: 'Ran once upon wake' };
      },
    });
    assert.deepEqual(reconcileCatchup.executedOnceScheduleIds, ['sched-run-once-back']);
    assert.equal(catchupCalls, 1, 'run_when_back must execute at most once across multiple missed slots');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 10 Req 11 & 12: Scheduled jobs cannot widen permissions or bypass approval for write/spend actions, and record failure notifications on exhausted retries', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-phase10-sec-'));
  const stateFilePath = path.join(tmpDir, 'scheduler_sec.json');

  try {
    const engine = new DurableSchedulerEngine({ stateFilePath });
    const nowMs = new Date('2026-11-03T08:00:00.000Z').getTime();

    // 1. Schedule attempting to use a capability outside runtimeCeilingCapabilities -> blocked_by_policy
    engine.registerSchedule({
      id: 'sched-widened-cap',
      title: 'Widened Capability Attempt',
      prompt: 'Try ungranted capability',
      cronExpression: '0 9 * * *',
      timeZone: 'UTC',
      enabled: true,
      risk: 'read',
      idempotent: true,
      requiresApprovalOrSensitive: false,
      requestedCapabilities: ['connector:conn-github:list_issues', 'connector:conn-github:admin_org'],
      fromTime: nowMs,
    });

    const widenedRes = await engine.executeSlotAtRuntime({
      scheduleId: 'sched-widened-cap',
      slotUtcIso: '2026-11-03T09:00:00.000Z',
      nowEpochMs: new Date('2026-11-03T09:00:01.000Z').getTime(),
      runtimeCeilingCapabilities: ['connector:conn-github:list_issues'], // admin_org not granted!
      executor: async () => ({ ok: true, summary: 'Should never run' }),
    });
    assert.equal(widenedRes.status, 'blocked_by_policy');

    // 2. Approval-required scheduled write operation pauses in waiting_for_approval even if staleApprovalToken was attached
    const staleToken = globalApprovalTokenStore.issueToken({
      toolOrActionName: 'connector.create_issue',
      target: 'conn-github:create_issue',
      payload: {},
      profileId: 'personal',
    });

    engine.registerSchedule({
      id: 'sched-write-issue',
      title: 'Scheduled GitHub Issue Creation',
      prompt: 'Create issue automatically',
      cronExpression: '0 10 * * *',
      timeZone: 'UTC',
      enabled: true,
      risk: 'write',
      idempotent: false,
      requiresApprovalOrSensitive: true,
      requestedCapabilities: ['connector:conn-github:create_issue'],
      targetConnectorId: 'conn-github',
      targetToolName: 'create_issue',
      staleApprovalToken: staleToken,
      fromTime: nowMs,
    });

    const approvalRequiredRes = await engine.executeSlotAtRuntime({
      scheduleId: 'sched-write-issue',
      slotUtcIso: '2026-11-03T10:00:00.000Z',
      nowEpochMs: new Date('2026-11-03T10:00:01.000Z').getTime(),
      runtimeCeilingCapabilities: ['connector:conn-github:create_issue'],
      executor: async () => ({ ok: true, summary: 'Should wait for fresh user approval' }),
    });
    assert.equal(approvalRequiredRes.status, 'waiting_for_approval');
    assert.equal(approvalRequiredRes.strippedStaleApprovalToken, true);

    // 3. Idempotent read task retries with backoff on failure and emits failure notification when exhausted
    engine.registerSchedule({
      id: 'sched-failing-read',
      title: 'Failing Upstream Read',
      prompt: 'Fetch weather with retries',
      cronExpression: '0 11 * * *',
      timeZone: 'UTC',
      enabled: true,
      risk: 'read',
      idempotent: true,
      requiresApprovalOrSensitive: false,
      requestedCapabilities: ['connector:conn-weather:get_current_weather'],
      retryPolicy: { maxAttempts: 3, baseDelayMs: 5 },
      fromTime: nowMs,
    });

    let readAttempts = 0;
    const failRun = await engine.executeSlotAtRuntime({
      scheduleId: 'sched-failing-read',
      slotUtcIso: '2026-11-03T11:00:00.000Z',
      nowEpochMs: new Date('2026-11-03T11:00:01.000Z').getTime(),
      runtimeCeilingCapabilities: ['connector:conn-weather:get_current_weather'],
      executor: async () => {
        readAttempts += 1;
        return { ok: false, summary: 'Upstream 502 Bad Gateway' };
      },
    });
    assert.equal(failRun.status, 'failed');
    assert.equal(readAttempts, 3, 'Initial attempt + 2 retries for idempotent read task');
    assert.equal(engine.getFailureNotifications().length >= 1, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
