/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-Run Briefing Modal (`src/components/FirstRunBriefingModal.tsx`)
 * - Step 1: Name her + pick one or more Role templates (Home assistant, Work assistant,
 *           Study helper, Custom) + plain-language job description (what to do, devices, off-limits).
 * - Step 2: Identity (secret code), Permissions, Models & Keys (through the Vault), Rules review.
 * - Step 3: Generates the Role section of SOUL.md and a first USER.md + suggested rules & plugins,
 *           and shows Morrow's "Here is what I understand my job to be" summary card for edit & approval.
 */

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import {
  GeneratedBriefingArtifacts,
  ROLE_TEMPLATES,
  RoleTemplateId,
  generateBriefingArtifacts,
} from '../packages/hermes';
import { ModelConnectionTestResult, ModelRouterMode } from '../packages/runtime';

interface FirstRunBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLight: boolean;
  companionName: string;
  onChangeCompanionName: (name: string) => void;
  selectedTemplates: RoleTemplateId[];
  onChangeSelectedTemplates: (templates: RoleTemplateId[]) => void;
  jobDescription: string;
  onChangeJobDescription: (desc: string) => void;
  offLimits: string;
  onChangeOffLimits: (off: string) => void;
  secretCodeInput: string;
  onChangeSecretCodeInput: (pin: string) => void;
  biometricSimulated: boolean;
  onToggleBiometricSimulated: () => void;
  modelMode: ModelRouterMode;
  onTestConnection: () => Promise<ModelConnectionTestResult>;
  connectionTestResult: ModelConnectionTestResult | null;
  onApproveBriefing: (artifacts: GeneratedBriefingArtifacts, approvedSummary: string) => void;
}

