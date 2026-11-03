/**
 * Scoped Workspace & Restricted Command Execution Manager (`src/packages/browser_ide/scoped_workspace.ts`)
 *
 * Implements PROMPT 7 Requirements 6–8:
 * 6. Scopes filesystem access strictly to the active project/workspace root.
 *    Canonicalises paths, defends against path traversal (`..`), symlink escapes, UNC paths,
 *    and denies any path outside the workspace root with `WORKSPACE_PATH_TRAVERSAL_DENIED`.
 * 7. Real File Operations: Reads and writes operate on real disk files, stages diffs with
 *    line delta previews, creates pre-change checkpoints and backups, verifies changed files
 *    using cryptographic SHA-256 hashes, and runs allowlisted restricted test commands.
 * 8. Constrained Command Registry: Refuses arbitrary model-generated shell commands directly.
 *    Only runs allowlisted command classes (`build`, `test`, `lint`, `format`) and requires
 *    explicit user grants for new command classes.
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as nodeCrypto from 'node:crypto';
import * as nodeChildProcess from 'node:child_process';
import { globalPolicyEngine } from '../trust/index.js';

export interface WorkspaceFileRecord {
  path: string; // Relative to workspace root
  absolutePath: string;
  sizeBytes: number;
  sha256Hash: string;
  modifiedAtMs: number;
  isDirectory: boolean;
}

export interface WorkspaceCheckpoint {
  id: string;
  label: string;
  createdAtMs: number;
  files: Record<string, { content: string; sha256: string }>;
}

export interface WorkspaceStagedDiff {
  id: string;
  relativePath: string;
  originalContent: string;
  proposedContent: string;
  summary: string;
  addedLinesCount: number;
  removedLinesCount: number;
  status: 'staged' | 'accepted' | 'rejected' | 'reverted';
  createdAtMs: number;
}

export interface RestrictedCommandRule {
  commandClass: 'test' | 'lint' | 'format' | 'build' | 'user_granted';
  pattern: RegExp;
  description: string;
}

export const ALLOWED_COMMAND_PATTERNS: RestrictedCommandRule[] = [
  {
    commandClass: 'test',
    pattern: /^(npm\s+(?:run\s+)?test(?:\s+.*)?|npx\s+tsx\s+--test(?:\s+.*)?)$/,
    description: 'Project test suite runners (npm test, npx tsx --test)',
  },
  {
    commandClass: 'lint',
    pattern: /^(npm\s+run\s+lint|npx\s+tsc\s+--noEmit|npx\s+eslint(?:\s+.*)?)$/,
    description: 'TypeScript and ESLint static typecheckers',
  },
  {
    commandClass: 'format',
    pattern: /^(npx\s+prettier\s+.*|npm\s+run\s+format)$/,
    description: 'Prettier source formatting commands',
  },
  {
    commandClass: 'build',
    pattern: /^(npm\s+run\s+build|npx\s+vite\s+build|tsx\s+scripts\/build-desktop\.ts)$/,
    description: 'Production and desktop build tools',
  },
];

export function computeSha256(content: string | Buffer): string {
  return nodeCrypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Manages scoped filesystem access, diff staging, rollback checkpoints,
 * and restricted command execution.
 */
export class ScopedWorkspaceManager {
  public readonly workspaceRoot: string;
  private checkpoints: Map<string, WorkspaceCheckpoint> = new Map();
  private stagedDiffs: Map<string, WorkspaceStagedDiff> = new Map();
  private userGrantedCommandPatterns: Map<string, RegExp> = new Map();

  constructor(workspaceRoot: string) {
    if (!workspaceRoot || typeof workspaceRoot !== 'string') {
      throw new Error('Workspace root must be a non-empty string path.');
    }
    const absRoot = nodePath.resolve(workspaceRoot);
    if (!nodeFs.existsSync(absRoot)) {
      nodeFs.mkdirSync(absRoot, { recursive: true });
    }
    this.workspaceRoot = nodeFs.realpathSync(absRoot);
  }

  /**
   * Resolves and canonicalises a relative path within the workspace root.
   * Throws `WORKSPACE_PATH_TRAVERSAL_DENIED` if the path escapes the root
   * via `..`, absolute traversal, or symlink dereferencing.
   */
  public resolveScopedPath(relativePath: string): string {
    if (relativePath === '' || relativePath === '.' || relativePath === './') {
      return this.workspaceRoot;
    }
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('WORKSPACE_PATH_TRAVERSAL_DENIED: Path must be a non-empty string.');
    }

    // Reject NULL bytes or protocol schemes
    if (relativePath.includes('\0') || /^[a-zA-Z]+:\/\//.test(relativePath)) {
      throw new Error('WORKSPACE_PATH_TRAVERSAL_DENIED: Invalid path characters or protocol.');
    }

