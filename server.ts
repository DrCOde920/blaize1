/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Full-Stack Modular Server (Express + Vite)
 *
 * Hardened Architecture:
 * 1. API Access Control:
 *    - Enforces per-launch token (X-Blaize-Launch-Token) on every /api route except /api/health
 *    - Exact-origin allowlist check (no substring checks, no .run.app wildcard, rejects missing origins)
 *    - Server-side only rate limits and spend caps (client overrides ignored)
 *    - Secret code attempt limiter with exponential backoff, temporary lockout, and constant-time padding
 * 2. Connector Proxy:
 *    - Per-connector host allowlist (ALLOWED_CONNECTOR_HOSTS_PER_CONNECTOR)
 *    - No arbitrary client headers (server adds credentials from vault by handle)
 *    - Server-side DNS resolution, SSRF blocking (decimal, hex, octal, IPv6 mapped), IP pinning,
 *      manual redirect loop check (max 3 hops), size & time caps
 * 3. Plugins:
 *    - DELETED /api/plugins/marketplace and hardcoded catalog
 *    - Real install: Zod manifest validation, static checks, permission diff, server-issued single-use nonce
 * 4. Model Routing:
 *    - Deprecated models removed (muse-glimmer-local, meta-models/muse-spark-open-1026)
 *    - ProviderRouter with explicit providers (Meta Model API, local runtime, self-hosted, hosted endpoint)
 *    - NO SILENT SWITCHING
 * 5. Modular Routes:
 *    - health, vault, connectors, browser, plugins, model, system
 */

import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getPerLaunchAuthToken,
  setPerLaunchAuthTokenForTesting,
  isAllowedOrigin,
  SERVER_DEFAULTS,
} from './src/server/config';
import { corsMiddleware, launchTokenMiddleware } from './src/server/middleware/auth';
import { createHealthRouter } from './src/server/routes/health';
import { createVaultRouter } from './src/server/routes/vault';
import { createConnectorsRouter } from './src/server/routes/connectors';
import { createBrowserRouter } from './src/server/routes/browser';
import { createPluginsRouter } from './src/server/routes/plugins';
import {
  createModelRouter,
  ALLOWED_META_MODELS,
  validateModelProxyRequest as validateMetaModelProxyRequest,
  globalProviderRouter,
} from './src/server/routes/model';
import { createSystemRouter } from './src/server/routes/system';
import { PassphraseWrapVault } from './src/packages/vault/index';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Export constants & helpers for backwards compatibility
export {
  getPerLaunchAuthToken,
  setPerLaunchAuthTokenForTesting,
  isAllowedOrigin,
  ALLOWED_META_MODELS,
  validateMetaModelProxyRequest,
  globalProviderRouter,
};

// Re-export PER_LAUNCH_AUTH_TOKEN as a getter
export const PER_LAUNCH_AUTH_TOKEN = getPerLaunchAuthToken();

export interface CreateServerOptions {
  skipVite?: boolean;
  vaultInstance?: PassphraseWrapVault;
  customLaunchToken?: string;
}

export async function createBlaizeServer(options?: CreateServerOptions) {
  if (options?.customLaunchToken) {
    setPerLaunchAuthTokenForTesting(options.customLaunchToken);
  }
  process.env.BLAIZE_LAUNCH_TOKEN = getPerLaunchAuthToken();

  const app = express();
  app.use(express.json({ limit: `${SERVER_DEFAULTS.maxPayloadSizeBytes}b` }));

  // Shared Middlewares on all /api/* routes
  app.use('/api', corsMiddleware);
  app.use('/api', launchTokenMiddleware);

  // Mount Modular Subsystem Routers
  app.use('/api', createHealthRouter());
  app.use('/api', createVaultRouter(options?.vaultInstance));
  app.use('/api', createConnectorsRouter(options?.vaultInstance));
  app.use('/api', createBrowserRouter());
  app.use('/api', createPluginsRouter());
  app.use('/api', createModelRouter());
  app.use('/api', createSystemRouter(options?.vaultInstance));

  const isProd = process.env.NODE_ENV === 'production';
  const launchToken = getPerLaunchAuthToken();

  // Helper to inject per-launch token into same-origin HTML page load
  function injectLaunchTokenHtml(htmlContent: string): string {
    const metaTag = `<meta name="blaize-launch-token" content="${launchToken}">\n    <script>window.__BLAIZE_LAUNCH_TOKEN__ = "${launchToken}";</script>`;
    if (htmlContent.includes('<head>')) {
      return htmlContent.replace('<head>', `<head>\n    ${metaTag}`);
    }
    return `${metaTag}\n${htmlContent}`;
  }

  if (!options?.skipVite) {
    if (!isProd) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });

      // Intercept HTML requests in dev to inject launch token safely
      app.use(async (req, res, next) => {
        if (
          req.method === 'GET' &&
          (req.path === '/' || req.path.endsWith('.html') || !req.path.includes('.')) &&
          !req.path.startsWith('/api')
        ) {
          try {
            const indexHtmlPath = path.resolve(__dirname, 'index.html');
            const template = fs.readFileSync(indexHtmlPath, 'utf8');
            const transformed = await vite.transformIndexHtml(req.originalUrl, template);
            const injected = injectLaunchTokenHtml(transformed);
            res.status(200).set({ 'Content-Type': 'text/html' }).end(injected);
            return;
          } catch (e) {
            vite.ssrFixStacktrace(e as Error);
            next(e);
            return;
          }
        }
        next();
      });

      app.use(vite.middlewares);
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath, { index: false }));
      app.get('*', (_req, res) => {
        const indexFile = path.join(distPath, 'index.html');
        if (fs.existsSync(indexFile)) {
          const raw = fs.readFileSync(indexFile, 'utf8');
          res.status(200).set({ 'Content-Type': 'text/html' }).send(injectLaunchTokenHtml(raw));
        } else {
          res.status(404).send('Not Found');
        }
      });
    }
  }

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.APP_PORT) || Number(process.env.DEFAULT_APP_PORT) || Number(process.env.PORT) || 3000;
  createBlaizeServer().then((app) => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Blaize hardened desktop server listening on http://0.0.0.0:${port}`);
      console.log(`Per-launch authentication active. Launch token: ••••${getPerLaunchAuthToken().slice(-4)}`);
    });
  });
}
