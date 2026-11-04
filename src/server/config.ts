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
