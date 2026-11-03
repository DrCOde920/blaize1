/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scoped Workspace Tests (`src/packages/browser_ide/scoped_workspace.test.ts`)
 * Verifies path canonicalization, traversal and symlink escape defenses,
 * real file operations with SHA-256 validation, diff staging, checkpoints,
 * and restricted command execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ScopedWorkspaceManager,
  RestrictedCommandRegistry,
} from './scoped_workspace';

function createTempWorkspace(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-workspace-test-'));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    },
  };
}

test('ScopedWorkspaceManager: denies directory traversal outside workspace root', () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);

    assert.throws(
      () => ws.readFile('../outside.txt'),
      /WORKSPACE_PATH_TRAVERSAL_DENIED/
    );

    assert.throws(
      () => ws.writeFile('../../etc/passwd', 'malicious'),
      /WORKSPACE_PATH_TRAVERSAL_DENIED/
    );

    assert.throws(
      () => ws.deleteFile('/etc/hosts'),
      /WORKSPACE_PATH_TRAVERSAL_DENIED/
    );
  } finally {
    cleanup();
  }
});

test('ScopedWorkspaceManager: denies following symlinks pointing outside workspace', () => {
  const { dir, cleanup } = createTempWorkspace();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-outside-'));
  const secretOutside = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretOutside, 'confidential', 'utf8');

  try {
    const ws = new ScopedWorkspaceManager(dir);

    // Create a symlink inside the workspace pointing to outside
    const linkPath = path.join(dir, 'escape-link.txt');
    fs.symlinkSync(secretOutside, linkPath);

    assert.throws(
      () => ws.readFile('escape-link.txt'),
      /WORKSPACE_PATH_TRAVERSAL_DENIED/
    );

    assert.throws(
      () => ws.writeFile('escape-link.txt', 'overwrite'),
      /WORKSPACE_PATH_TRAVERSAL_DENIED/
    );
  } finally {
    try {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    cleanup();
  }
});

test('ScopedWorkspaceManager: performs real file operations with SHA-256 verification', () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);

    // 1. Write file
    const writeRes = ws.writeFile('src/app.ts', 'console.log("hello world");\n');
    assert.equal(writeRes.verified, true);
    assert.equal(typeof writeRes.sha256, 'string');
    assert.equal(writeRes.sha256.length, 64);

    // 2. Read file
    const readRes = ws.readFile('src/app.ts');
    assert.equal(readRes.content, 'console.log("hello world");\n');
    assert.equal(readRes.sha256, writeRes.sha256);

    // 3. Stat file
    const statRes = ws.statFile('src/app.ts');
    assert.ok(statRes);
    assert.equal(statRes.sha256, writeRes.sha256);
    assert.equal(statRes.sizeBytes, 'console.log("hello world");\n'.length);

    // 4. List files
    const listRes = ws.listFiles();
    assert.ok(listRes.files.some((f) => f.path === 'src/app.ts'));

    // 5. Delete file
    const delRes = ws.deleteFile('src/app.ts');
    assert.equal(delRes.deleted, true);
    assert.equal(ws.statFile('src/app.ts'), null);
  } finally {
    cleanup();
  }
});

test('ScopedWorkspaceManager: stages diffs and applies them with verification', () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);

    ws.writeFile('index.ts', 'const a = 1;\n');

    const proposal = ws.stageDiff('index.ts', 'const a = 2;\nconst b = 3;\n', 'Update constants');
    assert.equal(proposal.status, 'staged');
    assert.equal(proposal.addedLinesCount, 2);

    const applyRes = ws.applyStagedDiff(proposal.id);
    assert.equal(applyRes.verified, true);

    const afterRead = ws.readFile('index.ts');
    assert.equal(afterRead.content, 'const a = 2;\nconst b = 3;\n');
  } finally {
    cleanup();
  }
});

test('ScopedWorkspaceManager: creates checkpoints and rolls back on demand', () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);

    ws.writeFile('state.json', '{"version": 1}');
    const cp = ws.createCheckpoint('Before breaking update');

    // Mutate file and add new file
    ws.writeFile('state.json', '{"version": 2}');
    ws.writeFile('new_broken.ts', 'throw new Error();');

    assert.equal(ws.readFile('state.json').content, '{"version": 2}');
    assert.ok(ws.statFile('new_broken.ts'));

    // Rollback
    const rollbackRes = ws.rollbackCheckpoint(cp.id);
    assert.equal(rollbackRes.rolledBack, true);

    // Verify state restored
    assert.equal(ws.readFile('state.json').content, '{"version": 1}');
    assert.equal(ws.statFile('new_broken.ts'), null);
  } finally {
    cleanup();
  }
});

test('RestrictedCommandRegistry: enforces allowlist and explicit user grants', async () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const registry = new RestrictedCommandRegistry();

    // 1. Safe command in allowlist (e.g. echo or node --version)
    const result = await registry.executeRestrictedCommand({
      commandClass: 'test',
      binary: 'echo',
      args: ['passed'],
      workspaceRoot: dir,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.executionState, 'EXECUTED');
    assert.match(result.stdout, /passed/);

    // 2. Prohibited command class without grant token
    await assert.rejects(
      async () => {
        await registry.executeRestrictedCommand({
          commandClass: 'untrusted_shell' as any,
          binary: 'rm',
          args: ['-rf', '/'],
          workspaceRoot: dir,
        });
      },
      /COMMAND_NOT_ALLOWLISTED/
    );

    // 3. User grant enables explicit execution
    const grant = registry.grantCommandClass('untrusted_shell', 'Explicit user test approval');
    assert.ok(grant.token);

    const grantedRes = await registry.executeRestrictedCommand({
      commandClass: 'untrusted_shell' as any,
      binary: 'echo',
      args: ['with_grant'],
      workspaceRoot: dir,
      userGrantToken: grant.token,
    });
    assert.equal(grantedRes.exitCode, 0);
    assert.match(grantedRes.stdout, /with_grant/);
  } finally {
    cleanup();
  }
});
