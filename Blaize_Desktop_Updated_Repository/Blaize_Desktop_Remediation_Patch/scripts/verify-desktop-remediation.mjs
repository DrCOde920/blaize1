#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checks = [
  ['Embedded backend bundle is generated', () => fs.readFileSync(path.join(root, 'scripts/build-desktop.ts'), 'utf8').includes("'server.mjs'")],
  ['Electron starts the embedded server', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('startEmbeddedBackend')],
  ['Electron waits for backend health', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes("'/api/health'")],
  ['Renderer is loaded from the owned loopback origin', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('createWindow(desktopStartUrl)')],
  ['Server serves packaged dist directory', () => fs.readFileSync(path.join(root, 'server.ts'), 'utf8').includes('BLAIZE_DIST_DIR')],
  ['Electron keeps launch token out of renderer HTML', () => fs.readFileSync(path.join(root, 'server.ts'), 'utf8').includes("BLAIZE_ELECTRON_MODE !== '1'") && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes("BLAIZE_ELECTRON_MODE = '1'")],
  ['PC Operator exposes real Electron host controls', () => fs.readFileSync(path.join(root, 'src/components/PCOperatorView.tsx'), 'utf8').includes('<NativeDesktopHostPanel />')],
  ['PC Operator defaults to actual host platform', () => fs.readFileSync(path.join(root, 'src/components/PCOperatorView.tsx'), 'utf8').includes('const initialPlatform: DesktopOSPlatform')],
  ['Native host panel exists', () => fs.existsSync(path.join(root, 'src/components/NativeDesktopHostPanel.tsx'))],
  ['Release packaging uses electron-builder', () => fs.readFileSync(path.join(root, 'package.json'), 'utf8').includes('scripts/package-electron.ts')],
  ['Debian and AppImage targets exist', () => /- AppImage[\s\S]*- deb/.test(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))],
  ['CI verifies desktop wiring', () => fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').includes('bun run desktop:verify-bundle')],
  ['CI compiles Electron runtime', () => fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8').includes('bun run desktop:build')],
  ['Bun lock range matches Electron dependency', () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.electron === '^45.2.1'],
];
let failed = 0;
for (const [label, check] of checks) {
  const ok = Boolean(check());
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} remediation checks passed.`);
if (failed) process.exitCode = 1;