export const FirstRunBriefingModal: React.FC<FirstRunBriefingModalProps> = ({
  isOpen,
  onClose,
  isLight,
  companionName,
  onChangeCompanionName,
  selectedTemplates,
  onChangeSelectedTemplates,
  jobDescription,
  onChangeJobDescription,
  offLimits,
  onChangeOffLimits,
  secretCodeInput,
  onChangeSecretCodeInput,
  biometricSimulated,
  onToggleBiometricSimulated,
  modelMode,
  onTestConnection,
  connectionTestResult,
  onApproveBriefing,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [editableSummaryCard, setEditableSummaryCard] = useState<string | null>(null);

  const generated = useMemo(
    () =>
      generateBriefingArtifacts({
        companionName,
        selectedTemplates,
        jobDescription,
        allowedDevices: ['This PC (Local)'],
        offLimits,
      }),
    [companionName, selectedTemplates, jobDescription, offLimits]
  );

  if (!isOpen) return null;

  const activeSummaryText = editableSummaryCard ?? generated.spokenSummaryCard;

  const handleToggleTemplate = (id: RoleTemplateId) => {
    const exists = selectedTemplates.includes(id);
    const next = exists
      ? selectedTemplates.filter((t) => t !== id)
      : [...selectedTemplates, id];
    const finalSelection = next.length > 0 ? next : ([id] as RoleTemplateId[]);
    onChangeSelectedTemplates(finalSelection);

    const tpl = ROLE_TEMPLATES.find((t) => t.id === id);
    if (tpl && !exists) {
      onChangeJobDescription(tpl.defaultJobDescription);
      onChangeOffLimits(tpl.defaultOffLimits);
      setEditableSummaryCard(null);
    }
  };

  const handleReadAloud = () => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(activeSummaryText));
      }
    } catch {
      // Optional TTS
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="First-run briefing"
      data-testid="first-run-onboarding-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xl rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
          isLight
            ? 'bg-white border-stone-200 text-stone-900'
            : 'bg-stone-900 border-stone-800 text-stone-100'
        }`}
      >
        {/* Header & Visual Stepper */}
        <div className="flex items-center justify-between border-b border-stone-800/60 pb-3">
          <div>
            <h2 className="text-base font-semibold">First-Run Briefing &amp; Standing Role</h2>
            <p className="text-stone-400">
              Brief {companionName} on her role, boundaries, vault security, and standing rules.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close briefing"
            className="p-1 rounded-lg hover:bg-stone-500/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual Stepper Pills */}
        <div className="flex items-center gap-2">
          {(
            [
              { num: 1, label: '1. Name & Role' },
              { num: 2, label: '2. Identity & Vault' },
              { num: 3, label: '3. Job Summary & Approve' },
            ] as const
          ).map((s) => (
            <button
              key={s.num}
              type="button"
              data-testid={`briefing-step-btn-${s.num}`}
              onClick={() => setStep(s.num)}
              className={`flex-1 py-1.5 px-3 rounded-xl font-semibold text-xs transition-colors ${
                step === s.num
                  ? 'bg-sky-600 text-white'
                  : 'bg-stone-800/60 text-stone-400 hover:text-stone-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* STEP 1: NAME HER + ROLE TEMPLATES + JOB DESCRIPTION & OFF LIMITS */}
        {step === 1 && (
          <div className="space-y-3.5" data-testid="briefing-step-1">
            <div>
              <label className="block text-stone-400 mb-1 font-medium">Companion Name</label>
              <input
                type="text"
                data-testid="briefing-name-input"
                value={companionName}
                onChange={(e) => {
                  onChangeCompanionName(e.target.value);
                  setEditableSummaryCard(null);
                }}
                className={`w-full px-3 py-1.5 rounded-xl border ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>

            <div>
              <label className="block text-stone-400 mb-1.5 font-medium">
                Pick One or More Role Templates
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_TEMPLATES.map((tpl) => {
                  const active = selectedTemplates.includes(tpl.id);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      data-testid={`role-template-${tpl.id}`}
                      onClick={() => handleToggleTemplate(tpl.id)}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        active
                          ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                          : 'border-stone-800 hover:border-stone-700 text-stone-300'
                      }`}
                    >
                      <div className="font-semibold text-xs">{tpl.label}</div>
                      <div className="text-[11px] text-stone-400 truncate">{tpl.tagline}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-stone-400 mb-1 font-medium">
                What I want you to do for me (and on which devices)
              </label>
              <textarea
                rows={2}
                data-testid="briefing-job-input"
                value={jobDescription}
                onChange={(e) => {
                  onChangeJobDescription(e.target.value);
                  setEditableSummaryCard(null);
                }}
                className={`w-full p-2.5 rounded-xl border ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>

            <div>
              <label className="block text-stone-400 mb-1 font-medium">
                What is strictly off limits
              </label>
              <input
                type="text"
                data-testid="briefing-offlimits-input"
                value={offLimits}
                onChange={(e) => {
                  onChangeOffLimits(e.target.value);
                  setEditableSummaryCard(null);
                }}
                className={`w-full px-3 py-1.5 rounded-xl border ${
                  isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-1.5 rounded-xl bg-sky-600 text-white font-semibold"
              >
                Next: Identity &amp; Vault
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: IDENTITY (SECRET CODE), PERMISSIONS, MODELS & KEYS (THROUGH VAULT) */}
        {step === 2 && (
          <div className="space-y-3.5" data-testid="briefing-step-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-stone-400 mb-1 font-medium">
                  Secret Code (PassphraseWrap AES-256-GCM)
                </label>
                <input
                  type="password"
                  value={secretCodeInput}
                  onChange={(e) => onChangeSecretCodeInput(e.target.value)}
                  className={`w-full px-3 py-1.5 rounded-xl border ${
                    isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950 border-stone-800'
                  }`}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={onToggleBiometricSimulated}
                  className={`w-full py-1.5 px-3 rounded-xl border font-medium ${
                    biometricSimulated
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-stone-700 text-stone-400'
                  }`}
                >
                  Biometrics (Simulated): {biometricSimulated ? 'Enabled' : 'Off'}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold">
                    Vault &amp; ModelRouter ({modelMode === 'mock' ? 'Mock Default' : 'Live Proxy'})
                  </div>
                  <div className="text-stone-400">
                    Keys stay on server inside SecretVault; renderer only sees masked last 4 chars.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onTestConnection()}
                className="px-3 py-1 rounded-lg bg-sky-600 text-white font-medium"
              >
                Test Connection
              </button>
            </div>

            {connectionTestResult && (
              <div className="p-2.5 rounded-xl border border-stone-800 text-[11px] text-stone-300">
                {connectionTestResult.message}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3 py-1.5 rounded-xl border border-stone-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-4 py-1.5 rounded-xl bg-sky-600 text-white font-semibold"
              >
                Next: Review Job Summary
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: "HERE IS WHAT I UNDERSTAND MY JOB TO BE" SUMMARY CARD & APPROVAL */}
        {step === 3 && (
          <div className="space-y-3.5" data-testid="briefing-step-3">
            <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  <span>&ldquo;Here is what I understand my job to be&rdquo;</span>
                </span>
                <button
                  type="button"
                  onClick={handleReadAloud}
                  className="px-2.5 py-1 rounded-lg bg-stone-900/80 border border-stone-700 text-stone-200 inline-flex items-center gap-1"
                >
                  <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Read Back</span>
                </button>
              </div>

              <textarea
                rows={3}
                data-testid="briefing-summary-card-textarea"
                value={activeSummaryText}
                onChange={(e) => setEditableSummaryCard(e.target.value)}
                className={`w-full p-2.5 rounded-xl border text-xs ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-950 border-stone-800'
                }`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
              <div className="p-3 rounded-xl border border-stone-800 space-y-1">
                <div className="font-semibold text-stone-200">Generated Standing Rules</div>
                {generated.suggestedRules.map((r, idx) => (
                  <div key={idx} className="text-stone-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">{r}</span>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-xl border border-stone-800 space-y-1">
                <div className="font-semibold text-stone-200">
                  Generated Files (SOUL.md + USER.md)
                </div>
                <div className="text-stone-400">
                  Updates Role section of <code>SOUL.md</code> and initializes{' '}
                  <code>USER.md</code>. Editable anytime in Settings &gt; Role.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-stone-800/60">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-3 py-1.5 rounded-xl border border-stone-700"
              >
                Back
              </button>
              <button
                type="button"
                data-testid="approve-briefing-btn"
                onClick={() => {
                  onApproveBriefing(generated, activeSummaryText);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Approve Standing Role &amp; Save</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
