/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server Configuration & Launch Token Manager (`src/server/config.ts`)
 * - Manages cryptographically random per-launch authentication token (X-Blaize-Launch-Token)
 * - Strict exact-origin CORS allowlist check (no substring checks, no .run.app wildcard)
 * - Server-side rate limits and ceilings
 */

import crypto from 'node:crypto';

let currentLaunchToken = `blaize_launch_${crypto.randomBytes(16).toString('hex')}`;

export function getPerLaunchAuthToken(): string {
  return currentLaunchToken;
}

export function setPerLaunchAuthTokenForTesting(token: string): void {
  currentLaunchToken = token;
}

export function resetPerLaunchAuthToken(): string {
  currentLaunchToken = `blaize_launch_${crypto.randomBytes(16).toString('hex')}`;
  return currentLaunchToken;
}

export const SERVER_DEFAULTS = {
  maxPayloadSizeBytes: 65536, // 64 KB
  defaultTimeoutMs: 15000,
  maxTimeoutMs: 30000,
  minTimeoutMs: 100,
  metaModelRateLimitPerMin: 60,
  maxConnectorResponseSizeBytes: 524288, // 512 KB
  maxConnectorTimeoutMs: 12000,
  maxRedirectHops: 3,
  secretCodeMaxAttempts: 4,
  secretCodeLockoutBaseMs: 15000,
  secretCodeLockoutMaxMs: 300000,
  secretCodeMinExecutionMs: 150, // Constant-time response padding
};

/**
 * Exact-origin allowlist check.
 * Strictly verifies that the origin matches configured application origins or valid localhost ports.
 * Rejects unknown origins, never trusts a request just because it has no origin, and forbids wildcard matches.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin || typeof origin !== 'string') {
    return false;
  }
  const clean = origin.trim();
  if (!clean) {
    return false;
  }

  // Configured app origins via environment
  if (process.env.APP_URL && clean === process.env.APP_URL.trim()) {
    return true;
  }
  if (process.env.APP_ORIGIN && clean === process.env.APP_ORIGIN.trim()) {
    return true;
  }
  if (process.env.BLAIZE_ALLOWED_ORIGINS) {
    const list = process.env.BLAIZE_ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    if (list.includes(clean)) {
      return true;
    }
  }

  // Exact known deployment origins (no substring or wildcard match!)
  const exactProductionOrigins = new Set([
    'https://ais-dev-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app',
    'https://ais-pre-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app',
  ]);
  if (exactProductionOrigins.has(clean)) {
    return true;
  }

  // Exact localhost & loopback ports: http://localhost:PORT or http://127.0.0.1:PORT or http://[::1]:PORT
  const localhostRegex = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  if (localhostRegex.test(clean)) {
    return true;
  }

  return false;
}

/**
 * Validates whether the incoming Host header matches authorized local or production domains.
 * Prevents DNS rebinding and host-header injection attacks.
 */
export function isAllowedHost(host: string | undefined | null): boolean {
  if (!host || typeof host !== 'string') {
    return false;
  }
  const clean = host.trim().toLowerCase();
  if (!clean) {
    return false;
  }

  // Extract hostname component without port (supports IPv6 like [::1]:3000)
  let hostname = clean;
  if (clean.startsWith('[')) {
    const closeBracket = clean.indexOf(']');
    if (closeBracket !== -1) {
      hostname = clean.slice(0, closeBracket + 1);
    }
  } else {
    hostname = clean.replace(/:\d+$/, '');
  }

  // Exact loopback and localhost hostnames
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  ) {
    return true;
  }

  // Configured app hosts via environment
  if (process.env.APP_URL) {
    try {
      const u = new URL(process.env.APP_URL.trim());
      if (u.host.toLowerCase() === clean || u.hostname.toLowerCase() === hostname) {
        return true;
      }
    } catch {}
  }
  if (process.env.APP_ORIGIN) {
    try {
      const u = new URL(process.env.APP_ORIGIN.trim());
      if (u.host.toLowerCase() === clean || u.hostname.toLowerCase() === hostname) {
        return true;
      }
    } catch {}
  }
  if (process.env.NG_ALLOWED_HOSTS) {
    const list = process.env.NG_ALLOWED_HOSTS.split(',').map((s) => s.trim().toLowerCase());
    if (list.includes(clean) || list.includes(hostname)) {
      return true;
    }
  }

  // Exact known deployment hosts
  const exactProductionHosts = new Set([
    'ais-dev-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app',
    'ais-pre-6mhw74jqog4clrimu37pke-9589332985.europe-west2.run.app',
  ]);
  if (exactProductionHosts.has(hostname) || exactProductionHosts.has(clean)) {
    return true;
  }

  return false;
}

/**
 * Checks if a socket remote address is a local loopback IP.
 */
export function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const clean = ip.trim().toLowerCase();
  return (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '::ffff:127.0.0.1' ||
    clean === 'localhost'
  );
}

/**
 * Verifies request authenticity before injecting the per-launch token into HTML responses.
 * Refuses token exposure if the client has an untrusted Origin, untrusted Referer, untrusted Host,
 * or originates from an untrusted remote IP.
 */
export function shouldInjectLaunchToken(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): boolean {
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  if (!isAllowedHost(host)) {
    return false;
  }

  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return false;
  }

  const xForwardedHost = Array.isArray(req.headers['x-forwarded-host'])
    ? req.headers['x-forwarded-host'][0]
    : req.headers['x-forwarded-host'];
  const isAuthorizedForwardedHost = Boolean(xForwardedHost && isAllowedHost(xForwardedHost));

  if (!isAuthorizedForwardedHost) {
    const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        if (!isAllowedOrigin(refOrigin)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    const secFetchSite = Array.isArray(req.headers['sec-fetch-site'])
      ? req.headers['sec-fetch-site'][0]
      : req.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      return false;
    }
  }

  const remoteIp = req.socket?.remoteAddress;
  if (remoteIp && !isLoopbackAddress(remoteIp) && process.env.ALLOW_REMOTE_API_ACCESS !== 'true') {
    return false;
  }

  return true;
}