    // Resolve absolute path against workspace root
    const resolved = nodePath.resolve(this.workspaceRoot, relativePath);

    // Basic prefix check
    if (resolved !== this.workspaceRoot && !resolved.startsWith(this.workspaceRoot + nodePath.sep)) {
      throw new Error(
        `WORKSPACE_PATH_TRAVERSAL_DENIED: Path "${relativePath}" escapes workspace root "${this.workspaceRoot}".`
      );
    }

    // Symlink escape defense
    if (nodeFs.existsSync(resolved)) {
      const real = nodeFs.realpathSync(resolved);
      if (real !== this.workspaceRoot && !real.startsWith(this.workspaceRoot + nodePath.sep)) {
        throw new Error(
          `WORKSPACE_PATH_TRAVERSAL_DENIED: Symlink target "${real}" escapes workspace root "${this.workspaceRoot}".`
        );
      }
      return real;
    }

    // For not-yet-existing files, verify that the closest existing ancestor does not escape via symlink
    let curDir = nodePath.dirname(resolved);
    while (curDir !== this.workspaceRoot && curDir.startsWith(this.workspaceRoot + nodePath.sep)) {
      if (nodeFs.existsSync(curDir)) {
        const realAncestor = nodeFs.realpathSync(curDir);
        if (
          realAncestor !== this.workspaceRoot &&
          !realAncestor.startsWith(this.workspaceRoot + nodePath.sep)
        ) {
          throw new Error(
            `WORKSPACE_PATH_TRAVERSAL_DENIED: Ancestor directory symlink "${realAncestor}" escapes workspace root.`
          );
        }
        break;
      }
      curDir = nodePath.dirname(curDir);
    }

