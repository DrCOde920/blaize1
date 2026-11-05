/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hardened Connectors Proxy & OAuth Handler (`src/server/routes/connectors.ts`)
 *
 * Requirements:
 * - Enforce ALLOWED_CONNECTOR_HOSTS per connector (each connector reaches only its own hosts)
 * - Do not accept arbitrary client headers. Server adds credentials from the vault by handle.
 * - Resolve DNS on the server and block private, loopback, link-local, multicast and metadata addresses
 *   (including IPv6, IPv4-mapped IPv6, decimal, hex, and octal forms).
 * - Pin resolved IP, follow redirects manually (max 3 hops), re-validate every hop, cap size & time.
 * - OAuth PKCE flow handlers with vault storage.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { executeSsrfProtectedFetch } from '../middleware/ssrf';
import { PassphraseWrapVault } from '../../packages/vault/index';
import { getGlobalDurableDb } from '../../packages/storage/index';
import {
  globalSecretCodeAttemptLimiter,
  normalizeExecutionTiming,
} from '../middleware/lockout';
import { isAllowedOrigin, isAllowedHost } from '../config';
import { globalPolicyEngine } from '../../packages/trust/index';

function escapeHtml(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const CONNECTOR_ALLOWED_HOSTS: Record<string, string[]> = {
  'conn-github': ['api.github.com'],
  'conn-open-meteo': ['api.open-meteo.com'],
  'conn-wikipedia': ['en.wikipedia.org'],
  'conn-telegram': ['api.telegram.org'],
  'conn-slack': ['slack.com'],
  'conn-discord': ['discord.com'],
  'conn-notion': ['api.notion.com'],
  'conn-linear': ['api.linear.app'],
  'conn-todoist': ['api.todoist.com'],
  'conn-google-drive': ['www.googleapis.com', 'accounts.google.com', 'oauth2.googleapis.com'],
  'conn-microsoft-graph': ['graph.microsoft.com', 'login.microsoftonline.com'],
  'google': ['www.googleapis.com', 'accounts.google.com', 'oauth2.googleapis.com'],
  'microsoft': ['graph.microsoft.com', 'login.microsoftonline.com'],
};

export function createConnectorsRouter(vaultInstance?: PassphraseWrapVault): Router {
  const router = Router();
  const serverVault =
    vaultInstance ??
    new PassphraseWrapVault({
      idleTimeoutMs: 5 * 60 * 1000,
      backendKind: 'passphrase_aes_256_gcm',
      durableDb: getGlobalDurableDb(),
    });

  const oauthSessions = new Map<
    string,
    {
      state: string;
      codeVerifier: string;
      codeChallenge: string;
      provider: string;
      clientId: string;
      redirectUri: string;
      clientOrigin: string;
      requestedScopes: string[];
      createdAt: number;
      callbackReceived: boolean;
      receivedCode?: string;
      codeReceivedAt?: number;
    }
  >();

  // Hardened Connector Proxy Endpoint
  router.post('/connectors/proxy', async (req, res) => {
    try {
      const { connectorId, url, method = 'GET', body } = req.body || {};

      if (!connectorId || typeof connectorId !== 'string') {
        res.status(400).json({
          ok: false,
          error: 'Missing required `connectorId` for connector proxy request.',
        });
        return;
      }

      if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Missing or invalid target `url`.' });
        return;
      }

      const allowedHosts = CONNECTOR_ALLOWED_HOSTS[connectorId.trim()];
      if (!allowedHosts || allowedHosts.length === 0) {
        res.status(403).json({
          ok: false,
          error: `Connector '${connectorId}' is unknown or has no configured host allowlist.`,
        });
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid URL format.' });
        return;
      }

      const targetHost = parsed.hostname.toLowerCase();
      if (!allowedHosts.includes(targetHost)) {
        res.status(403).json({
          ok: false,
          error: `Host '${targetHost}' is not in the verified allowlist for connector '${connectorId}'. Connector may only access: [${allowedHosts.join(', ')}].`,
        });
        return;
      }

      // PROMPT 5: Mandatory PolicyEngine authorization boundary for side-effects
      const policyDecision = globalPolicyEngine.evaluateToolCall({
        callerId: (req.headers['x-caller-id'] as string) || req.ip || 'connector-client',
        toolName: `connector_${connectorId}`,
        target: url,
        riskClass: method === 'GET' ? 'read' : 'external_send',
        profileId: (req.headers['x-blaize-profile'] as any) || 'personal',
      });

      if (!policyDecision.allowed) {
        res.status(403).json({
          ok: false,
          errorCode: 'POLICY_VIOLATION',
          error: `PolicyEngine blocked connector request: ${policyDecision.reason || 'Action denied by policy.'}`,
          policyDecision,
        });
        return;
      }

      // Do NOT accept arbitrary client headers!
      // The server adds safe standard headers + credentials from the vault by connector handle.
      const safeHeaders: Record<string, string> = {
        'User-Agent': 'Blaize-Accountable-Desktop/3.0',
        Accept: 'application/json, text/plain, */*',
      };

      // Retrieve credentials from vault by connector handle/key
      const maskedList = serverVault.listMasked();
      const vaultKey =
        maskedList.find((m) => m.keyId === `oauth_access_${connectorId}`) ||
        maskedList.find((m) => m.keyId === connectorId);

      if (vaultKey && !serverVault.isLocked()) {
        await serverVault.useForRequest(
          vaultKey.keyId,
          async (secret) => {
            if (secret) {
              safeHeaders['Authorization'] = `Bearer ${secret}`;
            }
          },
          { estimatedCostUsd: 0 }
        );
      }

      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        safeHeaders['Content-Type'] = 'application/json';
      }

      // Execute fetch with server-side DNS resolution, IP pinning, manual redirects, size & time caps
      const response = await executeSsrfProtectedFetch(parsed.toString(), {
        method: String(method).toUpperCase(),
        headers: safeHeaders,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        allowedHostsChecker: (host) => allowedHosts.includes(host.toLowerCase()),
      });

      let responseData: unknown = response.dataText;
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          responseData = JSON.parse(response.dataText);
        } catch {
          responseData = response.dataText;
        }
      }

      res.status(response.status).json({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        data: responseData,
        resolvedIp: response.resolvedIp,
        hops: response.hops,
      });
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        error: `Connector proxy error: ${err?.message || 'Remote request failed.'}`,
      });
    }
  });

  // OAuth PKCE Flow Handlers
  router.post('/connectors/oauth/start', (req, res) => {
    const { provider, clientId, scopes = [], redirectUri } = req.body || {};
    if (!clientId || typeof clientId !== 'string' || !clientId.trim() || clientId.length > 256) {
      res.status(400).json({ ok: false, error: 'User Client ID is required for OAuth setup.' });
      return;
    }

    const validProvider = String(provider || 'google').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(validProvider)) {
      res.status(400).json({ ok: false, error: 'Invalid OAuth provider.' });
      return;
    }

    // PROMPT 5: Mandatory PolicyEngine authorization boundary for OAuth operations
    const callerId = (req.headers['x-caller-id'] as string) || req.ip || 'oauth-client';
    const policyDecision = globalPolicyEngine.evaluateAction({
      id: `oauth-start-${validProvider}-${Date.now()}`,
      kind: 'oauth_start',
      target: validProvider,
      riskClass: 'read',
      profileId: (req.headers['x-blaize-profile'] as any) || 'personal',
      callerId,
    });

    if (!policyDecision.allowed) {
      res.status(403).json({
        ok: false,
        errorCode: 'POLICY_VIOLATION',
        error: `PolicyEngine blocked OAuth start: ${policyDecision.reason || 'Action denied by policy.'}`,
        policyDecision,
      });
      return;
    }

    let effectiveRedirectUri = '';
    if (redirectUri && typeof redirectUri === 'string' && redirectUri.trim()) {
      let parsedRedirect: URL;
      try {
        parsedRedirect = new URL(redirectUri.trim());
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid redirectUri format.' });
        return;
      }

      const rHost = parsedRedirect.hostname.toLowerCase();
      const isLoopback = rHost === 'localhost' || rHost === '127.0.0.1' || rHost === '[::1]';
      if (
        parsedRedirect.protocol !== 'https:' &&
        !(parsedRedirect.protocol === 'http:' && isLoopback)
      ) {
        res.status(400).json({
          ok: false,
          error: 'OAuth redirectUri must use HTTPS or localhost loopback.',
        });
        return;
      }

      if (!isAllowedOrigin(parsedRedirect.origin) && !isLoopback) {
        res.status(400).json({
          ok: false,
          error: 'OAuth redirectUri origin is not in the allowed origins allowlist.',
        });
        return;
      }

      effectiveRedirectUri = parsedRedirect.toString();
    } else {
      const host = req.get('host') || '127.0.0.1:3000';
      if (!isAllowedHost(host)) {
        res.status(400).json({ ok: false, error: 'Host header is not in the allowed host allowlist.' });
        return;
      }
      const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      effectiveRedirectUri = `${proto}://${host}/api/connectors/oauth/callback`;
    }

    let clientOrigin: string;
    try {
      clientOrigin = new URL(effectiveRedirectUri).origin;
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid redirectUri origin.' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const requestedScopes: string[] = Array.isArray(scopes) ? scopes.map((s) => String(s)) : [];

    oauthSessions.set(state, {
      state,
      codeVerifier,
      codeChallenge,
      provider: validProvider,
      clientId: clientId.trim(),
      redirectUri: effectiveRedirectUri,
      clientOrigin,
      requestedScopes,
      createdAt: Date.now(),
      callbackReceived: false,
    });

    // Prune stale sessions older than 15 minutes
    for (const [st, sess] of oauthSessions.entries()) {
      if (Date.now() - sess.createdAt > 15 * 60 * 1000) {
        oauthSessions.delete(st);
      }
    }

    let authUrl = '';
    if (validProvider === 'google') {
      const scopeStr = encodeURIComponent(
        (requestedScopes.length > 0 ? requestedScopes : ['https://www.googleapis.com/auth/drive.readonly']).join(' ')
      );
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(
        clientId.trim()
      )}&redirect_uri=${encodeURIComponent(
        effectiveRedirectUri
      )}&scope=${scopeStr}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&access_type=offline&prompt=consent`;
    } else if (validProvider === 'microsoft') {
      const scopeStr = encodeURIComponent(
        (requestedScopes.length > 0 ? requestedScopes : ['Files.Read', 'Calendars.Read', 'Mail.Read']).join(' ')
      );
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(
        clientId.trim()
      )}&response_type=code&redirect_uri=${encodeURIComponent(
        effectiveRedirectUri
      )}&scope=${scopeStr}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    }

    res.status(200).json({
      ok: true,
      provider: validProvider,
      state,
      authUrl,
      redirectUri: effectiveRedirectUri,
      message: 'OAuth PKCE session created. Authorize in popup/browser with user-supplied client credentials.',
    });
  });

  router.get('/connectors/oauth/callback', (req, res) => {
    const cspNonce = crypto.randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${cspNonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const { state, code, error } = req.query;

    // Validate state parameter format (32 hex characters)
    if (!state || typeof state !== 'string' || !/^[a-f0-9]{32}$/i.test(state.trim())) {
      res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>OAuth Error</title></head><body><h3>OAuth Authorization Failed</h3><p>Invalid or missing OAuth state parameter.</p></body></html>`);
      return;
    }

    const stateKey = state.trim();
    const session = oauthSessions.get(stateKey);
    if (!session) {
      res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>OAuth Error</title></head><body><h3>OAuth Authorization Failed</h3><p>Invalid, forged, or expired OAuth state.</p></body></html>`);
      return;
    }

    // Replay attack prevention: single callback receipt allowed per state
    if (session.callbackReceived) {
      res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>OAuth Error</title></head><body><h3>OAuth Authorization Failed</h3><p>OAuth state has already been used (replay detected).</p></body></html>`);
      return;
    }

    session.callbackReceived = true;

    // Handle upstream OAuth error response safely without reflection
    if (error) {
      oauthSessions.delete(stateKey);
      const safeError = escapeHtml(String(error).slice(0, 100));
      res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>OAuth Failed</title></head><body><h3>OAuth Authorization Failed</h3><p>${safeError}</p><p>You may close this tab.</p></body></html>`);
      return;
    }

    // Validate code parameter (safe format, max length, no script injection characters)
    if (!code || typeof code !== 'string' || !code.trim() || code.length > 1024 || /[\r\n<>"']/.test(code)) {
      oauthSessions.delete(stateKey);
      res.status(400).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>OAuth Error</title></head><body><h3>OAuth Authorization Failed</h3><p>Invalid authorization code format.</p></body></html>`);
      return;
    }

    const safeCode = code.trim();
    session.receivedCode = safeCode;
    session.codeReceivedAt = Date.now();

    // Determine target origin: NEVER wildcard '*', always verified client origin
    const targetOrigin = session.clientOrigin;
    const safeTargetOrigin = isAllowedOrigin(targetOrigin) ? targetOrigin : 'http://127.0.0.1:3000';

    // Safely encode JSON payload preventing script closing tag breakout
    const payloadJson = JSON.stringify({
      type: 'blaize:oauth_code',
      state: session.state,
      code: safeCode,
    }).replace(/</g, '\\u003c');

    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authorization Succeeded</title>
