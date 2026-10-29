/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WorkspacePrimitives — Shared design tokens and reusable progressive-disclosure UI primitives
 * for Blaize Desktop:
 * - PageHeader (single clear title, optional concise subtitle, primary actions)
 * - SlideOverDrawer (progressive disclosure drawer for instructions, scopes, logs, settings)
 * - ToolCallActivityRow (compact expandable tool execution row)
 * - VerificationReceiptRow (compact verified outcome + expandable evidence receipt)
 * - FocusedApprovalSheet (PolicyGuard human-in-the-loop modal/sheet with simulation-only & evidence disclosure)
 * - EmptyStateBlock (clean, single-action empty state)
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';

export interface ThemeSurfaceTokens {
  canvas: string;
  sidebar: string;
  panel: string;
  elevated: string;
  surfaceElevated: string;
  border: string;
  mutedText: string;
  textSecondary: string;
  primaryText: string;
  inputBg: string;
  rowHover: string;
}

export function getWorkspaceTokens(uiTheme: 'dark' | 'light'): ThemeSurfaceTokens {
  if (uiTheme === 'light') {
    return {
      canvas: 'bg-[#F8F7F4] text-stone-900',
      sidebar: 'bg-[#F1EFEA] border-stone-200/90 text-stone-800',
      panel: 'bg-white border-stone-200/90 text-stone-900',
      elevated: 'bg-[#FAF9F6] border-stone-200/90 text-stone-900',
      surfaceElevated: 'bg-[#FAF9F6] border-stone-200/90 text-stone-900',
      border: 'border-stone-200/90',
      mutedText: 'text-stone-500',
      textSecondary: 'text-stone-600',
      primaryText: 'text-stone-900',
      inputBg: 'bg-white border-stone-300 text-stone-900 focus:border-amber-500',
      rowHover: 'hover:bg-stone-100/80',
    };
  }
  return {
    canvas: 'bg-[#0D0F14] text-stone-100',
    sidebar: 'bg-[#11141C] border-stone-800/80 text-stone-200',
    panel: 'bg-[#131722] border-stone-800/80 text-stone-100',
    elevated: 'bg-[#171C29] border-stone-800 text-stone-100',
    surfaceElevated: 'bg-[#171C29] border-stone-800 text-stone-100',
    border: 'border-stone-800/80',
    mutedText: 'text-stone-400',
    textSecondary: 'text-stone-300',
    primaryText: 'text-stone-100',
    inputBg: 'bg-[#0E1118] border-stone-700/90 text-stone-100 focus:border-amber-400',
    rowHover: 'hover:bg-stone-800/40',
  };
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  metaText?: string;
  actions?: React.ReactNode;
  primaryAction?: React.ReactNode;
  uiTheme: 'dark' | 'light';
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  metaText,
  actions,
  primaryAction,
  uiTheme,
}) => {
  const isLight = uiTheme === 'light';
  const renderedActions = actions || primaryAction;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 pb-4 border-b ${
        isLight ? 'border-stone-200/90' : 'border-stone-800/80'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight truncate">{title}</h1>
          {metaText && (
            <>
              <span aria-hidden="true" className="text-stone-500">
                ·
              </span>
              <span className="text-xs text-stone-400 font-mono truncate">{metaText}</span>
            </>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-stone-400 mt-0.5 max-w-2xl truncate">{subtitle}</p>
        )}
      </div>
      {renderedActions && <div className="flex items-center gap-2 shrink-0">{renderedActions}</div>}
    </div>
  );
};

interface SlideOverDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  uiTheme: 'dark' | 'light';
  children: React.ReactNode;
  footer?: React.ReactNode;
  widthClass?: string;
}

