/**
 * Blaize Reproducible Desktop Build Script (`npm run desktop:build` / `npm run desktop:dev`)
 *
 * 1. Builds the React/Vite renderer bundle into `dist/` (unless `--skip-frontend` is passed).
 * 2. Bundles `electron/main.ts` -> `dist-electron/main.cjs` and `electron/preload.ts` -> `dist-electron/preload.cjs`
 *    via esbuild with deterministic CommonJS output and externalized native Electron/SQLite bindings.
 * 3. Emits `dist-electron/build-manifest.json` with SHA-256 digests of the compiled artifacts.
 * 4. When invoked with `--dev`, starts the Electron runtime if a display server is available, or reports
 *    an honest headless diagnostic when running inside a headless container.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { build } from 'esbuild';

export interface DesktopBuildManifest {
  builtAt: string;
  platform: NodeJS.Platform;
  arch: string;
  electronVersion: string;
  files: {
    mainCjs: { path: string; sha256: string; bytes: number };
    preloadCjs: { path: string; sha256: string; bytes: number };
    serverEsm: { path: string; sha256: string; bytes: number };
    rendererIndexHtml: { path: string; sha256: string; bytes: number };
  };
}

function sha256File(filePath: string): { sha256: string; bytes: number } {
  const buf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256, bytes: buf.byteLength };
}

export async function buildDesktopArtifacts(options?: { skipFrontend?: boolean }): Promise<DesktopBuildManifest> {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const distElectronDir = path.join(rootDir, 'dist-electron');

  if (!options?.skipFrontend || !fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log('[desktop:build] Building Vite renderer bundle -> dist/ ...');
    execSync('npx vite build', { cwd: rootDir, stdio: 'inherit' });
  }

  fs.mkdirSync(distElectronDir, { recursive: true });

  const mainOut = path.join(distElectronDir, 'main.cjs');
  const preloadOut = path.join(distElectronDir, 'preload.cjs');

  console.log('[desktop:build] Bundling electron/main.ts -> dist-electron/main.cjs ...');
  await build({
    entryPoints: [path.join(rootDir, 'electron/main.ts')],
    outfile: mainOut,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    sourcemap: true,
    logLevel: 'warning',
  });

  console.log('[desktop:build] Bundling electron/preload.ts -> dist-electron/preload.cjs ...');
  await build({
    entryPoints: [path.join(rootDir, 'electron/preload.ts')],
    outfile: preloadOut,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'warning',
  });

  const serverOut = path.join(distElectronDir, 'server.mjs');
  console.log('[desktop:build] Bundling server.ts -> dist-electron/server.mjs ...');
  await build({
    entryPoints: [path.join(rootDir, 'server.ts')],
    outfile: serverOut,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
    external: ['node:sqlite'],
    sourcemap: true,
    logLevel: 'warning',
  });

  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const electronVersion =
    pkgJson.devDependencies?.electron || pkgJson.dependencies?.electron || 'unknown';

  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`Renderer build missing expected entry file: ${indexHtmlPath}`);
  }

  const mainStats = sha256File(mainOut);
  const preloadStats = sha256File(preloadOut);
  const serverStats = sha256File(serverOut);
  const indexStats = sha256File(indexHtmlPath);

  const manifest: DesktopBuildManifest = {
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electronVersion,
    files: {
      mainCjs: { path: 'dist-electron/main.cjs', ...mainStats },
      preloadCjs: { path: 'dist-electron/preload.cjs', ...preloadStats },
      serverEsm: { path: 'dist-electron/server.mjs', ...serverStats },
      rendererIndexHtml: { path: 'dist/index.html', ...indexStats },
    },
  };

  const manifestPath = path.join(distElectronDir, 'build-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[desktop:build] Wrote build manifest -> ${manifestPath}`);
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const isDevMode = args.includes('--dev');
  const skipFrontend = args.includes('--skip-frontend');

  const manifest = await buildDesktopArtifacts({ skipFrontend });
  console.log(
    `[desktop:build] Build complete: main.cjs (${manifest.files.mainCjs.bytes} B), preload.cjs (${manifest.files.preloadCjs.bytes} B)`
  );

  if (isDevMode) {
    const hasDisplay =
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

    if (!hasDisplay) {
      console.log(
        '[desktop:dev] Headless Linux environment detected (no DISPLAY or WAYLAND_DISPLAY). Desktop artifacts compiled cleanly in dist-electron/. To launch the GUI window on Linux, run under X11/Wayland or xvfb-run.'
      );
      return;
    }

    const electronBin = path.join(
      process.cwd(),
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron.cmd' : 'electron'
    );
    console.log(`[desktop:dev] Launching Electron binary: ${electronBin} dist-electron/main.cjs`);
    const child = spawn(electronBin, ['dist-electron/main.cjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000',
      },
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[desktop:build] FAILED:', err);
    process.exit(1);
  });
}
