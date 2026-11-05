/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server Authentication & CORS Middleware (`src/server/middleware/auth.ts`)
 * - Enforces per-launch token (`X-Blaize-Launch-Token`) on every `/api` route except `/api/health`
 * - Replaces substring CORS check with exact-origin allowlist
 * - Never trusts a request just because it has no Origin
 * - Sets strict security headers (nosniff, SAMEORIGIN)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  getPerLaunchAuthToken,
  isAllowedOrigin,
  isAllowedHost,
  isExactCloudRunHost,
  isLoopbackAddress,
} from '../config';

/**
 * Validates that incoming requests specify an authorized Host header.
 * Rejects arbitrary or spoofed Host headers (e.g. evil.com) with 403 Forbidden.
 */
export function hostValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const normalizedPath = req.path?.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api/health' || normalizedPath === '/health') {
    return next();
  }
  const host = req.headers.host;
  if (!host || !isAllowedHost(host)) {
    res.status(403).json({
      ok: false,
      errorCode: 'INVALID_HOST_HEADER',
      error: `Access denied: Host header '${host || 'none'}' is not allowed.`,
    });
    return;
  }
  next();
}

/**
 * Prevents remote access to privileged desktop APIs from non-loopback network interfaces,
 * while permitting requests through the Cloud Run ingress proxy when targeting exact Cloud Run hosts.
 */
export function remoteAccessProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/health') {
    return next();
  }

  if (req.method === 'OPTIONS') {
    return next();
  }

  const hostHeader = req.headers?.host;
  const xForwardedHost = req.headers?.['x-forwarded-host'];
  const isCloudRunHost =
    isExactCloudRunHost(typeof hostHeader === 'string' ? hostHeader : undefined) ||
    isExactCloudRunHost(typeof xForwardedHost === 'string' ? xForwardedHost : undefined);

  const remoteIp = req.socket?.remoteAddress;
  if (
    remoteIp &&
    !isLoopbackAddress(remoteIp) &&
    !isCloudRunHost &&
    process.env.ALLOW_REMOTE_API_ACCESS !== 'true'
  ) {
    res.status(403).json({
      ok: false,
      errorCode: 'REMOTE_ACCESS_DENIED',
      error: 'Access denied: Desktop server APIs are restricted to local loopback connections.',
    });
    return;
  }
  next();
}

/**
 * Exact-origin CORS middleware.
 * - Extracts origin from `Origin` header or resolves origin from `Referer` header.
 * - If neither is present, or the origin is not in the exact-origin allowlist, rejects with 403.
 * - Handles pre-flight OPTIONS requests.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Unauthenticated health endpoint /api/health and OAuth IdP redirect callback are exempt from CORS origin blocking
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  const isHealth = normalizedPath === '/health' || req.originalUrl?.includes('/health');
  const isOAuthCallback =
    normalizedPath === '/connectors/oauth/callback' ||
    req.originalUrl?.includes('/connectors/oauth/callback');

  if (isHealth || isOAuthCallback) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    return next();
  }

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  let effectiveOrigin = typeof originHeader === 'string' ? originHeader.trim() : '';
  if (!effectiveOrigin && typeof refererHeader === 'string' && refererHeader.trim()) {
    try {
      effectiveOrigin = new URL(refererHeader.trim()).origin;
    } catch {
      effectiveOrigin = '';
    }
  }

  // Never trust a request just because it has no Origin
  if (!effectiveOrigin || !isAllowedOrigin(effectiveOrigin)) {
    res.status(403).json({
      ok: false,
      errorCode: 'CORS_ORIGIN_DENIED',
      error: `Cross-origin request blocked: origin '${effectiveOrigin || 'none'}' is not in the allowed origins allowlist.`,
    });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', effectiveOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Blaize-Launch-Token, X-Request-Id, Accept'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
}

/**
 * Launch token authentication middleware.
 * Enforces that every `/api/*` request must present a valid `X-Blaize-Launch-Token` header,
 * with the sole exceptions of the minimal health check route `/api/health` and the OAuth callback
 * endpoint `/api/connectors/oauth/callback` (which is redirected from external OAuth identity providers).
 */
export function launchTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  const isHealth = normalizedPath === '/health' || req.originalUrl?.includes('/health');
  const isOAuthCallback =
    normalizedPath === '/connectors/oauth/callback' ||
    req.originalUrl?.includes('/connectors/oauth/callback');

  if (isHealth || isOAuthCallback) {
    return next();
  }

  // OPTIONS requests are handled by CORS middleware
  if (req.method === 'OPTIONS') {
    return next();
  }

  const tokenHeader = req.headers['x-blaize-launch-token'];
  const expectedToken = getPerLaunchAuthToken();

  if (!tokenHeader || typeof tokenHeader !== 'string' || tokenHeader.trim() !== expectedToken) {
    res.status(401).json({
      ok: false,
      errorCode: 'INVALID_LAUNCH_TOKEN',
      error: 'Unauthorized: missing or invalid X-Blaize-Launch-Token header.',
    });
    return;
  }

  next();
}