</head>
<body>
  <h3>Authorization Succeeded</h3>
  <p>Returning to Blaize Desktop...</p>
  <script nonce="${cspNonce}">
    (function() {
      try {
        if (window.opener && window.opener !== window) {
          window.opener.postMessage(${payloadJson}, ${JSON.stringify(safeTargetOrigin)});
          window.close();
        }
      } catch (e) {
        console.error('Failed to notify opener window:', e);
      }
    })();
  </script>
</body>
</html>`);
  });

  router.post('/connectors/oauth/exchange', async (req, res) => {
    const startMs = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const { state, code, redirectUri, secretCode } = req.body || {};

    const session = oauthSessions.get(String(state || ''));
    if (!session) {
      await normalizeExecutionTiming(startMs, null);
      res.status(400).json({ ok: false, error: 'Invalid or expired OAuth state.' });
      return;
    }

    // Single-use state consumption
    oauthSessions.delete(String(state || ''));

    if (!code || typeof code !== 'string' || !code.trim()) {
      await normalizeExecutionTiming(startMs, null);
      res.status(400).json({ ok: false, error: 'Missing OAuth authorization code.' });
      return;
    }

    if (session.receivedCode && session.receivedCode !== code.trim()) {
      await normalizeExecutionTiming(startMs, null);
      res.status(400).json({ ok: false, error: 'OAuth authorization code mismatch.' });
      return;
    }

    if (redirectUri && redirectUri !== session.redirectUri) {
      await normalizeExecutionTiming(startMs, null);
      res.status(400).json({ ok: false, error: 'OAuth redirectUri mismatch.' });
      return;
    }


    // If secretCode provided, verify lockout
    if (secretCode) {
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
    }

    // PROMPT 5: Mandatory PolicyEngine authorization boundary for OAuth exchange
    const exchangeCallerId = (req.headers['x-caller-id'] as string) || req.ip || 'oauth-client';
    const exchangePolicy = globalPolicyEngine.evaluateAction({
      id: `oauth-exchange-${session.provider}-${Date.now()}`,
      kind: 'oauth_exchange',
      target: session.provider,
      riskClass: 'read',
      profileId: (req.headers['x-blaize-profile'] as any) || 'personal',
      callerId: exchangeCallerId,
    });

    if (!exchangePolicy.allowed) {
      await normalizeExecutionTiming(startMs, null);
      res.status(403).json({
        ok: false,
        errorCode: 'POLICY_VIOLATION',
        error: `PolicyEngine blocked OAuth exchange: ${exchangePolicy.reason || 'Action denied by policy.'}`,
        policyDecision: exchangePolicy,
      });
      return;
    }

    // PROMPT 3: Require genuinely verified owner-authenticated vault unlock before exchanging or saving OAuth credentials
    let verifiedPassphrase = '';
    if (!serverVault.isLocked()) {
      verifiedPassphrase = (serverVault as any).getUnlockedPassphrase?.() || '';
    }

    if (!verifiedPassphrase && typeof secretCode === 'string' && secretCode.trim()) {
      const unlocked = await serverVault.unlock(secretCode.trim());
      if (unlocked) {
        verifiedPassphrase = secretCode.trim();
      }
    }

    if (!verifiedPassphrase) {
      if (secretCode) {
        globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      }
      await normalizeExecutionTiming(startMs, null);
      res.status(401).json({
        ok: false,
        errorCode: 'VAULT_AUTHENTICATION_REQUIRED',
        error:
          'Vault must be unlocked by the verified owner before saving OAuth credentials. Provide a valid secret code.',
      });
      return;
    }

    const tokenEndpoint =
      session.provider === 'microsoft'
        ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
        : 'https://oauth2.googleapis.com/token';

    try {
      const formBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code.trim(),
        redirect_uri: session.redirectUri,
        client_id: session.clientId,
        code_verifier: session.codeVerifier,
      }).toString();

      const fetchResult = await executeSsrfProtectedFetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody,
        allowedHostsChecker: (host) =>
          host === 'oauth2.googleapis.com' ||
          host === 'login.microsoftonline.com' ||
          host === 'accounts.google.com',
      });

      const tokenJson = JSON.parse(fetchResult.dataText) as Record<string, unknown>;
      const accessToken =
        tokenJson && typeof tokenJson.access_token === 'string' ? tokenJson.access_token.trim() : '';

      if (fetchResult.status >= 400 || !accessToken) {
        await normalizeExecutionTiming(startMs, null);
        res.status(502).json({
          ok: false,
          provider: session.provider,
          status: 'error',
          error: `Upstream OAuth token exchange failed (HTTP ${fetchResult.status}).`,
        });
        return;
      }

      await serverVault.store(
        {
          keyId: `oauth_access_${session.provider}`,
          label: `${session.provider} OAuth Access Token`,
          provider: session.provider,
          plainKey: accessToken,
        },
        verifiedPassphrase
      );

      if (tokenJson && typeof tokenJson.refresh_token === 'string' && tokenJson.refresh_token.trim()) {
        await serverVault.store(
          {
            keyId: `oauth_refresh_${session.provider}`,
            label: `${session.provider} OAuth Refresh Token`,
            provider: session.provider,
            plainKey: tokenJson.refresh_token.trim(),
          },
          verifiedPassphrase
        );
      }

      if (secretCode) {
        globalSecretCodeAttemptLimiter.recordSuccess(clientIp);
      }

      const grantedScopes =
        tokenJson && typeof tokenJson.scope === 'string'
          ? tokenJson.scope.split(/[\s,]+/).filter(Boolean)
          : session.requestedScopes;

      await normalizeExecutionTiming(startMs, null);
      res.status(200).json({
        ok: true,
        provider: session.provider,
        status: 'authenticated',
        grantedScopes,
        storedInVaultKeyId: `oauth_access_${session.provider}`,
        expiresIn:
          tokenJson && typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600,
      });
    } catch (err: any) {
      if (secretCode) {
        globalSecretCodeAttemptLimiter.recordFailure(clientIp);
      }
      await normalizeExecutionTiming(startMs, null);
      res.status(502).json({
        ok: false,
        provider: session.provider,
        status: 'error',
        error: `OAuth token exchange failed: ${err?.message || 'Network error'}`,
      });
    }
  });

  return router;
}
