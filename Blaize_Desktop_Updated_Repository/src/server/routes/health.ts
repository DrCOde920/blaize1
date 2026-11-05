/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal Unauthenticated Health Route (`src/server/routes/health.ts`)
 * - Accessible without launch token
 * - Reports uptime, process state, and server timestamp
 */

import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'blaize-desktop-server',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
    });
  });

  return router;
}
