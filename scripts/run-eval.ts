/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Measured Evaluation & Honest Benchmark Runner (`npm run eval`)
 * Executes:
 * 1. Core runtime measured evaluation suite (`runMeasuredEvaluationSuite`)
 * 2. Real host `NATIVE LOCAL BENCHMARK` suite (`runNativeLocalBenchmarkSuite`)
 * 3. 64-task `SIMULATED BENCHMARK` deterministic verifier suite (`runEverydayPcBenchmarkSuite`)
 * 4. `PUBLIC BENCHMARK` (`OSWorld-Verified`) environment verification (`verifyOSWorldSetup`)
 *
 * Writes `evals/results.md` and `evals/latest-run-log.json` with full task provenance.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMeasuredEvaluationSuite } from '../src/packages/runtime';
import { runEverydayPcBenchmarkSuite } from '../src/packages/pc_operator';

async function main() {
  const report = await runMeasuredEvaluationSuite();
  const pcBenchmark = runEverydayPcBenchmarkSuite('linux');

  const evalsDir = path.resolve(process.cwd(), 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });

  const resultsMdPath = path.join(evalsDir, 'results.md');
  fs.writeFileSync(resultsMdPath, pcBenchmark.markdownReport, 'utf8');

  const runLogPath = path.join(evalsDir, 'latest-run-log.json');
  fs.writeFileSync(
    runLogPath,
    JSON.stringify(
      {
        generatedAtIso: new Date().toISOString(),
        commitSha: pcBenchmark.commitSha,
        hostOsVersion: pcBenchmark.hostOsVersion,
        measuredRuntimeEval: report,
        benchmarks: {
          nativeLocalBenchmark: pcBenchmark.nativeLocalBenchmark,
          simulatedBenchmark: {
            benchmarkCategory: pcBenchmark.benchmarkCategory,
            runId: pcBenchmark.runId,
            executedAtIso: pcBenchmark.executedAtIso,
            platform: pcBenchmark.platform,
            executionState: pcBenchmark.executionState,
            isSimulated: pcBenchmark.isSimulated,
            canPromoteToRealEvidence: pcBenchmark.canPromoteToRealEvidence,
            totalTasks: pcBenchmark.totalTasks,
            ladderOn: pcBenchmark.ladderOn,
            visionOnly: pcBenchmark.visionOnly,
            taskResults: pcBenchmark.taskResults,
          },
          publicBenchmark: pcBenchmark.osWorldVerification,
        },
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('==============================================================');
  console.log(' BLAIZE MEASURED EVALUATION & BENCHMARK SUITE REPORT');
  console.log('==============================================================');
  console.log(` Executed At               : ${report.runAtIso}`);
  console.log(` Commit SHA                : ${pcBenchmark.commitSha}`);
  console.log(` Host OS                   : ${pcBenchmark.hostOsVersion}`);
  console.log('--------------------------------------------------------------');
  console.log(` [Runtime Eval] Replay     : ${report.replaySuccessRatePct}% (False Successes: ${report.falseSuccessCount})`);
  console.log(` [Runtime Eval] Injections : ${report.injectionsBlockedCount} / ${report.totalInjectionCases}`);
  console.log(` [Runtime Eval] PolicyGuard: ${report.guardEnforcementRatePct}%`);
  console.log(` [Runtime Eval] Finance    : ${report.extractionAccuracyPct}% extraction / ${report.balanceCheckDetectionPct}% balance`);
  console.log('--------------------------------------------------------------');
  console.log(
    ` [Category 1] NATIVE LOCAL : ${pcBenchmark.nativeLocalBenchmark.passedTasks}/${pcBenchmark.nativeLocalBenchmark.totalTasks} PASS (${pcBenchmark.nativeLocalBenchmark.executionState}, ${pcBenchmark.nativeLocalBenchmark.totalMeasuredLatencyMs}ms, costSource=${pcBenchmark.nativeLocalBenchmark.costSource})`
  );
  console.log(
    ` [Category 2] SIMULATED    : ${pcBenchmark.ladderOn.passedTasks}/${pcBenchmark.totalTasks} PASS (${pcBenchmark.executionState}, costSource=ESTIMATED, falseSuccesses=${pcBenchmark.ladderOn.falseSuccessCount})`
  );
  console.log(
    ` [Category 3] PUBLIC       : ${pcBenchmark.osWorldVerification.benchmarkName} -> ${pcBenchmark.osWorldVerification.executionState} (ready=${pcBenchmark.osWorldVerification.readyToRunPublicSuite})`
  );
  console.log(` Wrote Report              : ${resultsMdPath}`);
  console.log(` Wrote Raw Provenance Log  : ${runLogPath}`);
  console.log('==============================================================');

  if (
    report.replaySuccessRatePct < 100 ||
    report.falseSuccessCount > 0 ||
    report.guardEnforcementRatePct < 100 ||
    report.balanceCheckDetectionPct < 100 ||
    pcBenchmark.nativeLocalBenchmark.failedTasks > 0 ||
    pcBenchmark.nativeLocalBenchmark.falseSuccessCount > 0 ||
    pcBenchmark.ladderOn.falseSuccessCount > 0
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Evaluation suite failed:', err);
  process.exitCode = 1;
});

