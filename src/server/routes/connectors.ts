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
      requestedScopes: string[];
      createdAt: number;
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
    if (!clientId || typeof clientId !== 'string') {
      res.status(400).json({ ok: false, error: 'User Client ID is required for OAuth setup.' });
      return;
    }

    const effectiveRedirectUri =
      redirectUri || `${req.protocol}://${req.get('host')}/api/connectors/oauth/callback`;

    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(effectiveRedirectUri);
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid redirectUri format.' });
      return;
    }

    const rHost = parsedRedirect.hostname.toLowerCase();
    if (
      parsedRedirect.protocol !== 'https:' &&
      !(parsedRedirect.protocol === 'http:' && (rHost === 'localhost' || rHost === '127.0.0.1'))
    ) {
      res.status(400).json({
        ok: false,
        error: 'OAuth redirectUri must use HTTPS or localhost loopback.',
      });
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
      provider: String(provider || 'google'),
      clientId: clientId.trim(),
      redirectUri: effectiveRedirectUri,
      requestedScopes,
      createdAt: Date.now(),
    });

    // Prune stale sessions older than 15 minutes
    for (const [st, sess] of oauthSessions.entries()) {
      if (Date.now() - sess.createdAt > 15 * 60 * 1000) {
        oauthSessions.delete(st);
      }
    }

    let authUrl = '';
    if (provider === 'google') {
      const scopeStr = encodeURIComponent(
        (requestedScopes.length > 0 ? requestedScopes : ['https://www.googleapis.com/auth/drive.readonly']).join(' ')
      );
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(
        clientId.trim()
      )}&redirect_uri=${encodeURIComponent(
        effectiveRedirectUri
      )}&scope=${scopeStr}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256&access_type=offline&prompt=consent`;
    } else if (provider === 'microsoft') {
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
      provider,
      state,
      authUrl,
      redirectUri: effectiveRedirectUri,
      message: 'OAuth PKCE session created. Authorize in popup/browser with user-supplied client credentials.',
    });
  });

  router.get('/connectors/oauth/callback', (req, res) => {
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

      const vaultPassphrase =
        typeof secretCode === 'string' && secretCode.trim()
          ? secretCode.trim()
          : 'blaize-default-server-vault-passphrase';

      await serverVault.store(
        {
          keyId: `oauth_access_${session.provider}`,
          label: `${session.provider} OAuth Access Token`,
          provider: session.provider,
          plainKey: accessToken,
        },
        vaultPassphrase
      );

      if (tokenJson && typeof tokenJson.refresh_token === 'string' && tokenJson.refresh_token.trim()) {
        await serverVault.store(
          {
            keyId: `oauth_refresh_${session.provider}`,
            label: `${session.provider} OAuth Refresh Token`,
            provider: session.provider,
            plainKey: tokenJson.refresh_token.trim(),
          },
          vaultPassphrase
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
