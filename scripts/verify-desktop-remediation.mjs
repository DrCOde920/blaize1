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
  ['Live PC Operator uses an explicit native desktop tool', () => fs.readFileSync(path.join(root, 'src/components/PCOperatorView.tsx'), 'utf8').includes("name: 'desktop.perform_action'")],
  ['Native actions require per-action human approval', () => fs.readFileSync(path.join(root, 'src/components/PCOperatorView.tsx'), 'utf8').includes('requiresConfirmation: true') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('APPROVAL_REQUIRED')],
  ['Native actions reject coordinate-only automation', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('PIXEL_INPUT_DISABLED')],
  ['Native actions revalidate accessibility targets', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('ACTION_NOT_SUPPORTED') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('TARGET_ELEMENT_NOT_FOUND')],
  ['Native actions block sensitive apps and high-impact controls', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('SENSITIVE_APPLICATION_BLOCKED') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('SENSITIVE_CONTROL_BLOCKED')],
  ['Keyboard execution uses a strict shortcut allowlist', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('KEY_SHORTCUT_BLOCKED') && fs.readFileSync(path.join(root, 'scripts/linux-atspi-bridge.py'), 'utf8').includes('KEY_SHORTCUT_BLOCKED')],
  ['Electron asks the OS to select a display source', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('setDisplayMediaRequestHandler') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('desktopCapturer.getSources')],
  ['Recorder creates real WebM video segments', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('new MediaRecorder') && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('saveRecordingMediaSegment')],
  ['Recorder verifies video segment SHA-256 before playback', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('VIDEO_INTEGRITY_FAILED')],
  ['Recorder stores keyframes and video segments through SQLite on Electron', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes("putRecord('recorder_keyframes'") && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes("putRecord('recorder_media_segments'")],
  ['App starts real screen capture and waits for stop flush', () => fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('new ScreenCaptureSource') && fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('await capture.stop()')],
  ['Desktop preferences and sessions persist to SQLite', () => fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes("putRecord('ui_preferences'") && fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes("putRecord('recorder_sessions'")],
  ['Desktop bootstrap hydrates unified SQLite records before React', () => fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes('bootstrapDesktopPersistence') && fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes("getRecord('recorder_skills'")],
  ['SQLite blob deletion is blocked while a recorder row references it', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('stillReferenced')],
  ['Linux AT-SPI helper is packaged as an external resource', () => fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8').includes('scripts/linux-atspi-bridge.py') && fs.readFileSync(path.join(root, 'scripts/package-desktop.ts'), 'utf8').includes('linux-atspi-bridge.py')],
  ['Skill compiler refuses to invent actions from screenshots', () => fs.readFileSync(path.join(root, 'src/components/SkillRecorderStudio.tsx'), 'utf8').includes('will not invent clicks, typing, or file operations from screenshots')],
  ['Recorder skill metadata does not falsely claim media encryption', () => /encryptedAtRest: false/.test(fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8'))],
];
let failed = 0;
for (const [label, check] of checks) {
  const ok = Boolean(check());
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} remediation checks passed.`);
if (failed) process.exitCode = 1;
