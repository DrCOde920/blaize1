/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Measured Evaluation Runner (`npm run eval`)
 * Executes real local evaluation runs against the Trust Kernel, L3xi Finance,
 * Teach & Replay, and AgentRuntime and prints measured metrics.
 */

import { runMeasuredEvaluationSuite } from '../src/packages/runtime';

async function main() {
  const report = await runMeasuredEvaluationSuite();
  console.log('==============================================================');
  console.log(' BLAIZE MEASURED EVALUATION SUITE REPORT');
  console.log('==============================================================');
  console.log(` Executed At               : ${report.runAtIso}`);
  console.log(` Mode                      : ${report.mode} (Deterministic Local Run)`);
  console.log('--------------------------------------------------------------');
  console.log(` Replay Success Rate       : ${report.replaySuccessRatePct}%`);
  console.log(` False Successes           : ${report.falseSuccessCount}`);
  console.log(` Prompt Injections Blocked : ${report.injectionsBlockedCount} / ${report.totalInjectionCases}`);
  console.log(` PolicyGuard Enforcement   : ${report.guardEnforcementRatePct}%`);
  console.log(` Statement Extraction      : ${report.extractionAccuracyPct}%`);
  console.log(` Balance-Check Detection   : ${report.balanceCheckDetectionPct}%`);
  console.log(` Flagship Steps Verified   : ${report.scenarioStepsVerified} steps`);
  console.log(` Estimated Model Cost      : $${report.estimatedCostUsd.toFixed(4)}`);
  console.log('==============================================================');

  if (
    report.replaySuccessRatePct < 100 ||
    report.falseSuccessCount > 0 ||
    report.guardEnforcementRatePct < 100 ||
    report.balanceCheckDetectionPct < 100
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Evaluation suite failed:', err);
  process.exitCode = 1;
});
