#!/usr/bin/env node
/**
 * Applies the Blaize desktop lifecycle remediation to a clean checkout of
 * DrCOde920/blaize1 at main commit dc905d7559445098896d9c9b5445a829fd545fb6.
 *
 * This is intentionally fail-closed: every source edit is anchored to an exact
 * block inspected in that revision. It never overwrites an unexpected variant.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || process.cwd());
const backupRoot = path.join(root, '.blaize-desktop-remediation-backup');
const EXPECTED_HEAD = 'dc905d7559445098896d9c9b5445a829fd545fb6';
const changed = [];
if (fs.existsSync(path.join(root, '.git'))) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== EXPECTED_HEAD) throw new Error(`This patch targets ${EXPECTED_HEAD}, but this checkout is ${head}. Inspect and port manually; no files changed.`);
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  if (dirty) throw new Error('Working tree is not clean. Commit or stash local edits before applying; no files changed.');
}

function read(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) throw new Error(`Required file missing: ${rel}`);
  return fs.readFileSync(full, 'utf8');
}
function write(rel, content) {
  const full = path.join(root, rel);
  if (!changed.includes(rel)) {
    fs.mkdirSync(path.join(backupRoot, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(full, path.join(backupRoot, rel));
    changed.push(rel);
  }
  fs.writeFileSync(full, content, 'utf8');
}
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one exact source anchor, found ${count}`);
  return source.replace(before, after);
}
function insertBefore(source, anchor, insert, label) {
  return replaceOnce(source, anchor, `${insert}\n${anchor}`, label);
}

const pkg = JSON.parse(read('package.json'));
if (pkg.name !== 'blaize-accountable-desktop' || pkg.version !== '3.0.0') {
  throw new Error('Unexpected package.json identity/version. Apply this remediation only after reviewing the current diff.');
}

// 1. Compile the existing server as an ESM backend bundle next to Electron.
{
  let s = read('scripts/build-desktop.ts');
  s = replaceOnce(
    s,
    "    preloadCjs: { path: string; sha256: string; bytes: number };\n    rendererIndexHtml: { path: string; sha256: string; bytes: number };",
    "    preloadCjs: { path: string; sha256: string; bytes: number };\n    serverEsm: { path: string; sha256: string; bytes: number };\n    rendererIndexHtml: { path: string; sha256: string; bytes: number };",
    'build manifest type'
  );
  s = insertBefore(
    s,
    "  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));",
    `  const serverOut = path.join(distElectronDir, 'server.mjs');
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
`,
    'server bundle build'
  );
  s = replaceOnce(
    s,
    "  const preloadStats = sha256File(preloadOut);\n  const indexStats = sha256File(indexHtmlPath);",
    "  const preloadStats = sha256File(preloadOut);\n  const serverStats = sha256File(serverOut);\n  const indexStats = sha256File(indexHtmlPath);",
    'server build manifest digest'
  );
  s = replaceOnce(
    s,
    "      preloadCjs: { path: 'dist-electron/preload.cjs', ...preloadStats },\n      rendererIndexHtml: { path: 'dist/index.html', ...indexStats },",
    "      preloadCjs: { path: 'dist-electron/preload.cjs', ...preloadStats },\n      serverEsm: { path: 'dist-electron/server.mjs', ...serverStats },\n      rendererIndexHtml: { path: 'dist/index.html', ...indexStats },",
    'server manifest entry'
  );
  write('scripts/build-desktop.ts', s);
}

// 2. Point the Express server at the packaged renderer and support embedded use.
{
  let s = read('server.ts');
  s = replaceOnce(
    s,
    "            const indexHtmlPath = path.resolve(__dirname, 'index.html');",
    "            const appRoot = process.env.BLAIZE_APP_ROOT || __dirname;\n            const indexHtmlPath = path.resolve(appRoot, 'index.html');",
    'development app root'
  );
  s = replaceOnce(
    s,
    "      const distPath = path.resolve(__dirname, 'dist');",
    "      const appRoot = process.env.BLAIZE_APP_ROOT || __dirname;\n      const distPath = process.env.BLAIZE_DIST_DIR || path.resolve(appRoot, 'dist');",
    'production renderer directory'
  );
  s = replaceOnce(
    s,
    "      const indexFile = path.resolve(__dirname, 'index.html');",
    "      const appRoot = process.env.BLAIZE_APP_ROOT || __dirname;\n      const indexFile = path.resolve(appRoot, 'index.html');",
    'test renderer directory'
  );
  const injectionLine = 'const canInject = shouldInjectLaunchToken(req);';
  const injectionCount = s.split(injectionLine).length - 1;
  if (injectionCount !== 3) throw new Error(`Expected 3 token-injection sites in server.ts, found ${injectionCount}`);
  s = s.split(injectionLine).join("const canInject = process.env.BLAIZE_ELECTRON_MODE !== '1' && shouldInjectLaunchToken(req);");
  write('server.ts', s);
}

// 3. Start the backend inside Electron and use its ephemeral loopback origin.
{
  let s = read('electron/main.ts');
  s = replaceOnce(s, "import { fileURLToPath } from 'node:url';", "import { fileURLToPath, pathToFileURL } from 'node:url';", 'URL imports');
  s = insertBefore(
    s,
    "// ============================================================================\n// 1. HARDENED SECURITY CONSTANTS & NAVIGATION / PERMISSION GUARDS",
    `let desktopBackendServer: any = null;
let desktopBackendOrigin = '';

/** Starts the existing Express/Vite application inside the Electron main process. */
export async function startEmbeddedBackend(): Promise<string> {
  if (desktopBackendServer && desktopBackendOrigin) return desktopBackendOrigin + '/';

  const appRoot = typeof app?.getAppPath === 'function' ? app.getAppPath() : path.resolve(CURRENT_DIR, '..');
  process.env.BLAIZE_APP_ROOT = appRoot;
  process.env.BLAIZE_DIST_DIR = path.resolve(appRoot, 'dist');
  process.env.BLAIZE_USER_DATA_DIR = app?.getPath?.('userData') || path.join(os.homedir(), '.blaize');
  process.env.BLAIZE_SERVER_HOST = '127.0.0.1';
  process.env.BLAIZE_ELECTRON_MODE = '1';
  process.env.NODE_ENV = app?.isPackaged ? 'production' : (process.env.NODE_ENV || 'development');

  const backendPath = path.join(CURRENT_DIR, 'server.mjs');
  if (!fs.existsSync(backendPath)) {
    throw new Error('Embedded backend bundle is missing: ' + backendPath + '. Run desktop:build first.');
  }
  const backendModule = await import(pathToFileURL(backendPath).href);
  if (typeof backendModule.createBlaizeServer !== 'function') {
    throw new Error('Embedded backend does not export createBlaizeServer().');
  }

  const expressApp = await backendModule.createBlaizeServer();
  const server = expressApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Embedded backend did not bind to a TCP loopback port.');
  }

  desktopBackendServer = server;
  desktopBackendOrigin = 'http://127.0.0.1:' + address.port;

  // Confirm that the server is actually serving its health endpoint before opening UI.
  const health = await fetch(desktopBackendOrigin + '/api/health');
  if (!health.ok) {
    server.close();
    desktopBackendServer = null;
    desktopBackendOrigin = '';
    throw new Error('Embedded backend health check failed with HTTP ' + health.status + '.');
  }
  return desktopBackendOrigin + '/';
}
`,
    'embedded backend bootstrap'
  );
  s = replaceOnce(
    s,
    "  \"connect-src 'self' http://localhost:3000 http://127.0.0.1:3000 https://api.meta.ai; \" +",
    "  \"connect-src 'self' ws://127.0.0.1:* https://api.meta.ai; \" +",
    'CSP self-origin API access'
  );
  s = replaceOnce(
    s,
    "      return ALLOWED_DEV_ORIGINS.has(parsed.origin);",
    "      return ALLOWED_DEV_ORIGINS.has(parsed.origin) || Boolean(desktopBackendOrigin && parsed.origin === desktopBackendOrigin);",
    'exact embedded origin navigation'
  );
  s = replaceOnce(s, "export function createWindow(): any {", "export function createWindow(startUrlOverride?: string): any {", 'window entry signature');
  s = replaceOnce(
    s,
    `          const requestHeaders = { ...details.requestHeaders };
          const token = process.env.BLAIZE_LAUNCH_TOKEN;
          if (token) {
            requestHeaders['X-Blaize-Launch-Token'] = token;
          }
          callback({ requestHeaders });`,
    `          const requestHeaders = { ...details.requestHeaders };
          let requestOrigin = '';
          try { requestOrigin = new URL(details.url).origin; } catch { /* malformed URL: do not attach token */ }
          if (desktopBackendOrigin && requestOrigin === desktopBackendOrigin) {
            const token = process.env.BLAIZE_LAUNCH_TOKEN;
            if (token) requestHeaders['X-Blaize-Launch-Token'] = token;
          }
          callback({ requestHeaders });`,
    'scope launch token to embedded backend'
  );
  const startBlock = `  const startUrl =
    process.env.VITE_DEV_SERVER_URL ||
    (process.env.NODE_ENV === 'production' && fs.existsSync(packagedIndexHtml)
      ? \`file://\${packagedIndexHtml}\`
      : 'http://localhost:3000');`;
  s = replaceOnce(
    s,
    startBlock,
    "  const startUrl = startUrlOverride || process.env.VITE_DEV_SERVER_URL || ('file://' + packagedIndexHtml);",
    'window backend URL'
  );

  s = replaceOnce(
    s,
    "  if (desktopDurableDb) {\n    try {\n      desktopDurableDb.close();",
    "  if (desktopBackendServer) {\n    try { desktopBackendServer.close(); } catch { /* ignore shutdown race */ }\n    desktopBackendServer = null;\n    desktopBackendOrigin = '';\n  }\n\n  if (desktopDurableDb) {\n    try {\n      desktopDurableDb.close();",
    'embedded server shutdown'
  );

  s = replaceOnce(
    s,
    "  app\n    .whenReady()\n    .then(() => {\n      initializeDesktopDirectories();",
    "  app\n    .whenReady()\n    .then(async () => {\n      initializeDesktopDirectories();",
    'async Electron startup'
  );
  s = replaceOnce(s, "      createWindow();\n\n      if (powerMonitor", "      const desktopStartUrl = await startEmbeddedBackend();\n      createWindow(desktopStartUrl);\n\n      if (powerMonitor", 'open window after backend health');
  s = replaceOnce(s, "          createWindow();\n        }\n      });", "          void startEmbeddedBackend().then((url) => createWindow(url)).catch((err) => {\n            const msg = redactSecretsFromText(err?.message || String(err));\n            startupErrors.push(msg);\n            recordLocalRedactedCrashReport({ source: 'main', message: 'Backend restart failed: ' + msg });\n          });\n        }\n      });", 'macOS window reactivation');
  s = replaceOnce(
    s,
    "        message: `Startup failure: ${msg}`,\n        stack: err?.stack,\n      });\n    });",
    "        message: `Startup failure: ${msg}`,\n        stack: err?.stack,\n      });\n      try { app?.showErrorBox?.('Blaize startup failed', msg); } catch { /* ignore UI reporting failures */ }\n      try { app?.quit?.(); } catch { /* ignore shutdown failures */ }\n    });",
    'visible startup failure and clean quit'
  );
  write('electron/main.ts', s);
}

