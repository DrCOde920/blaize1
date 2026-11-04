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
import { getPerLaunchAuthToken, isAllowedOrigin } from '../config';

/**
 * Exact-origin CORS middleware.
 * - Extracts origin from `Origin` header or resolves origin from `Referer` header.
 * - If neither is present, or the origin is not in the exact-origin allowlist, rejects with 403.
 * - Handles pre-flight OPTIONS requests.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Unauthenticated health endpoint /api/health is accessible without CORS origin restriction
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/health') {
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
 * with the sole exception of the minimal health check route `/api/health`.
 */
export function launchTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Minimal health route is unauthenticated
  const normalizedPath = req.path.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/health') {
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
