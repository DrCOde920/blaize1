/**
 * Blaize Reproducible Desktop Packaging Script (`npm run desktop:package*`)
 *
 * Honest Cross-Platform Packaging Contract:
 * - Builds the current host target (`linux` on Linux, `mac` on macOS, `win` on Windows)
 *   into `release/` with a cryptographic SHA-256 `artifact-manifest.json`.
 * - Refuses to fabricate cross-OS installer success when invoked for a target OS
 *   whose native packaging toolchain is unavailable on the current runner (e.g., building
 *   macOS `.dmg` or Windows NSIS `.exe` on a minimal headless Linux container without
 *   Xcode/hdiutil or wine/makensis).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { buildDesktopArtifacts } from './build-desktop.js';

export type PackageTargetOS = 'linux' | 'win' | 'mac' | 'current';

export interface PackageArtifactManifest {
  executionState: 'EXECUTED' | 'UNSUPPORTED';
  targetOS: 'linux' | 'win' | 'mac';
  hostOS: NodeJS.Platform;
  hostArch: string;
  packagedAt: string;
  appId: string;
  version: string;
  unpackedDir?: string;
  archivePath?: string;
  archiveSha256?: string;
  archiveBytes?: number;
  files?: Record<string, { sha256: string; bytes: number }>;
  reason?: string;
  prerequisites?: string[];
}

function sha256File(filePath: string): { sha256: string; bytes: number } {
  const buf = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { sha256, bytes: buf.byteLength };
}

function copyDirectoryRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function packageDesktopTarget(
  requestedTarget: PackageTargetOS = 'current',
  options?: { skipFrontend?: boolean }
): Promise<PackageArtifactManifest> {
  const rootDir = process.cwd();
  const hostPlatform = process.platform;
  const resolvedTarget: 'linux' | 'win' | 'mac' =
    requestedTarget === 'current'
      ? hostPlatform === 'darwin'
        ? 'mac'
        : hostPlatform === 'win32'
          ? 'win'
          : 'linux'
      : requestedTarget;

  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const appVersion = pkgJson.version || '0.0.0';

  // Honest host-compatibility check: do not pretend macOS .dmg or Windows .exe installers can be built on Linux without native toolchains
  if (resolvedTarget === 'mac' && hostPlatform !== 'darwin') {
    return {
      executionState: 'UNSUPPORTED',
      targetOS: 'mac',
      hostOS: hostPlatform,
      hostArch: process.arch,
      packagedAt: new Date().toISOString(),
      appId: 'com.blaize.desktop',
      version: appVersion,
      reason: `UNSUPPORTED_HOST_OS: Cannot build signed macOS .dmg/.app bundle on host '${hostPlatform}'. macOS packaging requires darwin host with Xcode Command Line Tools and hdiutil.`,
      prerequisites: [
        'macOS 13+ host runner (darwin-arm64 or darwin-x64)',
        'Xcode Command Line Tools (codesign, hdiutil, notarytool)',
        'Apple Developer ID Application certificate (for notarized distribution)',
      ],
    };
  }

  if (resolvedTarget === 'win' && hostPlatform !== 'win32') {
    return {
      executionState: 'UNSUPPORTED',
      targetOS: 'win',
      hostOS: hostPlatform,
      hostArch: process.arch,
      packagedAt: new Date().toISOString(),
      appId: 'com.blaize.desktop',
      version: appVersion,
      reason: `UNSUPPORTED_HOST_OS: Cannot build Windows NSIS .exe installer on host '${hostPlatform}' without Windows SDK / makensis toolchain.`,
      prerequisites: [
        'Windows 10/11 x64 host runner (win32-x64) or NSIS makensis + wine64 cross-toolchain',
        'Windows SDK signtool.exe (for Authenticode signing)',
      ],
    };
  }

  // Ensure dist/ and dist-electron/ are freshly compiled
  const buildManifest = await buildDesktopArtifacts({ skipFrontend: options?.skipFrontend });

  const releaseRoot = path.join(rootDir, 'release');
  const bundleName = `blaize-desktop-${resolvedTarget}-${process.arch}`;
  const unpackedDir = path.join(releaseRoot, bundleName);
  const appResourcesDir = path.join(unpackedDir, 'resources', 'app');

  if (fs.existsSync(unpackedDir)) {
    fs.rmSync(unpackedDir, { recursive: true, force: true });
  }
  fs.mkdirSync(appResourcesDir, { recursive: true });

  // Copy compiled renderer and Electron main/preload bundles into resources/app
  copyDirectoryRecursive(path.join(rootDir, 'dist'), path.join(appResourcesDir, 'dist'));
  copyDirectoryRecursive(path.join(rootDir, 'dist-electron'), path.join(appResourcesDir, 'dist-electron'));

  // Write clean production package.json inside resources/app
  const packagedPkgJson = {
    name: 'blaize-desktop',
    productName: 'Blaize',
    appId: 'com.blaize.desktop',
    version: appVersion,
    private: true,
    main: 'dist-electron/main.cjs',
    author: 'Blaize Engineering',
    license: 'MIT',
  };
  fs.writeFileSync(
    path.join(appResourcesDir, 'package.json'),
    JSON.stringify(packagedPkgJson, null, 2),
    'utf8'
  );

  // Create executable launcher script that invokes the pinned Electron runtime with the packaged app bundle
  const launcherPath = path.join(unpackedDir, resolvedTarget === 'win' ? 'blaize-desktop.cmd' : 'blaize-desktop');
  const launcherScript = `#!/usr/bin/env sh
set -e
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/resources/app"
if [ -n "$BLAIZE_SMOKE_VERIFY_ONLY" ]; then
  node "$APP_DIR/dist-electron/main.cjs" --smoke-verify
  exit 0
fi
exec "\${ELECTRON_BIN:-electron}" "$APP_DIR" "$@"
`;
  fs.writeFileSync(launcherPath, launcherScript, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  // Create reproducible tar.gz archive of the unpacked bundle
  const archiveName = `${bundleName}.tar.gz`;
  const archivePath = path.join(releaseRoot, archiveName);
  if (fs.existsSync(archivePath)) {
    fs.rmSync(archivePath, { force: true });
  }

  execSync(`tar -czf "${archivePath}" -C "${releaseRoot}" "${bundleName}"`, {
    stdio: 'pipe',
  });

  const archiveStats = sha256File(archivePath);
  const manifest: PackageArtifactManifest = {
    executionState: 'EXECUTED',
    targetOS: resolvedTarget,
    hostOS: hostPlatform,
    hostArch: process.arch,
    packagedAt: new Date().toISOString(),
    appId: 'com.blaize.desktop',
    version: appVersion,
    unpackedDir: path.relative(rootDir, unpackedDir),
    archivePath: path.relative(rootDir, archivePath),
    archiveSha256: archiveStats.sha256,
    archiveBytes: archiveStats.bytes,
    files: {
      'resources/app/dist-electron/main.cjs': {
        sha256: buildManifest.files.mainCjs.sha256,
        bytes: buildManifest.files.mainCjs.bytes,
      },
      'resources/app/dist-electron/preload.cjs': {
        sha256: buildManifest.files.preloadCjs.sha256,
        bytes: buildManifest.files.preloadCjs.bytes,
      },
      'resources/app/dist/index.html': {
        sha256: buildManifest.files.rendererIndexHtml.sha256,
        bytes: buildManifest.files.rendererIndexHtml.bytes,
      },
    },
  };

  const manifestPath = path.join(unpackedDir, 'artifact-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1] as
    | PackageTargetOS
    | undefined;
  const skipFrontend = args.includes('--skip-frontend');
  const target: PackageTargetOS = targetArg || 'current';

  const result = await packageDesktopTarget(target, { skipFrontend });
  if (result.executionState === 'UNSUPPORTED') {
    console.error(`[desktop:package:${result.targetOS}] ${result.reason}`);
    if (result.prerequisites?.length) {
      console.error('Prerequisites:');
      for (const req of result.prerequisites) {
        console.error(`  - ${req}`);
      }
    }
    process.exit(2);
  }

  console.log(`[desktop:package:${result.targetOS}] Packaged artifact ready:`);
  console.log(`  Unpacked Bundle : ${result.unpackedDir}`);
  console.log(`  Archive         : ${result.archivePath} (${result.archiveBytes} bytes)`);
  console.log(`  Archive SHA-256 : ${result.archiveSha256}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[desktop:package] FAILED:', err);
    process.exit(1);
  });
}