// 4. Connect the PC Operator view to real Electron host controls. Scenario-driver
// demonstrations remain clearly labeled separately from native host state.
{
  const panelPath = path.join(root, 'src/components/NativeDesktopHostPanel.tsx');
  if (fs.existsSync(panelPath)) throw new Error('NativeDesktopHostPanel.tsx already exists; refusing to overwrite it.');
  const panelTemplate = new URL('./templates/NativeDesktopHostPanel.tsx', import.meta.url);
  fs.mkdirSync(path.dirname(panelPath), { recursive: true });
  fs.writeFileSync(panelPath, fs.readFileSync(panelTemplate, 'utf8'), 'utf8');
  changed.push('src/components/NativeDesktopHostPanel.tsx (new)');

  let pc = read('src/components/PCOperatorView.tsx');
  pc = replaceOnce(
    pc,
    "import { apiFetch } from '../utils/api_client';",
    "import { apiFetch } from '../utils/api_client';\nimport { NativeDesktopHostPanel } from './NativeDesktopHostPanel';\nimport { getPlatformBridge } from '../packages/platform';",
    'native host UI import'
  );
  pc = replaceOnce(
    pc,
    "}) => {\n  const [activeTab, setActiveTab] = useState<PCOperatorTabId>(initialTab);",
    "}) => {\n  const platformBridge = getPlatformBridge();\n  const initialPlatform: DesktopOSPlatform = platformBridge.isElectron\n    ? platformBridge.platform === 'win32' ? 'windows' : platformBridge.platform === 'darwin' ? 'macos' : 'linux'\n    : 'linux';\n  const [activeTab, setActiveTab] = useState<PCOperatorTabId>(initialTab);",
    'detect actual host platform'
  );
  pc = replaceOnce(pc, "const [platform, setPlatform] = useState<DesktopOSPlatform>('macos');", "const [platform, setPlatform] = useState<DesktopOSPlatform>(initialPlatform);", 'native host default driver');
  pc = replaceOnce(pc, "driver: createDesktopDriver('macos'),", "driver: createDesktopDriver(initialPlatform),", 'initial execution driver platform');
  pc = insertBefore(pc, '      {/* Navigation Tabs */}', '      <NativeDesktopHostPanel />\n', 'native host UI placement');
  pc = replaceOnce(pc, 'Active DesktopDriver Implementation', 'Scenario Driver Preview (native host controls are above)', 'preview driver honesty label');
  write('src/components/PCOperatorView.tsx', pc);

  let test = read('src/packages/platform/electron_desktop.test.ts');
  test = replaceOnce(
    test,
    "    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.preloadCjs.path)));\n    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.rendererIndexHtml.path)));",
    "    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.preloadCjs.path)));\n    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.serverEsm.path)));\n    assert.ok(fs.existsSync(path.join(process.cwd(), buildManifest.files.rendererIndexHtml.path)));",
    'embedded backend build regression assertion'
  );
  write('src/packages/platform/electron_desktop.test.ts', test);
}