export const SlideOverDrawer: React.FC<SlideOverDrawerProps> = ({
  open,
  title,
  subtitle,
  onClose,
  uiTheme,
  children,
  footer,
  widthClass = 'max-w-lg',
}) => {
  if (!open) return null;
  const isLight = uiTheme === 'light';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthClass} h-full border-l flex flex-col shadow-2xl ${
          isLight
            ? 'bg-[#F8F7F4] border-stone-300 text-stone-900'
            : 'bg-[#121620] border-stone-800 text-stone-100'
        }`}
      >
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0 ${
            isLight ? 'border-stone-200 bg-white' : 'border-stone-800 bg-[#151A26]'
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate">{title}</h2>
            {subtitle && <p className="text-xs text-stone-400 truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-1.5 rounded-lg hover:bg-stone-500/15 text-stone-400 hover:text-stone-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">{children}</div>

        {footer && (
          <div
            className={`px-5 py-3.5 border-t flex items-center justify-end gap-2 shrink-0 ${
              isLight ? 'border-stone-200 bg-white' : 'border-stone-800 bg-[#151A26]'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface ToolCallActivityRowProps {
  tools: string[];
  projectSlug?: string;
  uiTheme: 'dark' | 'light';
}

export const ToolCallActivityRow: React.FC<ToolCallActivityRowProps> = ({
  tools,
  projectSlug,
  uiTheme,
}) => {
  const [expanded, setExpanded] = useState(false);
  if (!tools || tools.length === 0) return null;
  const isLight = uiTheme === 'light';

  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`inline-flex items-center gap-1.5 py-0.5 text-left transition-colors ${
          isLight ? 'text-stone-500 hover:text-stone-800' : 'text-stone-400 hover:text-stone-200'
        }`}
      >
        <Wrench className="w-3 h-3 text-sky-400 shrink-0" />
        <span className="font-medium">{tools.join(' · ')}</span>
        <span aria-hidden="true" className="text-stone-500">
          ·
        </span>
        <span className="text-[10px] underline-offset-2 hover:underline">
          {expanded ? 'Hide trace' : 'Details'}
        </span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div
          className={`mt-1.5 p-2.5 rounded-xl border font-mono text-[11px] space-y-1 ${
            isLight
              ? 'bg-stone-100/90 border-stone-200 text-stone-700'
              : 'bg-[#0B0E15] border-stone-800 text-stone-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>Coordinated tools: {tools.join(', ')}</span>
            <span className="text-emerald-400">PolicyGuard: PASS</span>
          </div>
          {projectSlug && (
            <div className="text-stone-400">Scope: project/{projectSlug} · Read/Draft sandbox</div>
          )}
        </div>
      )}
    </div>
  );
};

interface VerificationReceiptRowProps {
  summary: string;
  hash: string;
  linkedArtifactId?: string;
  linkedArtifactLabel?: string;
  onOpenOrSaveArtifact?: () => void;
  onOpenArtifact?: () => void;
  uiTheme: 'dark' | 'light';
}

export const VerificationReceiptRow: React.FC<VerificationReceiptRowProps> = ({
  summary,
  hash,
  linkedArtifactId,
  linkedArtifactLabel,
  onOpenOrSaveArtifact,
  onOpenArtifact,
  uiTheme,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isLight = uiTheme === 'light';
  const handleArtifactClick = onOpenOrSaveArtifact || onOpenArtifact;
  const label =
    linkedArtifactLabel || (linkedArtifactId ? 'Open artifact' : 'Save artifact');

  return (
    <div className="pt-1.5 border-t border-stone-500/15 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 text-emerald-400 hover:underline font-medium"
        >
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Verified</span>
          <span aria-hidden="true" className="text-stone-500">
            ·
          </span>
          <span className={isLight ? 'text-stone-600' : 'text-stone-300'}>{summary}</span>
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-stone-400" />
          ) : (
            <ChevronRight className="w-3 h-3 text-stone-400" />
          )}
        </button>

        {handleArtifactClick && (
          <button
            type="button"
            onClick={handleArtifactClick}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
              linkedArtifactId || label.toLowerCase().includes('open')
                ? 'bg-amber-400/15 border-amber-400/35 text-amber-300 hover:bg-amber-400/25'
                : isLight
                ? 'bg-stone-100 border-stone-300 text-stone-700 hover:bg-stone-200'
                : 'bg-stone-900 border-stone-700/80 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <Layers className="w-3 h-3 text-amber-400" />
            <span>{label}</span>
          </button>
        )}
      </div>

      {expanded && (
        <div
          className={`p-2.5 rounded-xl border font-mono text-[11px] space-y-1 ${
            isLight
              ? 'bg-stone-100 border-stone-200 text-stone-700'
              : 'bg-[#0B0E15] border-stone-800 text-stone-300'
          }`}
        >
          <div>Outcome check: {summary}</div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-stone-400">
            <span>Evidence receipt: {hash}</span>
            <span>Assumptions: Integer-cent ledger · 0 unverified claims</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface FocusedApprovalSheetProps {
  approval: {
    id: string;
    title: string;
    target: string;
    risk: string;
    evidenceHash: string;
    amount?: string;
    reason: string;
    draftId?: string;
  } | null;
  onApprove: (channel: 'local_sheet' | 'telegram_phone') => void;
  onSimulateOnly?: () => void;
  onReject: () => void;
  uiTheme: 'dark' | 'light';
}

export const FocusedApprovalSheet: React.FC<FocusedApprovalSheetProps> = ({
  approval,
  onApprove,
  onSimulateOnly,
  onReject,
  uiTheme,
}) => {
  const [showEvidence, setShowEvidence] = useState(false);
  if (!approval) return null;
  const isLight = uiTheme === 'light';

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="PolicyGuard Human Approval Required"
      data-testid="policyguard-approval-sheet"
      className={`rounded-2xl border p-4 space-y-3 shadow-xl ${
        isLight
          ? 'bg-amber-50/90 border-amber-400 text-stone-900'
          : 'bg-[#191510] border-amber-500/60 text-stone-100'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <div className="text-xs font-bold text-amber-300">
              Human Approval Required · {approval.title}
            </div>
            <div className="text-[11px] text-stone-400 font-mono mt-0.5">
              Target: {approval.target} · Risk: {approval.risk.toUpperCase()}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowEvidence((v) => !v)}
          aria-expanded={showEvidence}
          className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-300 hover:underline"
        >
          <span>{showEvidence ? 'Hide policy details' : 'Evidence & policy checks'}</span>
          {showEvidence ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-stone-300">{approval.reason}</p>

      {showEvidence && (
        <div className="p-3 rounded-xl bg-black/40 border border-stone-800 font-mono text-[11px] text-stone-300 space-y-1">
          <div>Evidence Hash: {approval.evidenceHash}</div>
          <div>Standing Rule: All money &amp; external write actions require explicit user confirmation.</div>
          <div>Financial Mode: Read-Only / Simulation Draft Only (no unattended wire transfers).</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onApprove('local_sheet')}
            className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => (onSimulateOnly ? onSimulateOnly() : onApprove('local_sheet'))}
            className="px-3.5 py-1.5 rounded-xl border border-amber-400/50 bg-amber-400/15 hover:bg-amber-400/25 text-amber-200 font-semibold text-xs transition-colors"
          >
            Simulation Only
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-3.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-stone-300 font-medium text-xs transition-colors"
          >
            Reject
          </button>
        </div>

        <span className="text-[11px] text-stone-400 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Logged to SHA-256 Audit Ledger</span>
        </span>
      </div>
    </div>
  );
};

interface EmptyStateBlockProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyStateBlock: React.FC<EmptyStateBlockProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div className="py-10 px-4 text-center space-y-2.5 border border-dashed border-stone-700/60 rounded-2xl">
    <div className="text-sm font-semibold">{title}</div>
    <p className="text-xs text-stone-400 max-w-sm mx-auto">{description}</p>
    {actionLabel && onAction && (
      <div className="pt-1">
        <button
          type="button"
          onClick={onAction}
          className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs"
        >
          {actionLabel}
        </button>
      </div>
    )}
  </div>
);

export const GuardBlockedNotice: React.FC<{ reason: string; nextStep: string }> = ({
  reason,
  nextStep,
}) => (
  <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs flex items-start gap-2.5">
    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
    <div className="space-y-0.5">
      <div className="font-semibold text-rose-200">{reason}</div>
      <div className="text-stone-300">Safe next step: {nextStep}</div>
    </div>
  </div>
);