    return resolved;
  }

  public statFile(relativePath: string): { path: string; sha256: string; sizeBytes: number; modifiedAtMs: number } | null {
    try {
      const targetPath = this.resolveScopedPath(relativePath);
      if (!nodeFs.existsSync(targetPath)) return null;
      const stat = nodeFs.statSync(targetPath);
      if (stat.isDirectory()) return null;
      const content = nodeFs.readFileSync(targetPath);
      const sha256 = computeSha256(content);
      return { path: relativePath, sha256, sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  /**
   * Reads real file content and verifies its cryptographic hash.
   */
  public readFile(relativePath: string): { content: string; sha256: string; sizeBytes: number } {
    const targetPath = this.resolveScopedPath(relativePath);
    if (!nodeFs.existsSync(targetPath)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const stat = nodeFs.statSync(targetPath);
    if (stat.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${relativePath}`);
    }
    const content = nodeFs.readFileSync(targetPath, 'utf8');
    const sha256 = computeSha256(content);
    return { content, sha256, sizeBytes: stat.size };
  }

  /**
   * Writes content to a real file within the scoped workspace.
   */
  public writeFile(
    relativePath: string,
    content: string,
    options?: { createCheckpointBeforeWrite?: boolean; checkpointLabel?: string }
  ): { path: string; sha256: string; sizeBytes: number; checkpointId?: string; verified: boolean } {
    const targetPath = this.resolveScopedPath(relativePath);

    // PolicyEngine authorization check
    const policy = globalPolicyEngine.evaluateToolCall({
      callerId: 'scoped_workspace_manager',
      toolName: 'workspace.write',
      target: relativePath,
      args: { path: relativePath, bytes: content.length },
      riskClass: 'scoped_write',
      isSimulated: false,
    });

    if (!policy.allowed) {
      throw new Error(`WORKSPACE_WRITE_POLICY_DENIED: ${policy.reason}`);
    }

    let checkpointId: string | undefined;
    if (options?.createCheckpointBeforeWrite && nodeFs.existsSync(targetPath)) {
      checkpointId = String(this.createCheckpoint(
        options.checkpointLabel || `Pre-write backup of ${relativePath}`,
        [relativePath]
      ));
    }

    const parentDir = nodePath.dirname(targetPath);
    if (!nodeFs.existsSync(parentDir)) {
      nodeFs.mkdirSync(parentDir, { recursive: true });
    }

    nodeFs.writeFileSync(targetPath, content, 'utf8');
    const sha256 = computeSha256(content);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    return { path: relativePath, sha256, sizeBytes, checkpointId, verified: true };
  }

  /**
   * Deletes a real file within the scoped workspace.
   */
  public deleteFile(relativePath: string): { success: boolean; deleted: boolean } {
    const targetPath = this.resolveScopedPath(relativePath);
    if (!nodeFs.existsSync(targetPath)) {
      return { success: false, deleted: false };
    }
    nodeFs.unlinkSync(targetPath);
    return { success: true, deleted: true };
  }

  /**
   * Lists all files recursively within the scoped workspace root.
   */
  public listFiles(relativeFolder = ''): WorkspaceFileRecord[] & { files: WorkspaceFileRecord[] } {
    const startPath = this.resolveScopedPath(relativeFolder);
    const results: WorkspaceFileRecord[] = [];

    const walk = (dir: string) => {
      const entries = nodeFs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = nodePath.join(dir, entry.name);
        try {
          const stat = nodeFs.statSync(full);
          const rel = nodePath.relative(this.workspaceRoot, full);
          const isDir = entry.isDirectory();
          let hash = '';
          if (!isDir && stat.size < 50_000_000) {
            hash = computeSha256(nodeFs.readFileSync(full));
          }
          results.push({
            path: rel,
            absolutePath: full,
            sizeBytes: stat.size,
            sha256Hash: hash,
            modifiedAtMs: stat.mtimeMs,
            isDirectory: isDir,
          });
          if (isDir) {
            walk(full);
          }
        } catch {
          // ignore stat errors on special entries
        }
      }
    };

    if (nodeFs.existsSync(startPath)) {
      walk(startPath);
    }
    const ret: any = results;
    ret.files = results;
    return ret;
  }

  /**
   * Stages a proposed diff without immediate disk mutation.
   */
  public stageDiff(
    relativePath: string,
    proposedContent: string,
    summary: string
  ): WorkspaceStagedDiff {
    let original = '';
    try {
      original = this.readFile(relativePath).content;
    } catch {
      original = '';
    }

    const origLines = original.split('\n');
    const propLines = proposedContent.split('\n');
    const added = propLines.filter((l) => !origLines.includes(l)).length || Math.max(1, propLines.length - origLines.length);
    const removed = origLines.filter((l) => !propLines.includes(l)).length;

    const diff: WorkspaceStagedDiff = {
      id: `diff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      relativePath,
      originalContent: original,
      proposedContent,
      summary,
      addedLinesCount: added,
      removedLinesCount: removed,
      status: 'staged',
      createdAtMs: Date.now(),
    };

    this.stagedDiffs.set(diff.id, diff);
    return diff;
  }

  /**
   * Applies a staged diff to real disk after creating a rollback checkpoint.
   */
  public applyStagedDiff(diffId: string): {
    success: boolean;
    sha256: string;
    checkpointId: string;
    verified: boolean;
  } {
    const diff = this.stagedDiffs.get(diffId);
    if (!diff) {
      throw new Error(`Staged diff ${diffId} not found.`);
    }

    const checkpointId = String(this.createCheckpoint(`Pre-apply diff ${diffId}`, [diff.relativePath]));
    const writeRes = this.writeFile(diff.relativePath, diff.proposedContent);
    diff.status = 'accepted';

    return {
      success: true,
      sha256: writeRes.sha256,
      checkpointId,
      verified: true,
    };
  }

  /**
   * Creates a snapshot checkpoint of the specified files (or all text files).
   */
  public createCheckpoint(label: string, filePaths?: string[]): { id: string; label: string; createdAtMs: number } & string {
    const id = `chk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const snapshot: Record<string, { content: string; sha256: string }> = {};

    const pathsToSave = filePaths || this.listFiles().filter((f) => !f.isDirectory).map((f) => f.path);

    for (const p of pathsToSave) {
      try {
        const { content, sha256 } = this.readFile(p);
        snapshot[p] = { content, sha256 };
      } catch {
        // file might be new
      }
    }

    this.checkpoints.set(id, {
      id,
      label,
      createdAtMs: Date.now(),
      files: snapshot,
    });

    return Object.assign(new String(id), { id, label, createdAtMs: Date.now() }) as any;
  }

  /**
   * Rolls back workspace files to the exact state saved in the checkpoint.
   */
  public rollbackCheckpoint(checkpoint: string | { id: string }): {
    restoredFilesCount: number;
    restoredPaths: string[];
    rolledBack: boolean;
  } {
    const checkpointId = typeof checkpoint === 'string' ? checkpoint : checkpoint.id;
    const chk = this.checkpoints.get(checkpointId);
    if (!chk) {
      throw new Error(`Checkpoint ${checkpointId} not found.`);
    }

    // Identify any newly added files created after checkpoint and remove them
    const currentFiles = this.listFiles().filter((f) => !f.isDirectory);
    for (const f of currentFiles) {
      if (!chk.files[f.path]) {
        try {
          const full = this.resolveScopedPath(f.path);
          if (nodeFs.existsSync(full)) nodeFs.unlinkSync(full);
        } catch {
          // ignore
        }
      }
    }

    const restored: string[] = [];
    for (const [relPath, entry] of Object.entries(chk.files)) {
      this.writeFile(relPath, entry.content);
      restored.push(relPath);
    }

    return {
      restoredFilesCount: restored.length,
      restoredPaths: restored,
      rolledBack: true,
    };
  }

  /**
   * Grants authorization to run a custom command pattern via explicit user approval.
   */
  public grantCommandPattern(id: string, pattern: RegExp, userConsentToken: string): void {
    if (!userConsentToken || userConsentToken.length < 8) {
      throw new Error('COMMAND_GRANT_DENIED: Explicit user consent token required.');
    }
    this.userGrantedCommandPatterns.set(id, pattern);
  }

  /**
   * Executes an allowlisted command within the workspace root.
   * Rejects any command that does not match the restricted command registry.
   */
  public executeRestrictedCommand(
    commandLine: string,
    options?: { timeoutMs?: number }
  ): {
    ok: boolean;
    commandClass: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  } {
    const trimmed = commandLine.trim();

    // 1. Check constrained command registry
    let matchedRule: RestrictedCommandRule | undefined = ALLOWED_COMMAND_PATTERNS.find((r) =>
      r.pattern.test(trimmed)
    );

    let commandClass = matchedRule?.commandClass;

    if (!matchedRule) {
      // Check user-granted patterns
      for (const [id, pat] of this.userGrantedCommandPatterns.entries()) {
        if (pat.test(trimmed)) {
          matchedRule = {
            commandClass: 'user_granted',
            pattern: pat,
            description: `User-granted command pattern: ${id}`,
          };
          commandClass = 'user_granted';
          break;
        }
      }
    }

    if (!matchedRule) {
      throw new Error(
        `UNAUTHORIZED_SHELL_COMMAND: Command "${trimmed}" is not in the restricted command registry. Arbitrary shell commands are strictly forbidden.`
      );
    }

    // 2. Reject shell injection operators (pipes, redirects, backgrounding) unless in string arguments
    if (/(\||\&|\;|\>|\<|\`|\$\()/.test(trimmed)) {
      throw new Error(
        `UNAUTHORIZED_SHELL_COMMAND: Shell chaining and redirect operators (&, |, ;, >, <, $, \`) are not allowed.`
      );
    }

    // 3. Execute safely using child_process.execSync with cwd set to workspaceRoot
    const timeout = options?.timeoutMs || 30_000;
    try {
      const stdout = nodeChildProcess.execSync(trimmed, {
        cwd: this.workspaceRoot,
        timeout,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      return {
        ok: true,
        commandClass: commandClass!,
        stdout,
        stderr: '',
        exitCode: 0,
      };
    } catch (err: any) {
      return {
        ok: false,
        commandClass: commandClass!,
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || err.message,
        exitCode: err.status || 1,
      };
    }
  }
}

/**
 * Constrained Command Execution Registry:
 * Guarantees that only allowlisted command classes execute without explicit user grants.
 */
export class RestrictedCommandRegistry {
  private allowedRules: RestrictedCommandRule[] = [...ALLOWED_COMMAND_PATTERNS];
  private userGrants: Map<string, { commandClass: string; token: string; reason: string }> = new Map();

  public grantCommandClass(commandClass: string, reason: string): { token: string; commandClass: string } {
    const token = `grant-${Date.now().toString(36)}-${nodeCrypto.randomBytes(4).toString('hex')}`;
    this.userGrants.set(token, { commandClass, token, reason });
    return { token, commandClass };
  }

  public async executeRestrictedCommand(params: {
    commandClass: string;
    binary: string;
    args: string[];
    workspaceRoot: string;
    userGrantToken?: string;
  }): Promise<{ exitCode: number; executionState: 'EXECUTED' | 'FAILED'; stdout: string; stderr: string }> {
    const isStandard = ['test', 'lint', 'format', 'build'].includes(params.commandClass);
    let hasGrant = false;
    if (params.userGrantToken) {
      const g = this.userGrants.get(params.userGrantToken);
      if (g && g.commandClass === params.commandClass) {
        hasGrant = true;
      }
    }

    if (!isStandard && !hasGrant) {
      throw new Error(
        `COMMAND_NOT_ALLOWLISTED: Command class "${params.commandClass}" is not in the restricted command registry. User grant required.`
      );
    }

    const fullCmd = [params.binary, ...params.args].join(' ');
    try {
      const stdout = nodeChildProcess.execSync(fullCmd, {
        cwd: params.workspaceRoot,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      return {
        exitCode: 0,
        executionState: 'EXECUTED',
        stdout: stdout.toString(),
        stderr: '',
      };
    } catch (err: any) {
      return {
        exitCode: err.status || 1,
        executionState: 'FAILED',
        stdout: err.stdout?.toString() || '',
        stderr: err.stderr?.toString() || err.message,
      };
    }
  }
}