// 5. Real installer packaging through electron-builder, retaining the existing
// packageDesktopTarget lifecycle/test implementation as a separate test utility.
{
  const content = `import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildDesktopArtifacts } from './build-desktop.js';

type Target = 'current' | 'linux' | 'win' | 'mac';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = (process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'current') as Target;
const hostTarget: Target = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
const target: Target = requested === 'current' ? hostTarget : requested;

async function main(): Promise<void> {
  if (!['current', 'linux', 'win', 'mac'].includes(requested)) throw new Error('Unknown target: ' + requested);
  if (target !== hostTarget) {
    throw new Error('Cross-OS packaging is disabled. Build ' + target + ' on a native ' + target + ' runner. Current host: ' + process.platform);
  }

  await buildDesktopArtifacts({ skipFrontend: false });
  const require = createRequire(import.meta.url);
  const cli = require.resolve('electron-builder/cli.js');
  const targetArgs = target === 'linux'
    ? ['--linux', 'AppImage', 'deb', 'tar.gz']
    : target === 'win'
      ? ['--win', 'nsis', 'zip']
      : ['--mac', 'dmg', 'zip'];

  execFileSync(process.execPath, [cli, '--config', path.join(root, 'electron-builder.yml'), '--publish', 'never', ...targetArgs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false' },
  });
}

main().catch((error) => {
  console.error('[desktop:package] FAILED:', error?.stack || error);
  process.exitCode = 1;
});
`;
  const full = path.join(root, 'scripts/package-electron.ts');
  if (fs.existsSync(full)) throw new Error('scripts/package-electron.ts already exists; refusing to overwrite it.');
  fs.writeFileSync(full, content, 'utf8');
  changed.push('scripts/package-electron.ts (new)');
}

