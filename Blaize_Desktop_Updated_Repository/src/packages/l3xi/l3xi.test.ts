/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit Tests for L3xi Global Money Assistant (Locale Normalization, Exact Reconciliation, Safe-to-Spend)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTHETIC_STATEMENT_FIXTURES,
  answerL3xiQuestionViaFunctions,
  computeSafeToSpendAndInsights,
  normalizeDatesInFile,
  parseLocaleAwareNumber,
  verifyStatementReconciliation,
} from './index';

test('parseLocaleAwareNumber accurately parses US/UK, European, Indian, and negative accounting formats', () => {
  assert.deepEqual(parseLocaleAwareNumber('1,234.56'), { value: 1234.56, isNegative: false });
  assert.deepEqual(parseLocaleAwareNumber('1.234,56'), { value: 1234.56, isNegative: false });
  assert.deepEqual(parseLocaleAwareNumber('1,23,456.00'), { value: 123456.0, isNegative: false });
  assert.deepEqual(parseLocaleAwareNumber('($49.00)'), { value: -49.0, isNegative: true });
  assert.deepEqual(parseLocaleAwareNumber('-115,50 EUR'), { value: -115.5, isNegative: true });
});

test('normalizeDatesInFile infers DMY/MDY from file context and flags ambiguous dates when undetermined', () => {
  // File with explicit day > 12 (18/10/2026) resolves whole file to DMY without ambiguity
  const dmyResolved = normalizeDatesInFile(['04/10/2026', '18/10/2026']);
  assert.equal(dmyResolved[0].inferredOrder, 'DMY');
  assert.equal(dmyResolved[0].iso, '2026-10-04');
  assert.equal(dmyResolved[0].ambiguous, false);

  // File where all dates have both parts <= 12 flags ambiguous=true
  const ambiguousBatch = normalizeDatesInFile(['04/05/2026', '08/05/2026']);
  assert.equal(ambiguousBatch[0].ambiguous, true);
});

test('verifyStatementReconciliation passes all 3 clean statements and flags all 3 corrupted twins as MISMATCH', () => {
  const ghsClean = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.ghana_momo_sms_clean);
  assert.equal(ghsClean.status, 'VERIFIED');
  assert.equal(ghsClean.discrepancyAmount, 0);

  const ghsCorrupt = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.ghana_momo_sms_corrupted);
  assert.equal(ghsCorrupt.status, 'MISMATCH');
  assert.equal(ghsCorrupt.discrepancyAmount, -150);

  const usdClean = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.us_freelance_csv_clean);
  assert.equal(usdClean.status, 'VERIFIED');
  assert.equal(usdClean.duplicateChargesCount, 1);
  assert.equal(usdClean.injectedMemoAlerts.length, 1);

  const usdCorrupt = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.us_freelance_csv_corrupted);
  assert.equal(usdCorrupt.status, 'MISMATCH');
  assert.equal(usdCorrupt.discrepancyAmount, 49);

  const eurClean = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.eu_india_pdf_clean);
  assert.equal(eurClean.status, 'VERIFIED');
  assert.equal(eurClean.ambiguousDatesCount, 3);

  const eurCorrupt = verifyStatementReconciliation(SYNTHETIC_STATEMENT_FIXTURES.eu_india_pdf_corrupted);
  assert.equal(eurCorrupt.status, 'MISMATCH');
  assert.equal(eurCorrupt.discrepancyAmount, -50);
});

test('computeSafeToSpendAndInsights and answerL3xiQuestionViaFunctions compute exact numbers without model arithmetic', () => {
  const insights = computeSafeToSpendAndInsights(SYNTHETIC_STATEMENT_FIXTURES.ghana_momo_sms_clean, {
    conservativeExpectedIncome: 1400,
    verifiedBalance: 2457.5,
    billsDueThisWeek: 680,
    safetyBuffer: 350,
  });

  // 1400 + 2457.50 - 680 - 350 = 2827.50
  assert.equal(insights.safeToSpendThisWeek, 2827.5);
  assert.equal(insights.totalFees, 7.0);

  const qa = answerL3xiQuestionViaFunctions(
    'What is my safe to spend this week?',
    SYNTHETIC_STATEMENT_FIXTURES.ghana_momo_sms_clean
  );
  assert.equal(qa.calledFunction, 'l3xi.computeSafeToSpendThisWeek()');
  assert.equal(qa.computedPayload.safeToSpendThisWeek, 2827.5);
});
