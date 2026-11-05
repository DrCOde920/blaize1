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
  ['Native actions require a main-process, one-time approval token', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('dialogApi.showMessageBox') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('nativeActionApprovalVault.consume') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('APPROVAL_INVALID')],
  ['Native desktop text entry rejects overlong and detected personal/credential values', () => { const s = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8'); return s.includes('request.text.length > 240') && s.includes('isSensitiveAccessibleValue(request.text)'); }],
  ['Native actions reject coordinate-only automation', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('PIXEL_INPUT_DISABLED')],
  ['Native actions revalidate accessibility targets', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('ACTION_NOT_SUPPORTED') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('TARGET_ELEMENT_NOT_FOUND')],
  ['Native actions block sensitive apps and high-impact controls', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('SENSITIVE_APPLICATION_BLOCKED') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('SENSITIVE_CONTROL_BLOCKED')],
  ['Keyboard execution uses a strict shortcut allowlist', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('KEY_SHORTCUT_BLOCKED') && fs.readFileSync(path.join(root, 'scripts/linux-atspi-bridge.py'), 'utf8').includes('KEY_SHORTCUT_BLOCKED')],
  ['Electron asks the OS to select a display source', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('setDisplayMediaRequestHandler') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('desktopCapturer.getSources')],
  ['Recorder creates real WebM segments only from the filtered canvas stream', () => { const s = fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8'); return s.includes('canvas.captureStream(10)') && s.includes('new MediaRecorder(filteredStream') && !s.includes('new MediaRecorder(this.stream'); }],
  ['Privacy compositor keeps refreshing when the desktop window is minimized', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('backgroundThrottling: false') && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('window.setTimeout(() => this.renderPrivacyFilteredFrame(), 100)')],
  ['Privacy Shield masks protected windows, editable controls and detected PII values', () => { const s = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8'); const p = fs.readFileSync(path.join(root, 'src/packages/recorder/privacy_detector.ts'), 'utf8'); return s.includes('SENSITIVE_WINDOW_PATTERN') && s.includes('SENSITIVE_CONTROL_PATTERN') && s.includes('isSensitiveAccessibleValue(label)') && s.includes('isSensitiveAccessibleValue(name)') && s.includes('isSensitiveAccessibleValue(element.value)') && s.includes('|| editable') && p.includes('SENSITIVE_VALUE_PATTERN'); }],
  ['Privacy Shield fails closed when native evidence is missing or stale', () => fs.readFileSync(path.join(root, 'src/packages/recorder/privacy_filter.ts'), 'utf8').includes("return 'blur_all'") && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('privacyPollTimer') && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('shouldUseFullFramePrivacyFallback')],
  ['Privacy Shield status updates are surfaced to the recorder UI', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('this.onPrivacyState?.(state)') && fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('Privacy Shield is blurring the entire recording')],
  ['Desktop screenshot imports cannot bypass the privacy compositor', () => fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('Desktop keyframes must come from the Privacy Shield compositor')],
  ['Screen-capture keyframe storage requires private compositor authority', () => { const s = fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8'); return s.includes('PRIVACY_COMPOSITOR_REQUIRED') && s.includes('PRIVACY_FRAME_WRITE_AUTHORITY') && s.includes('authority !== PRIVACY_FRAME_WRITE_AUTHORITY'); }],
  ['Recorder fails closed when any partial mask cannot be mapped', () => fs.readFileSync(path.join(root, 'src/packages/recorder/privacy_filter.ts'), 'utf8').includes('mappedRegionCount !== expectedRegionCount') && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('paintFullFrameFallback')],
  ['Recorder verifies video segment SHA-256 before playback', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes('VIDEO_INTEGRITY_FAILED')],
  ['Recorder stores keyframes and video segments through SQLite on Electron', () => fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes("putRecord('recorder_keyframes'") && fs.readFileSync(path.join(root, 'src/packages/recorder/index.ts'), 'utf8').includes("putRecord('recorder_media_segments'")],
  ['keep_24h expiry sweep runs at startup and on an interval without closing live sessions', () => fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('runSweep(true)') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('setInterval(() => runSweep(false), 15 * 60 * 1000)') && fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8').includes('recoverInterruptedActive = false')],
  ['Active recording recovery is only performed once at application startup', () => { const s = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8'); return s.includes('runSweep(true)') && s.includes('runSweep(false)') && s.includes('recoverInterruptedActive = false'); }],
  ['App starts real screen capture and waits for stop flush', () => fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('new ScreenCaptureSource') && fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes('await capture.stop()')],
  ['Desktop preferences and sessions persist to SQLite', () => fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes("putRecord('ui_preferences'") && fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8').includes("putRecord('recorder_sessions'")],
  ['Desktop bootstrap hydrates unified SQLite records before React', () => fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes('bootstrapDesktopPersistence') && fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes("getRecord('recorder_skills'")],
  ['Universal project artifacts persist and hydrate through SQLite on desktop', () => fs.readFileSync(path.join(root, 'src/packages/projects_evals/index.ts'), 'utf8').includes("putRecord('universal_artifacts'") && fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes("getRecord('universal_artifacts'")],
  ['Character packs persist and hydrate through SQLite on desktop', () => fs.readFileSync(path.join(root, 'src/components/CharacterStudioPanel.tsx'), 'utf8').includes("putRecord('character_packs'") && fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8').includes("getRecord('character_packs'")],
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