// 6. Fix the exact Bun lockfile mismatch reported by current main CI and expose
// the real electron-builder package scripts.
{
  let p = JSON.parse(read('package.json'));
  if (p.devDependencies?.electron === '45.2.1') p.devDependencies.electron = '^45.2.1';
  p.scripts['desktop:package'] = 'tsx scripts/package-electron.ts --target=current';
  p.scripts['desktop:package:linux'] = 'tsx scripts/package-electron.ts --target=linux';
  p.scripts['desktop:package:win'] = 'tsx scripts/package-electron.ts --target=win';
  p.scripts['desktop:package:mac'] = 'tsx scripts/package-electron.ts --target=mac';
  p.scripts['desktop:verify-bundle'] = 'node scripts/verify-desktop-remediation.mjs';
  write('package.json', JSON.stringify(p, null, 2) + '\n');
}

// 7. Add Debian/AppImage targets to the existing electron-builder config.
{
  let y = read('electron-builder.yml');
  y = replaceOnce(y, "  target:\n    - dir\n    - tar.gz", "  target:\n    - dir\n    - tar.gz\n    - AppImage\n    - deb", 'Linux installer targets');
  write('electron-builder.yml', y);
}

// Keep local patch backups out of commits.
{
  let ignore = read('.gitignore');
  if (!ignore.split(/\r?\n/).includes('.blaize-desktop-remediation-backup/')) {
    ignore = ignore.trimEnd() + '\n.blaize-desktop-remediation-backup/\n';
    write('.gitignore', ignore);
  }
}

// 9. Make CI compile the actual Electron main/preload/backend bundles as well as Vite.
{
  let y = read('.github/workflows/ci.yml');
  if (!y.includes('bun run desktop:build')) {
    y = y.trimEnd() + "\n\n      - name: Verify Desktop Remediation Wiring\n        run: bun run desktop:verify-bundle\n\n      - name: Build Electron Desktop Runtime (main, preload, embedded backend)\n        run: bun run desktop:build\n";
    write('.github/workflows/ci.yml', y);
  }
}

console.log('Blaize desktop remediation applied. Changed files:');
for (const item of changed) console.log(' - ' + item);
console.log('Backups saved under .blaize-desktop-remediation-backup/');
console.log('Next: bun install --frozen-lockfile && bun run desktop:verify-bundle && bun run lint && bun test && bun run verify && bun run desktop:build.');
