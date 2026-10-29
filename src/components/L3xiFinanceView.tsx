/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * L3xi Flagship Global Money Assistant View (Section 9)
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { MoneyActionDraft } from '../packages/contracts';
import {
  INITIAL_MONEY_DRAFTS,
  SYNTHETIC_STATEMENT_FIXTURES,
  StatementFormatId,
  answerL3xiQuestionViaFunctions,
  computeSafeToSpendAndInsights,
  parseLocaleAwareNumber,
  verifyStatementReconciliation,
} from '../packages/l3xi';

interface L3xiFinanceViewProps {
  onRequestDraftApproval: (draft: MoneyActionDraft) => void;
  approvedDraftIds: string[];
}

export const L3xiFinanceView: React.FC<L3xiFinanceViewProps> = ({
  onRequestDraftApproval,
  approvedDraftIds,
}) => {
  const [selectedStatementId, setSelectedStatementId] =
    useState<StatementFormatId>('ghana_momo_sms_clean');

  // Editable Safe-to-Spend hypothesis inputs
  const [customIncome, setCustomIncome] = useState<string>('1400');
  const [customBillsDue, setCustomBillsDue] = useState<string>('680');
  const [customBuffer, setCustomBuffer] = useState<string>('350');

  // Locale normalizer interactive tester
  const [rawLocaleTest, setRawLocaleTest] = useState<string>('1.450,75 EUR');

  // Function-calling Q&A state
  const [questionInput, setQuestionInput] = useState<string>(
    'What is my safe to spend this week and are there any duplicate charges?'
  );
  const [activeQueryText, setActiveQueryText] = useState<string>(
    'What is my safe to spend this week?'
  );

  // Money drafts state
  const [drafts, setDrafts] = useState<MoneyActionDraft[]>(INITIAL_MONEY_DRAFTS);
  const [newDraftDest, setNewDraftDest] = useState('Accra Wholesale Depot #8812');
  const [newDraftAmount, setNewDraftAmount] = useState('210.00');
  const [newDraftRef, setNewDraftRef] = useState('Cotton Bale Restock Draft');

  const fixture = SYNTHETIC_STATEMENT_FIXTURES[selectedStatementId];
  const reconciliation = verifyStatementReconciliation(fixture);

  const insights = computeSafeToSpendAndInsights(fixture, {
    conservativeExpectedIncome: Number.parseFloat(customIncome) || 0,
    verifiedBalance: reconciliation.computedClosingBalance,
    billsDueThisWeek: Number.parseFloat(customBillsDue) || 0,
    safetyBuffer: Number.parseFloat(customBuffer) || 0,
  });

  const qaResult = answerL3xiQuestionViaFunctions(activeQueryText, fixture, {
    conservativeExpectedIncome: Number.parseFloat(customIncome) || 0,
    verifiedBalance: reconciliation.computedClosingBalance,
    billsDueThisWeek: Number.parseFloat(customBillsDue) || 0,
    safetyBuffer: Number.parseFloat(customBuffer) || 0,
  });

  const parsedLocaleDemo = parseLocaleAwareNumber(rawLocaleTest);

  const handleSelectFixture = (id: StatementFormatId) => {
    setSelectedStatementId(id);
    const target = SYNTHETIC_STATEMENT_FIXTURES[id];
    if (target.currency === 'GHS') {
      setCustomIncome('1400');
      setCustomBillsDue('680');
      setCustomBuffer('350');
    } else if (target.currency === 'USD') {
      setCustomIncome('1850');
      setCustomBillsDue('920');
      setCustomBuffer('400');
    } else {
      setCustomIncome('1600');
      setCustomBillsDue('750');
      setCustomBuffer('300');
    }
  };

  const handleCreateDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = Number.parseFloat(newDraftAmount) || 0;
    if (amountNum <= 0 || !newDraftDest.trim()) return;

    const draft: MoneyActionDraft = {
      id: `draft_${Date.now()}`,
      createdAt: new Date().toISOString(),
      amount: amountNum,
      currency: fixture.currency,
      date: '2026-10-28',
      recurrence: 'once',
      destination: newDraftDest.trim(),
      reference: newDraftRef.trim() || 'L3xi Prepared Draft',
      status: 'DRAFT_ONLY',
      environmentLabel: 'SIMULATION',
    };
    setDrafts((prev) => [draft, ...prev]);
    onRequestDraftApproval(draft);
  };

  return (
    <div className="space-y-8">
      {/* Header & 6 Statement Fixture Selector (3 Clean Ground Truth + 3 Corrupted Twins) */}
      <section className="bg-[#0F1623] border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-sky-400">
              FLAGSHIP PLUGIN · L3XI GLOBAL MONEY ASSISTANT WITH CHECKED NUMBERS
            </p>
            <h1 className="text-2xl font-bold text-slate-100 mt-1">
              Statement Ingestion, Locale Normalization & Exact Balance Proof
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Extracts structured records with muse-spark-1.3, normalizes locale numbers in pure code, and proves Opening + Transactions == Closing Balance.
            </p>
          </div>

          {/* Interactive Locale Number Parser Tester */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 shrink-0 space-y-1.5">
            <label htmlFor="locale-parser-input" className="block text-[11px] font-medium text-slate-400">
              Test Code-Level Locale Number Normalizer:
            </label>
            <div className="flex items-center gap-2">
              <input
                id="locale-parser-input"
                type="text"
                value={rawLocaleTest}
                onChange={(e) => setRawLocaleTest(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs font-mono text-slate-100 w-36"
              />
              <span className="text-xs font-mono text-emerald-400 tabular-nums">
                = {parsedLocaleDemo.value.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
              {['1,234.56', '1.234,56', '1,23,456.00', '($49.00)'].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setRawLocaleTest(sample)}
                  className="underline hover:text-slate-200"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3 Synthetic Ground-Truth Statements + 3 Corrupted Twins */}
        <div>
          <span className="block text-xs font-medium text-slate-400 mb-2.5">
            Select Synthetic Statement Fixture (Each Ground-Truth Format Ships with a Corrupted Twin):
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(Object.keys(SYNTHETIC_STATEMENT_FIXTURES) as StatementFormatId[]).map((id) => {
              const item = SYNTHETIC_STATEMENT_FIXTURES[id];
              const active = selectedStatementId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectFixture(id)}
                  className={`text-left p-3.5 rounded-lg border transition-colors ${
                    active
                      ? item.isCorruptedTwin
                        ? 'bg-rose-950/40 border-rose-500/80 text-slate-100'
                        : 'bg-sky-950/40 border-sky-500/80 text-slate-100'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-mono">
                    <span className={item.isCorruptedTwin ? 'text-rose-400' : 'text-emerald-400'}>
                      {item.formatType} · {item.currency} · {item.isCorruptedTwin ? 'CORRUPTED TWIN' : 'GROUND TRUTH'}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-100 mt-1">
                    {item.title}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{item.subtitle}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Deterministic Balance Verification Proof Banner */}
      <section
        className={`rounded-xl border p-6 ${
          reconciliation.status === 'VERIFIED'
            ? 'bg-emerald-950/20 border-emerald-800/80'
            : 'bg-rose-950/30 border-rose-700'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono">
              {reconciliation.status === 'VERIFIED' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span
                className={
                  reconciliation.status === 'VERIFIED'
                    ? 'text-emerald-400 font-semibold'
                    : 'text-rose-400 font-semibold'
                }
              >
                BALANCE RECONCILIATION STATUS: {reconciliation.status}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-300">
                Ambiguous Dates Flagged: {reconciliation.ambiguousDatesCount}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-300">
                Duplicate Charges: {reconciliation.duplicateChargesCount}
              </span>
            </div>

            <div className="text-base font-mono font-semibold text-slate-100 tabular-nums">
              {reconciliation.proofFormula}
            </div>

            <p className="text-xs text-slate-300">
              {reconciliation.status === 'VERIFIED'
                ? 'Exact integer-cent verification passed: Opening balance plus transactions equals stated closing balance.'
                : `CRITICAL MISMATCH DETECTED (${reconciliation.currency} ${reconciliation.discrepancyAmount.toFixed(2)}). L3xi never silently fixes a balance mismatch; human review required.`}
            </p>

            {reconciliation.injectedMemoAlerts.length > 0 && (
              <p className="text-xs font-mono text-amber-300 pt-1">
                Hostile Memo Flagged & Quarantined: {reconciliation.injectedMemoAlerts.join(' | ')}
              </p>
            )}
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 text-right font-mono shrink-0">
            <span className="text-[11px] text-slate-400 block">Computed Closing vs Stated</span>
            <span className="text-lg font-bold text-slate-100 tabular-nums">
              {reconciliation.currency} {reconciliation.computedClosingBalance.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 block tabular-nums">
              Stated: {reconciliation.currency} {reconciliation.statedClosingBalance.toFixed(2)}
            </span>
          </div>
        </div>
      </section>

      {/* Main Split: Normalized Records Table (Left 7) + Safe-to-Spend Formula & Function Q&A (Right 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: Extracted & Normalized Universal Records */}
        <section className="lg:col-span-7 bg-[#0F1623] border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                Normalized Universal Financial Records ({fixture.records.length} rows)
              </h2>
              <p className="text-xs text-slate-400">
                Extracted via muse-spark-1.3 structured schema; normalized & verified in deterministic TypeScript.
              </p>
            </div>
            <FileSpreadsheet className="w-5 h-5 text-slate-400" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-3">ISO Date</th>
                  <th className="py-2.5 px-3">Counterparty & Category</th>
                  <th className="py-2.5 px-3">Flags</th>
                  <th className="py-2.5 pl-3 text-right">Normalized Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {fixture.records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-900/50">
                    <td className="py-2.5 pr-3 font-mono text-slate-300 whitespace-nowrap">
                      <div>{rec.date}</div>
                      <div className="text-[11px] text-slate-500">raw: {rec.rawDate}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-100">{rec.counterparty}</div>
                      <div className="text-[11px] text-slate-400">
                        {rec.category} · {rec.description}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                      {[
                        rec.dateAmbiguous ? 'AMBIGUOUS_DATE' : null,
                        rec.isDuplicate ? 'DUPLICATE_CHARGE' : null,
                        rec.isFee ? 'FEE' : null,
                        rec.isRecurring ? 'RECURRING' : null,
                        rec.injectedMemoAlert ? 'INJECTED_MEMO_QUARANTINED' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'CLEAN'}
                    </td>
                    <td
                      className={`py-2.5 pl-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        rec.direction === 'credit' ? 'text-emerald-400' : 'text-slate-100'
                      }`}
                    >
                      <div>
                        {rec.direction === 'credit' ? '+' : '-'}
                        {rec.currency} {rec.amount.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-500">raw: {rec.rawAmount}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <span className="text-xs font-medium text-slate-400 block mb-1.5">
              Raw Source Document Preview ({fixture.formatType}):
            </span>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
              {fixture.rawSourcePreview}
            </pre>
          </div>
        </section>

        {/* Right 5 Cols: Safe-to-Spend Calculator & Zero-Arithmetic Function Calling Q&A */}
        <section className="lg:col-span-5 bg-[#0F1623] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-emerald-400">
                  INSIGHTS COMPUTED BY CODE · ZERO MODEL ARITHMETIC
                </p>
                <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
                  Safe-to-Spend This Week Calculator
                </h2>
              </div>
              <Calculator className="w-5 h-5 text-slate-400" />
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
              <span className="text-xs text-slate-400 block">
                Safe to Spend This Week (Hypothesis Formula with Exposed Inputs):
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                {insights.currency} {insights.safeToSpendThisWeek.toFixed(2)}
              </div>
              <p className="text-xs font-mono text-slate-300 leading-relaxed">
                {insights.formulaString}
              </p>
            </div>

            {/* Editable Formula Inputs */}
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div>
                <label htmlFor="s2s-income" className="block text-slate-400 mb-1">
                  Expected Income
                </label>
                <input
                  id="s2s-income"
                  type="number"
                  value={customIncome}
                  onChange={(e) => setCustomIncome(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="s2s-bills" className="block text-slate-400 mb-1">
                  Bills Due
                </label>
                <input
                  id="s2s-bills"
                  type="number"
                  value={customBillsDue}
                  onChange={(e) => setCustomBillsDue(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="s2s-buffer" className="block text-slate-400 mb-1">
                  Safety Buffer
                </label>
                <input
                  id="s2s-buffer"
                  type="number"
                  value={customBuffer}
                  onChange={(e) => setCustomBuffer(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
            </div>

            {/* Function-Calling Q&A Box */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <label htmlFor="l3xi-qa-input" className="block text-xs font-semibold text-slate-200">
                Ask L3xi (Model Calls Deterministic Code Functions Only):
              </label>
              <div className="flex gap-2">
                <input
                  id="l3xi-qa-input"
                  type="text"
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setActiveQueryText(questionInput)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Call Tool
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {[
                  'What is my safe to spend this week?',
                  'Are there any duplicate charges or fees?',
                  'Does the opening balance plus transactions match closing?',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => {
                      setQuestionInput(q);
                      setActiveQueryText(q);
                    }}
                    className="px-2 py-1 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded"
                  >
                    {q}
                  </button>
                ))}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="font-mono text-sky-400 text-[11px]">
                  Function Invoked: {qaResult.calledFunction}
                </div>
                <p className="text-slate-200 leading-relaxed">{qaResult.explanation}</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Section 9.7: Money Actions (Drafts Only — SIMULATION in Mock Bank after explicit approval) */}
      <section className="bg-[#0F1623] border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <p className="text-xs font-mono text-amber-400">
              BOUNDED AUTHORITY · DRAFTS ONLY · REAL ACCOUNTS STRICTLY READ-ONLY
            </p>
            <h2 className="text-lg font-semibold text-slate-100 mt-0.5">
              L3xi Money Action Drafts (SIMULATION Execution Only After Approval)
            </h2>
          </div>

          <form onSubmit={handleCreateDraft} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="Draft destination payee"
              placeholder="Destination Payee"
              value={newDraftDest}
              onChange={(e) => setNewDraftDest(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
            />
            <input
              type="number"
              step="0.01"
              aria-label="Draft amount"
              placeholder="Amount"
              value={newDraftAmount}
              onChange={(e) => setNewDraftAmount(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 w-28"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Create SIMULATION Draft
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drafts.map((d) => {
            const isApproved = approvedDraftIds.includes(d.id);
            return (
              <div
                key={d.id}
                className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="space-y-1 text-xs">
                  <div className="font-mono text-[11px] text-amber-300">
                    {d.environmentLabel} · {isApproved ? 'APPROVED_SIMULATION_EXECUTED' : d.status}
                  </div>
                  <div className="font-semibold text-slate-100">
                    {d.destination} —{' '}
                    <span className="font-mono tabular-nums">
                      {d.currency} {d.amount.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    Ref: {d.reference} · Date: {d.date} ({d.recurrence})
                  </div>
                </div>

                {isApproved ? (
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-400 shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                    SIMULATION Executed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRequestDraftApproval(d)}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-500/20 border border-amber-500/60 text-amber-200 hover:bg-amber-500/30 rounded-md whitespace-nowrap shrink-0"
                  >
                    Review & Approve Draft
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
