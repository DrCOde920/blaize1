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
  isAllowedHost,
  isLoopbackAddress,
  shouldInjectLaunchToken,
  SERVER_DEFAULTS,
} from './src/server/config';
import {
  corsMiddleware,
  launchTokenMiddleware,
  hostValidationMiddleware,
  remoteAccessProtectionMiddleware,
} from './src/server/middleware/auth';
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
  isAllowedHost,
  isLoopbackAddress,
  shouldInjectLaunchToken,
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

  // Global Host Header Validation
  app.use(hostValidationMiddleware);

  // Shared Middlewares on all /api/* routes
  app.use('/api', remoteAccessProtectionMiddleware);
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
    const metaTag = `<meta name="blaize-launch-token" content="${launchToken}">\n    <script>window.__BLAIZE_LAUNCH_TOKEN__ = "${launchToken}";(function(){try{if(typeof window!=="undefined"&&typeof window.fetch==="function"&&!window.__BLAIZE_INTERCEPTOR_INITIALIZED__){var origFetch=window.fetch.bind(window);window.fetch=function(input,init){var u=typeof input==="string"?input:(input instanceof URL?input.toString():(input&&input.url?input.url:""));if(u.indexOf("/api")===0||u.indexOf("/api/")!==-1){var t=window.__BLAIZE_LAUNCH_TOKEN__;var h=new Headers((init&&init.headers)||(input instanceof Request?input.headers:undefined));if(t&&!h.has("x-blaize-launch-token")){h.set("X-Blaize-Launch-Token",t);}var m=Object.assign({},init,{headers:h});return input instanceof Request?origFetch(new Request(input,m)):origFetch(input,m);}return origFetch(input,init);};window.__BLAIZE_INTERCEPTOR_INITIALIZED__=true;}}catch(e){}})();</script>`;
    if (htmlContent.includes('<head>')) {
      return htmlContent.replace('<head>', `<head>\n    ${metaTag}`);
    }
    return `${metaTag}\n${htmlContent}`;
  }

  // Guard all non-API HTML requests against unauthorized cross-origin scraping/embedding
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    const originHeader = req.headers.origin;
    if (originHeader && !isAllowedOrigin(originHeader)) {
      res.status(403).json({
        ok: false,
        errorCode: 'CORS_ORIGIN_DENIED',
        error: 'Cross-origin HTML request denied.',
      });
      return;
    }
    next();
  });

  if (!options?.skipVite) {
    if (!isProd) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom',
      });

      app.use(vite.middlewares);

      // Serve SPA HTML after Vite middlewares so /@vite/client and extensionless module imports resolve as JS
      app.use(async (req, res, next) => {
        if (
          req.method === 'GET' &&
          !req.path.startsWith('/api') &&
          !req.path.startsWith('/@') &&
          !req.path.startsWith('/src/') &&
          !req.path.startsWith('/node_modules/')
        ) {
          try {
            const indexHtmlPath = path.resolve(__dirname, 'index.html');
            const template = fs.readFileSync(indexHtmlPath, 'utf8');
            const transformed = await vite.transformIndexHtml(req.originalUrl, template);
            const canInject = shouldInjectLaunchToken(req);
            const body = canInject ? injectLaunchTokenHtml(transformed) : transformed;
            res.status(200).set({ 'Content-Type': 'text/html' }).end(body);
            return;
          } catch (e) {
            vite.ssrFixStacktrace(e as Error);
            next(e);
            return;
          }
        }
        next();
      });
    } else {
      const distPath = path.resolve(__dirname, 'dist');
      app.use(express.static(distPath, { index: false }));
      app.get('*', (req, res) => {
        const indexFile = path.join(distPath, 'index.html');
        if (fs.existsSync(indexFile)) {
          const raw = fs.readFileSync(indexFile, 'utf8');
          const canInject = shouldInjectLaunchToken(req);
          const body = canInject ? injectLaunchTokenHtml(raw) : raw;
          res.status(200).set({ 'Content-Type': 'text/html' }).send(body);
        } else {
          res.status(404).send('Not Found');
        }
      });
    }
  } else {
    // When skipVite is enabled (e.g. testing), provide baseline HTML root handler
    app.get('/', (req, res) => {
      const indexFile = path.resolve(__dirname, 'index.html');
      const raw = fs.existsSync(indexFile)
        ? fs.readFileSync(indexFile, 'utf8')
        : '<!DOCTYPE html><html><head><title>Blaize</title></head><body><div id="root"></div></body></html>';
      const canInject = shouldInjectLaunchToken(req);
      const body = canInject ? injectLaunchTokenHtml(raw) : raw;
      res.status(200).set({ 'Content-Type': 'text/html' }).send(body);
    });
  }

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.APP_PORT) || Number(process.env.DEFAULT_APP_PORT) || Number(process.env.PORT) || 3000;
  const host = process.env.BLAIZE_SERVER_HOST || process.env.HOST || '127.0.0.1';
  createBlaizeServer().then((app) => {
    app.listen(port, host, () => {
      console.log(`Blaize hardened desktop server listening on http://${host}:${port}`);
      console.log(`Per-launch authentication active. Launch token: ••••${getPerLaunchAuthToken().slice(-4)}`);
    });
  });
}

