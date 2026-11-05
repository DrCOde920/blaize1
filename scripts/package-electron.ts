import { execFileSync } from 'node:child_process';
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
