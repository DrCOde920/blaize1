/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skill Replay Engine Tests (`src/packages/runtime/skill_replay_engine.test.ts`)
 * Verifies parameterized skill replay, precondition enforcement, drift detection,
 * automatic checkpoint rollback on failure, and observable evidence generation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  SkillReplayEngine,
  ParameterizedSkill,
} from './skill_replay_engine';
import { ScopedWorkspaceManager } from '../browser_ide/scoped_workspace';

function createTempWorkspace(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaize-replay-test-'));
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

test('SkillReplayEngine: performs dry run simulation with SIMULATED truth state', async () => {
  const engine = new SkillReplayEngine();
  const skill: ParameterizedSkill = {
    id: 'skill-dry-run',
    name: 'Sample Dry Run',
    version: '1.0.0',
    steps: [
      {
        id: 'step-1',
        intentLabel: 'Write temporary file',
        actionType: 'file_write',
        target: 'sample.txt',
        value: 'hello',
        preconditions: [],
        expectedPostCondition: 'sample.txt exists',
        verifier: { strategy: 'file_exists_hash', target: 'sample.txt' },
      },
    ],
  };

  const res = await engine.replaySkill(skill, { dryRun: true });

  assert.equal(res.ok, true);
  assert.equal(res.isSimulated, true);
  assert.equal(res.isRealExecution, false);
  assert.equal(res.executionState, 'SIMULATED');
  assert.equal(res.stepReceipts[0].matchedBy, 'dry_run_simulation');
});

test('SkillReplayEngine: halts execution when precondition fails', async () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);
    const engine = new SkillReplayEngine();

    const skill: ParameterizedSkill = {
      id: 'skill-precheck-fail',
      name: 'Precondition Failure Test',
      version: '1.0.0',
      steps: [
        {
          id: 'step-1',
          intentLabel: 'Mutate config',
          actionType: 'file_write',
          target: 'output.txt',
          value: 'data',
          preconditions: [
            {
              type: 'file_exists',
              target: 'required_parent_config.json',
              description: 'Config must exist before mutation',
            },
          ],
          expectedPostCondition: 'output.txt exists',
          verifier: { strategy: 'file_exists_hash', target: 'output.txt' },
        },
      ],
    };

    const res = await engine.replaySkill(skill, { workspace: ws });

    assert.equal(res.ok, false);
    assert.equal(res.executionState, 'FAILED');
    assert.match(res.error || '', /Precondition failed.*required_parent_config\.json/);
    assert.equal(ws.statFile('output.txt'), null);
  } finally {
    cleanup();
  }
});

test('SkillReplayEngine: executes real workspace step with observable hash evidence', async () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);
    const engine = new SkillReplayEngine();

    const targetContent = 'export const API_VERSION = "2.1.0";\n';
    const expectedHash = crypto.createHash('sha256').update(targetContent).digest('hex');

    const skill: ParameterizedSkill = {
      id: 'skill-real-write',
      name: 'Real Workspace Write',
      version: '1.0.0',
      steps: [
        {
          id: 'step-1',
          intentLabel: 'Write API version module',
          actionType: 'file_write',
          target: 'src/version.ts',
          value: targetContent,
          preconditions: [],
          expectedPostCondition: 'src/version.ts written with correct hash',
          verifier: {
            strategy: 'file_exists_hash',
            target: 'src/version.ts',
            expectedHash,
          },
        },
      ],
    };

    const res = await engine.replaySkill(skill, { workspace: ws });

    assert.equal(res.ok, true);
    assert.equal(res.isRealExecution, true);
    assert.equal(res.executionState, 'EXECUTED');
    assert.equal(res.verificationState, 'VERIFIED');

    const receipt = res.stepReceipts[0];
    assert.equal(receipt.verified, true);
    assert.ok(receipt.verificationEvidence);
    assert.equal(receipt.verificationEvidence.criteriaMet, true);
    assert.equal(receipt.verificationEvidence.evidenceHash, expectedHash);

    // Verify on disk
    const diskStat = ws.statFile('src/version.ts');
    assert.ok(diskStat);
    assert.equal(diskStat.sha256, expectedHash);
  } finally {
    cleanup();
  }
});

test('SkillReplayEngine: detects layout drift and recovers via accessible name anchor', async () => {
  const engine = new SkillReplayEngine();

  const skill: ParameterizedSkill = {
    id: 'skill-drift-recovery',
    name: 'Drift Recovery Test',
    version: '1.0.0',
    steps: [
      {
        id: 'step-1',
        intentLabel: 'Click Checkout Button',
        actionType: 'click',
        target: '#btn-checkout-v1',
        accessibleName: 'Proceed to Checkout',
        role: 'button',
        preconditions: [],
        expectedPostCondition: 'Navigated to checkout',
        verifier: { strategy: 'default_assertion', target: 'checkout' },
      },
    ],
  };

  const res = await engine.replaySkill(skill, { chaosLayoutChanged: true });

  assert.equal(res.ok, true);
  const receipt = res.stepReceipts[0];
  assert.equal(receipt.driftDetected, true);
  assert.equal(receipt.matchedBy, 'drift_recovered_anchor');
  assert.match(receipt.driftDetails || '', /recovered by intent anchor/);
});

test('SkillReplayEngine: rolls back checkpoint when postcondition verifier fails', async () => {
  const { dir, cleanup } = createTempWorkspace();
  try {
    const ws = new ScopedWorkspaceManager(dir);
    const engine = new SkillReplayEngine();

    // Initial valid file
    ws.writeFile('important_data.txt', 'initial valid state');

    const skill: ParameterizedSkill = {
      id: 'skill-rollback-on-failure',
      name: 'Rollback Test',
      version: '1.0.0',
      steps: [
        {
          id: 'step-1',
          intentLabel: 'Corrupt important data with invalid hash expectation',
          actionType: 'file_write',
          target: 'important_data.txt',
          value: 'corrupted temporary text',
          preconditions: [],
          expectedPostCondition: 'important_data.txt matches expected hash',
          verifier: {
            strategy: 'file_exists_hash',
            target: 'important_data.txt',
            expectedHash: '0000000000000000000000000000000000000000000000000000000000000000', // Intentional mismatch!
          },
        },
      ],
    };

    const res = await engine.replaySkill(skill, { workspace: ws });

    assert.equal(res.ok, false);
    assert.equal(res.verificationState, 'FAILED');
    assert.equal(res.rollbacksExecuted.length, 1);

    const receipt = res.stepReceipts[0];
    assert.equal(receipt.rolledBack, true);
    assert.match(receipt.error || '', /hash mismatch/i);

    // Verify disk content rolled back to initial state!
    const rolledBackFile = ws.readFile('important_data.txt');
    assert.equal(rolledBackFile.content, 'initial valid state');
  } finally {
    cleanup();
  }
});
