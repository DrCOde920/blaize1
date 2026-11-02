/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Morrow 2D Companion — PerchTargets Edition (No Chair Stage):
 * 1. Chat page ('composer-top'): Morrow sits directly on the top edge of the composer
 *    with legs dangling, looking at the text cursor while typing and looking up while thinking.
 *    Consumes zero extra vertical layout space.
 * 2. Other pages ('panel-top-right', 'screen-floor', 'sidebar-footer'):
 *    She perches on the top-right edge of the content panel or stands on the floor line.
 *    Users can drag her or move her to any perch, remembered per page in localStorage.
 * 3. Obstacle Avoidance: Moves aside automatically when the approval sheet is open or
 *    nearby inputs are focused.
 * 4. Click Popover: Header with name, status chip (icon + plain text), gear icon at top right;
 *    message list; inline approval cards; prompt box with mic and send. Esc or second click closes.
 * 5. Collapse to Status Dot: Menu option or Alt+H collapses her to a subtle status dot.
 * 6. Natural Idle Ladder & Activity Mapping: No manual animation buttons anywhere.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Compass,
  Mic,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Video,
  Pause,
  Play,
  Square,
  Flag,
  MessageSquarePlus,
  Minus,
  Plus,
} from 'lucide-react';
import {
  MorrowState,
  PersonalityId,
  TalkDecisionLog,
} from '../packages/contracts';
import {
  COMPANION_LOOK_PRESETS,
  CompiledPersonalityProfile,
  Live2DExpressionId,
  Live2DPropId,
  Live2DProportionMode,
  MissionEngineActivityEvent,
  MorrowAnimationAction,
  MorrowPresenceState,
  PERCH_TARGETS_REGISTRY,
  PerchTargetId,
  PRESENCE_STATE_USAGE_MAP,
  computePerchPlacement,
  computePopoverPlacement,
  mapModelActivityToPresence,
} from '../packages/living';
import { MorrowLive2DRig } from './MorrowLive2DRig';

export type HubNavigationTarget =
  | 'mission_control'
  | 'blaize_browser'
  | 'trust_ledger'
  | 'evals_sleep';

export interface CompanionChatTurnMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  verifiedProof?: {
    hash: string;
    summary: string;
  };
}

interface MorrowCompanionProps {
  morrowState: MorrowState;
  setMorrowState: (s: MorrowState) => void;
  personalityId: PersonalityId;
  setPersonalityId: (p: PersonalityId) => void;
  talkLogs: TalkDecisionLog[];
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  onDismissNotification: () => void;
  dismissalCount: number;
  pendingApproval: {
    id: string;
    title: string;
    target: string;
    risk: string;
    evidenceHash: string;
    amount?: string;
    reason: string;
  } | null;
  onApproveAction: (channel: 'local_sheet' | 'telegram_phone') => void;
  onRejectAction: () => void;
  onSimulateOnlyAction?: () => void;
  onRecordUserCorrection: (correctionText: string, promoteToRule: boolean) => void;
  onSubmitVoiceMission: (transcript: string) => void;
  companionName?: string;
  onChangeCompanionName?: (name: string) => void;
  activeLookId?: string;
  onChangeLookId?: (lookId: string) => void;
  activeAnimAction?: MorrowAnimationAction;
  onChangeAnimAction?: (action: MorrowAnimationAction, reason?: string) => void;
  activeLive2DProp?: Live2DPropId;
  onChangeLive2DProp?: (prop: Live2DPropId) => void;
  activeLive2DExpression?: Live2DExpressionId;
  onChangeLive2DExpression?: (expr: Live2DExpressionId) => void;
  activeLive2DProportion?: Live2DProportionMode;
  onChangeLive2DProportion?: (mode: Live2DProportionMode) => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  isPlayingMusic?: boolean;
  onToggleMusic?: () => void;
  onOpenStudioFileManager?: () => void;
  onNavigateHub?: (tab: HubNavigationTarget) => void;
  companionScale?: number;
  onChangeCompanionScale?: (scale: number) => void;
  compiledPersonality?: CompiledPersonalityProfile;
  onUpdateCompiledPersonality?: (profile: CompiledPersonalityProfile) => void;
  uiTheme?: 'dark' | 'light';
  onToggleUiTheme?: () => void;
  missionActivityEvent?: MissionEngineActivityEvent;
  onStopActiveMission?: () => void;
  activeView?: string;
  isChatViewOpen?: boolean;
  compactChatStage?: boolean;
  onToggleCompactChatStage?: () => void;
  sidebarCollapsed?: boolean;
  chatArtifactDrawerOpen?: boolean;
  artifactDrawerWidthPx?: number;
  onJumpToChat?: () => void;
  onOpenSoulView?: () => void;
  onOpenSettingsSection?: (section: string) => void;
  chatMessages?: CompanionChatTurnMessage[];
  onSendChatMessage?: (text: string) => void;
  isAiThinking?: boolean;
  isTypingInComposer?: boolean;
  customizeOpen?: boolean;
  setCustomizeOpen?: (open: boolean) => void;
  screenAwarenessMode?: 'off' | 'ask' | 'recording';
  onChangeScreenAwarenessMode?: (mode: 'off' | 'ask' | 'recording') => void;
  isRecordingSkill?: boolean;
  isRecordingPaused?: boolean;
  recordingElapsedSec?: number;
  activeRecorderSourceLabel?: string;
  onOpenRecordConsent?: () => void;
  onPauseResumeRecording?: () => void;
  onStopAndReviewRecording?: () => void;
  onAddRecordingNote?: (note: string) => void;
  onMarkRecordingCheckpoint?: () => void;
  characterParametricState?: {
    scalePct: number;
    opacityPct: number;
    speedMultiplier: number;
    position: string;
    palette: {
      hairColor: string;
      accentBraidColor: string;
      jacketColor: string;
      topColor: string;
      eyeColor: string;
    };
    accessories: {
      headphones: boolean;
      starClips: boolean;
      hoopEarrings: boolean;
      neckChains: boolean;
      glasses: boolean;
    };
  };
}

const PERCH_STORAGE_KEY = 'blaize_perch_by_page_v1';
const DOT_COLLAPSED_STORAGE_KEY = 'blaize_morrow_collapsed_dot_v1';
const COMPANION_SCALE_STORAGE_KEY = 'blaize_companion_scale_pct_v1';

export const MorrowCompanion: React.FC<MorrowCompanionProps> = ({
  morrowState,
  focusMode,
  setFocusMode,
  pendingApproval,
  onApproveAction,
  onRejectAction,
  onSimulateOnlyAction,
  onSubmitVoiceMission,
  companionName = 'Morrow',
  onChangeCompanionName,
  activeLookId = 'look-sage-emerald',
  onChangeLookId,
  activeLive2DProp = 'none',
  onChangeLive2DProp,
  activeLive2DExpression = 'default',
  activeLive2DProportion = 'vtuber_full',
  onChangeLive2DProportion,
  voiceEnabled = false,
  onToggleVoice,
  isPlayingMusic = false,
  onToggleMusic,
  companionScale,
  onChangeCompanionScale,
  uiTheme = 'dark',
  missionActivityEvent,
  activeView,
  isChatViewOpen: isChatViewOpenProp,
  sidebarCollapsed = false,
  chatArtifactDrawerOpen = false,
  artifactDrawerWidthPx = 460,
  onJumpToChat,
  onOpenSoulView,
  onOpenSettingsSection,
  chatMessages = [],
  onSendChatMessage,
  isAiThinking = false,
  isTypingInComposer = false,
  customizeOpen: externalCustomizeOpen,
  setCustomizeOpen: setExternalCustomizeOpen,
  screenAwarenessMode = 'off',
  onChangeScreenAwarenessMode,
  isRecordingSkill = false,
  isRecordingPaused = false,
  recordingElapsedSec = 0,
  activeRecorderSourceLabel = 'In-app events',
  onOpenRecordConsent,
  onPauseResumeRecording,
  onStopAndReviewRecording,
  onAddRecordingNote,
  onMarkRecordingCheckpoint,
  characterParametricState,
}) => {
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const [quickNoteText, setQuickNoteText] = useState('');

  // Adjustable floating figure scale (50% to 200%)
  const [localScalePct, setLocalScalePct] = useState<number>(() => {
    if (typeof companionScale === 'number' && companionScale > 0) {
      return Math.round(companionScale <= 3 ? companionScale * 100 : companionScale);
    }
    if (typeof characterParametricState?.scalePct === 'number') {
      return characterParametricState.scalePct;
    }
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(COMPANION_SCALE_STORAGE_KEY);
        if (raw) {
          const parsed = Number(raw);
          if (!Number.isNaN(parsed) && parsed >= 50 && parsed <= 200) return parsed;
        }
      } catch {
        // ignore storage errors
      }
    }
    return 100;
  });

  useEffect(() => {
    if (typeof companionScale === 'number' && companionScale > 0) {
      const pct = Math.round(companionScale <= 3 ? companionScale * 100 : companionScale);
      setLocalScalePct(Math.max(50, Math.min(200, pct)));
    } else if (typeof characterParametricState?.scalePct === 'number') {
      setLocalScalePct(Math.max(50, Math.min(200, characterParametricState.scalePct)));
    }
  }, [companionScale, characterParametricState?.scalePct]);

  const effectiveScalePct = Math.max(50, Math.min(200, localScalePct));
  const effectiveScale = effectiveScalePct / 100;
  const scaledWidthPx = Math.round(80 * effectiveScale);
  const scaledHeightPx = Math.round(96 * effectiveScale);

  const handleUpdateScalePct = useCallback(
    (nextPctRaw: number) => {
      const clamped = Math.max(50, Math.min(200, Math.round(nextPctRaw)));
      setLocalScalePct(clamped);
      try {
        window.localStorage.setItem(COMPANION_SCALE_STORAGE_KEY, String(clamped));
      } catch {
        // ignore storage errors
      }
      if (onChangeCompanionScale) {
        onChangeCompanionScale(clamped / 100);
      }
    },
    [onChangeCompanionScale]
  );
  const formattedRecTimer = `${String(Math.floor(recordingElapsedSec / 60)).padStart(2, '0')}:${String(
    recordingElapsedSec % 60
  ).padStart(2, '0')}`;
  const isLight = uiTheme === 'light';
  const resolvedPageId = activeView ?? (isChatViewOpenProp !== false ? 'chat' : 'other');
  const isChatViewOpen = resolvedPageId === 'chat';

  // Per-page remembered perch registry
  const [rememberedPerches, setRememberedPerches] = useState<Partial<Record<string, PerchTargetId>>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(PERCH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Collapse to small status dot
  const [collapsedToDot, setCollapsedToDot] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DOT_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsedToDot = useCallback((next?: boolean) => {
    setCollapsedToDot((prev) => {
      const val = next !== undefined ? next : !prev;
      try {
        window.localStorage.setItem(DOT_COLLAPSED_STORAGE_KEY, String(val));
      } catch {
        // ignore storage errors
      }
      return val;
    });
  }, []);

  // Natural idle ladder: stand_idle -> 45s -> sit_idle -> 180s -> rest -> 600s -> sleep
  const [idleStage, setIdleStage] = useState<MorrowPresenceState>('sit_idle');
  const [neverSit, setNeverSit] = useState<boolean>(false);
  const [neverSleep, setNeverSleep] = useState<boolean>(false);

  useEffect(() => {
    if (isAiThinking || isTypingInComposer || pendingApproval) {
      setIdleStage(neverSit ? 'stand_idle' : 'sit_idle');
      return;
    }
    const sitTimer = window.setTimeout(() => {
      setIdleStage(neverSit ? 'stand_idle' : 'sit_idle');
    }, 45_000);
    const restTimer = window.setTimeout(() => {
      if (!neverSleep) setIdleStage('rest');
    }, 180_000);
    const sleepTimer = window.setTimeout(() => {
      if (!neverSleep) setIdleStage('sleep');
    }, 600_000);
    return () => {
      window.clearTimeout(sitTimer);
      window.clearTimeout(restTimer);
      window.clearTimeout(sleepTimer);
    };
  }, [isAiThinking, isTypingInComposer, pendingApproval, neverSit, neverSleep, resolvedPageId]);

  // Measure active perch target DOM element on resize & scroll
  const [viewportDims, setViewportDims] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const [targetRect, setTargetRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const activePerchId: PerchTargetId = useMemo(() => {
    const saved = rememberedPerches[resolvedPageId];
    if (saved && PERCH_TARGETS_REGISTRY[saved]) return saved;
    return isChatViewOpen ? 'composer-top' : 'panel-top-right';
  }, [rememberedPerches, resolvedPageId, isChatViewOpen]);

  const measurePerchTarget = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    setViewportDims({ width: window.innerWidth, height: window.innerHeight });
    const spec = PERCH_TARGETS_REGISTRY[activePerchId];
    const el = document.querySelector(spec.elementSelector);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        setTargetRect({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        });
        return;
      }
    }
    setTargetRect(null);
  }, [activePerchId]);

  useEffect(() => {
    measurePerchTarget();
    const rafId = window.requestAnimationFrame(measurePerchTarget);
    window.addEventListener('resize', measurePerchTarget);
    window.addEventListener('scroll', measurePerchTarget, true);

    let observer: ResizeObserver | null = null;
    const spec = PERCH_TARGETS_REGISTRY[activePerchId];
    const el = typeof document !== 'undefined' ? document.querySelector(spec.elementSelector) : null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measurePerchTarget);
      observer.observe(el);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measurePerchTarget);
      window.removeEventListener('scroll', measurePerchTarget, true);
      if (observer) observer.disconnect();
    };
  }, [
    measurePerchTarget,
    activePerchId,
    resolvedPageId,
    sidebarCollapsed,
    chatArtifactDrawerOpen,
    artifactDrawerWidthPx,
  ]);

  const setPerchForCurrentPage = useCallback(
    (perchId: PerchTargetId) => {
      setRememberedPerches((prev) => {
        const next = { ...prev, [resolvedPageId]: perchId };
        try {
          window.localStorage.setItem(PERCH_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [resolvedPageId]
  );

  // Dragging to snap to nearest perch
  const [isDragging, setIsDragging] = useState(false);
  const [dragMoved, setDragMoved] = useState(false);
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handlePointerDownCharacter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragMoved(false);
    setDragOrigin({ x: e.clientX, y: e.clientY });
    setDragDelta({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragOrigin.x;
      const dy = e.clientY - dragOrigin.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        setDragMoved(true);
      }
      setDragDelta({ x: dx, y: dy });
    };
    const onUp = (e: MouseEvent) => {
      setIsDragging(false);
      setDragDelta({ x: 0, y: 0 });
      if (!dragMoved) return;

      // Snap to closest PerchTarget based on drop coordinates
      const dropX = e.clientX;
      const dropY = e.clientY;
      const vw = window.innerWidth || 1440;
      const vh = window.innerHeight || 900;

      if (dropX < 260 && dropY > vh - 260) {
        setPerchForCurrentPage('sidebar-footer');
      } else if (dropY < 240) {
        setPerchForCurrentPage('panel-top-right');
      } else if (isChatViewOpen && Math.abs(dropX - vw / 2) < 420 && dropY > vh - 320) {
        setPerchForCurrentPage('composer-top');
      } else {
        setPerchForCurrentPage('screen-floor');
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, dragOrigin, dragMoved, isChatViewOpen, setPerchForCurrentPage]);

  // Compute perch coordinates and obstacle avoidance
  const perchPlacement = useMemo(
    () =>
      computePerchPlacement({
        pageId: resolvedPageId,
        rememberedPerchByPage: rememberedPerches,
        targetRect,
        viewport: viewportDims,
        isTypingInComposer,
        isAiThinking,
        hasActiveApprovalSheet: Boolean(pendingApproval && isChatViewOpen),
        idlePoseOverride: idleStage,
      }),
    [
      resolvedPageId,
      rememberedPerches,
      targetRect,
      viewportDims,
      isTypingInComposer,
      isAiThinking,
      pendingApproval,
      isChatViewOpen,
      idleStage,
    ]
  );

  // Derive live activity event -> natural expression/presence
  const currentActivityEvent: MissionEngineActivityEvent = useMemo(() => {
    if (missionActivityEvent) return missionActivityEvent;
    if (pendingApproval || morrowState === 'asking_approval') return 'awaiting_approval';
    if (morrowState === 'speaking') return 'streaming_reply';
    if (morrowState === 'working') return 'tool_running';
    if (morrowState === 'verifying') return 'verifying';
    if (morrowState === 'thinking' || isAiThinking) return 'planning';
    if (morrowState === 'done_with_proof') return 'done_verified';
    if (isPlayingMusic) return 'music_playing';
    return 'idle';
  }, [missionActivityEvent, pendingApproval, morrowState, isAiThinking, isPlayingMusic]);

  const activityPresence = useMemo(
    () =>
      mapModelActivityToPresence(currentActivityEvent, {
        importantOrScheduledMission: morrowState === 'done_with_proof',
        toolLabel: 'running tools',
        focusModeOrFullscreen: focusMode,
        dockSide: 'right',
        danceEnthusiasm: 'high',
        warmth: 85,
      }),
    [currentActivityEvent, morrowState, focusMode]
  );

  const effectivePresenceState: MorrowPresenceState = useMemo(() => {
    if (isDragging) return 'carried';
    if (currentActivityEvent !== 'idle') return activityPresence.presenceState;
    return perchPlacement.pose;
  }, [isDragging, currentActivityEvent, activityPresence.presenceState, perchPlacement.pose]);

  const presenceMeta =
    PRESENCE_STATE_USAGE_MAP[effectivePresenceState] || PRESENCE_STATE_USAGE_MAP.sit_idle;

  // Popover state
  const [popoutChatOpen, setPopoutChatOpen] = useState<boolean>(false);
  const [popoutInput, setPopoutInput] = useState<string>('');
  const popoutScrollRef = useRef<HTMLDivElement | null>(null);

  const [internalCustomizeOpen, setInternalCustomizeOpen] = useState(false);
  const customizeOpen =
    externalCustomizeOpen !== undefined ? externalCustomizeOpen : internalCustomizeOpen;
  const setCustomizeOpen = setExternalCustomizeOpen || setInternalCustomizeOpen;

  useEffect(() => {
    if (popoutChatOpen && popoutScrollRef.current) {
      popoutScrollRef.current.scrollTop = popoutScrollRef.current.scrollHeight;
    }
  }, [popoutChatOpen, chatMessages.length, isAiThinking]);

  // Esc closes popover; Alt+M opens popover; Alt+H collapses to status dot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopoutChatOpen(false);
        setCustomizeOpen(false);
      } else if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleCollapsedToDot(false);
        setPopoutChatOpen((prev) => !prev);
      } else if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        toggleCollapsedToDot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCustomizeOpen, toggleCollapsedToDot]);

  const handleSendFromPopout = (preset?: string) => {
    const text = (preset ?? popoutInput).trim();
    if (!text) return;
    if (onSendChatMessage) {
      onSendChatMessage(text);
    } else {
      onSubmitVoiceMission(text);
    }
    if (!preset) {
      setPopoutInput('');
    }
  };

  // Plain-language status chip
  const statusInfo = useMemo(() => {
    if (pendingApproval) {
      return {
        label: 'Needs your approval',
        tone: 'amber' as const,
      };
    }
    if (isAiThinking || morrowState === 'thinking' || morrowState === 'working') {
      return {
        label: 'Thinking',
        tone: 'blue' as const,
      };
    }
    if (morrowState === 'done_with_proof') {
      return {
        label: 'Verified',
        tone: 'emerald' as const,
      };
    }
    if (isTypingInComposer) {
      return {
        label: 'Listening',
        tone: 'neutral' as const,
      };
    }
    return {
      label: 'Ready',
      tone: 'neutral' as const,
    };
  }, [pendingApproval, isAiThinking, morrowState, isTypingInComposer]);

  const popoverCoords = useMemo(
    () =>
      computePopoverPlacement(
        {
          x: perchPlacement.x,
          y: perchPlacement.y,
          width: 84,
          height: 96,
        },
        {
          width: viewportDims.width,
          height: viewportDims.height,
          taskbarHeightPx: 16,
        },
        { width: 356, height: 460 }
      ),
    [perchPlacement.x, perchPlacement.y, viewportDims.width, viewportDims.height]
  );

  // Gaze transform for looking at text cursor vs looking up while thinking
  const gazeTransform =
    perchPlacement.gazeDirection === 'cursor'
      ? 'translate3d(-3px, 2px, 0) rotate(-2deg)'
      : perchPlacement.gazeDirection === 'up_thinking'
        ? 'translate3d(0px, -3px, 0) rotate(2deg)'
        : 'translate3d(0px, 0px, 0)';

  // 1. Collapsed Status Dot mode
  if (collapsedToDot) {
    return (
      <button
        type="button"
        data-testid="morrow-status-dot"
        onClick={() => toggleCollapsedToDot(false)}
        title={`${companionName} (${statusInfo.label}) — Click or press Alt+H to expand`}
        className={`fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium shadow-md transition-all duration-150 ${
          isLight
            ? 'bg-white border-stone-200 text-stone-800 hover:bg-stone-50'
            : 'bg-stone-900 border-stone-800 text-stone-200 hover:border-stone-700'
        }`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            statusInfo.tone === 'amber'
              ? 'bg-amber-500 animate-pulse'
              : statusInfo.tone === 'emerald'
                ? 'bg-emerald-500'
                : statusInfo.tone === 'blue'
                  ? 'bg-sky-500 animate-pulse'
                  : 'bg-emerald-500'
          }`}
        />
        <span>{companionName}</span>
        <span className="text-stone-400">· {statusInfo.label}</span>
      </button>
    );
  }

  return (
    <>
      {/* PERCHED COMPANION (No chair stage; sits on composer-top in Chat or perches on panel edges) */}
      <div
        data-testid="morrow-floating-companion"
        data-perch-active={perchPlacement.perchId}
        data-legs-dangling={perchPlacement.legsDangling ? 'true' : 'false'}
        data-gaze-direction={perchPlacement.gazeDirection}
        data-moved-aside={perchPlacement.movedAsideForObstacle ? 'true' : 'false'}
        data-presence-state={effectivePresenceState}
        data-scale-pct={effectiveScalePct}
        style={{
          left: `${perchPlacement.x + dragDelta.x - Math.round((scaledWidthPx - 80) / 2)}px`,
          top: `${perchPlacement.y + dragDelta.y - Math.round((scaledHeightPx - 96) * 0.78)}px`,
          opacity: (characterParametricState?.opacityPct ?? 100) / 100,
          transition: isDragging
            ? 'none'
            : 'left 160ms cubic-bezier(0.22, 1, 0.36, 1), top 160ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        className="fixed z-40 pointer-events-none select-none flex flex-col items-center"
      >
        <div
          role="button"
          tabIndex={0}
          data-testid="morrow-character-trigger"
          aria-label={`${companionName} (${statusInfo.label}) — Click to open chat popover or drag to another perch`}
          aria-expanded={popoutChatOpen}
          onMouseDown={handlePointerDownCharacter}
          onClick={() => {
            if (dragMoved) return;
            setPopoutChatOpen((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setPopoutChatOpen((prev) => !prev);
            }
          }}
          style={{
            transform: gazeTransform,
            transition: 'transform 150ms ease-out',
          }}
          className={`pointer-events-auto cursor-pointer active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-xl group relative ${
            isRecordingSkill ? 'ring-2 ring-rose-500/80 shadow-lg shadow-rose-500/20' : ''
          }`}
        >
          {/* Floating Recording Control Bar Anchored to Morrow */}
          {isRecordingSkill && (
            <div
              data-testid="morrow-floating-recording-bar"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-7 z-50 px-3 py-2 rounded-2xl border shadow-xl flex flex-col gap-1.5 whitespace-nowrap ${
                isLight
                  ? 'bg-white/98 border-rose-300 text-stone-900'
                  : 'bg-stone-900/98 border-rose-500/40 text-stone-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span className="text-[11px] font-semibold text-rose-500">
                  {isRecordingPaused ? 'PAUSED' : 'REC'} {formattedRecTimer}
                </span>
                <span className="text-[10px] text-stone-400">({activeRecorderSourceLabel})</span>
                <button
                  type="button"
                  data-testid="morrow-rec-pause-btn"
                  onClick={() => onPauseResumeRecording && onPauseResumeRecording()}
                  className="px-2 py-0.5 rounded-md bg-stone-500/15 hover:bg-stone-500/25 text-[11px] font-medium flex items-center gap-1"
                  title="Pause or Resume (Alt+Shift+R)"
                >
                  {isRecordingPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  <span>{isRecordingPaused ? 'Resume' : 'Pause'}</span>
                </button>
                <button
                  type="button"
                  data-testid="morrow-rec-checkpoint-btn"
                  onClick={() => onMarkRecordingCheckpoint && onMarkRecordingCheckpoint()}
                  className="px-2 py-0.5 rounded-md bg-stone-500/15 hover:bg-stone-500/25 text-[11px] font-medium flex items-center gap-1"
                  title="Mark verification checkpoint"
                >
                  <Flag className="w-3 h-3 text-emerald-400" />
                  <span>Checkpoint</span>
                </button>
                <button
                  type="button"
                  data-testid="morrow-rec-note-toggle-btn"
                  onClick={() => setQuickNoteOpen((prev) => !prev)}
                  className="px-2 py-0.5 rounded-md bg-stone-500/15 hover:bg-stone-500/25 text-[11px] font-medium flex items-center gap-1"
                  title="Add narration note"
                >
                  <MessageSquarePlus className="w-3 h-3 text-sky-400" />
                  <span>Add note</span>
                </button>
                <button
                  type="button"
                  data-testid="morrow-rec-stop-btn"
                  onClick={() => onStopAndReviewRecording && onStopAndReviewRecording()}
                  className="px-2.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center gap-1"
                  title="Stop recording and review keyframes"
                >
                  <Square className="w-3 h-3" />
                  <span>Stop</span>
                </button>
              </div>
              {quickNoteOpen && (
                <div className="flex items-center gap-1.5 pt-1 border-t border-stone-700/40">
                  <input
                    type="text"
                    value={quickNoteText}
                    onChange={(e) => setQuickNoteText(e.target.value)}
                    placeholder="Intent note for this step..."
                    className="flex-1 px-2 py-0.5 rounded text-[11px] bg-stone-500/10 border border-stone-500/30 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (quickNoteText.trim() && onAddRecordingNote) {
                        onAddRecordingNote(quickNoteText.trim());
                        setQuickNoteText('');
                        setQuickNoteOpen(false);
                      }
                    }}
                    className="px-2 py-0.5 rounded bg-sky-600 text-white text-[11px] font-medium"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            data-testid="morrow-figure-scale-box"
            style={{
              width: `${scaledWidthPx}px`,
              height: `${scaledHeightPx}px`,
              transition: isDragging ? 'none' : 'width 140ms ease-out, height 140ms ease-out',
            }}
          >
            <MorrowLive2DRig
              action={
                effectivePresenceState === 'sit_idle' || effectivePresenceState === 'sit_down'
                  ? 'sit'
                  : effectivePresenceState === 'walk_left' || effectivePresenceState === 'walk_right'
                    ? 'run'
                    : effectivePresenceState === 'dance' || effectivePresenceState === 'dance_groove'
                      ? 'dance'
                      : effectivePresenceState === 'rest' || effectivePresenceState === 'sleep'
                        ? 'sleep_rest'
                        : 'idle'
              }
              presenceState={effectivePresenceState}
              badge={activityPresence.badge}
              lookId={activeLookId}
              propId={activeLive2DProp}
              expressionId={
                perchPlacement.gazeDirection === 'up_thinking'
                  ? 'starry_surprise'
                  : activeLive2DExpression
              }
              proportionMode={activeLive2DProportion}
              viewAngle={perchPlacement.gazeDirection === 'cursor' ? 'three_quarter' : 'auto'}
              animationPaused={
                effectivePresenceState === 'rest' || effectivePresenceState === 'sleep'
              }
              isSpeaking={!isRecordingSkill && (morrowState === 'speaking' || isAiThinking)}
              isPlayingMusic={isPlayingMusic}
              customPalette={characterParametricState?.palette}
              customAccessories={characterParametricState?.accessories}
              className="w-full h-full"
            />
          </div>

          {/* Subtle status badge & Voice on/off button floating above companion */}
          <div
            className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 px-2.5 py-0.5 rounded-full border text-[10px] font-medium shadow-sm whitespace-nowrap flex items-center gap-1.5 transition-opacity duration-150 ${
              pendingApproval
                ? 'opacity-100 bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'opacity-95 group-hover:opacity-100 ' +
                  (isLight
                    ? 'bg-white/95 border-stone-200 text-stone-700'
                    : 'bg-stone-900/95 border-stone-800 text-stone-200')
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                statusInfo.tone === 'amber'
                  ? 'bg-amber-400'
                  : statusInfo.tone === 'emerald'
                    ? 'bg-emerald-400'
                    : statusInfo.tone === 'blue'
                      ? 'bg-sky-400 animate-pulse'
                      : 'bg-emerald-400'
              }`}
            />
            <span>{companionName}</span>
            <span className="text-stone-400">· {statusInfo.label}</span>
            {onToggleVoice && (
              <button
                type="button"
                data-testid="morrow-voice-toggle-btn"
                aria-label="Voice on/off"
                aria-pressed={voiceEnabled}
                title="Voice on/off"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVoice();
                }}
                className={`p-0.5 rounded transition-colors ${
                  voiceEnabled
                    ? 'text-sky-400 hover:text-sky-300'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {voiceEnabled ? (
                  <Volume2 className="w-3 h-3" />
                ) : (
                  <VolumeX className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CLICK POPOVER (Header with name, status chip with icon+text, gear icon; messages; inline approvals; mic+send composer) */}
      {popoutChatOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${companionName} Chat Popover`}
          data-testid="morrow-popout-chatbox"
          style={{
            left: `${popoverCoords.x}px`,
            top: `${popoverCoords.y}px`,
          }}
          className={`fixed z-50 w-[356px] max-w-[calc(100vw-24px)] rounded-2xl border shadow-xl flex flex-col overflow-hidden transition-all duration-150 ${
            isLight
              ? 'bg-white border-stone-200 text-stone-900'
              : 'bg-stone-900 border-stone-800 text-stone-100'
          }`}
        >
          {/* Header: Name, status chip with icon and text, gear icon at top right */}
          <div
            className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900 border-stone-800'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-sm truncate">{companionName}</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                  statusInfo.tone === 'amber'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : statusInfo.tone === 'emerald'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : statusInfo.tone === 'blue'
                        ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                        : isLight
                          ? 'bg-stone-100 border-stone-200 text-stone-600'
                          : 'bg-stone-800 border-stone-700 text-stone-300'
                }`}
              >
                {statusInfo.tone === 'amber' ? (
                  <ShieldAlert className="w-3 h-3" />
                ) : statusInfo.tone === 'emerald' ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <CircleDot className="w-3 h-3" />
                )}
                <span>{statusInfo.label}</span>
              </span>
            </div>

            <div className="flex items-center gap-1">
              {onToggleVoice && (
                <button
                  type="button"
                  data-testid="morrow-popover-voice-toggle-btn"
                  onClick={onToggleVoice}
                  aria-label="Voice on/off"
                  aria-pressed={voiceEnabled}
                  title="Voice on/off"
                  className={`p-1.5 rounded-lg transition-colors ${
                    voiceEnabled
                      ? 'text-sky-400 bg-sky-500/10'
                      : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/50'
                  }`}
                >
                  {voiceEnabled ? (
                    <Volume2 className="w-3.5 h-3.5" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                type="button"
                data-testid="morrow-popover-gear-btn"
                onClick={() => {
                  setPopoutChatOpen(false);
                  if (onOpenSettingsSection) {
                    onOpenSettingsSection('character');
                  } else {
                    setCustomizeOpen(!customizeOpen);
                  }
                }}
                aria-label={`${companionName} settings`}
                title={`Open ${companionName} settings (Name, Size & Appearance)`}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-500/15"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPopoutChatOpen(false)}
                aria-label="Close chat popover"
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-500/15"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Perch selector & Collapse to dot bar */}
          <div
            className={`px-3 py-2 border-b flex items-center justify-between gap-2 text-[11px] ${
              isLight ? 'bg-stone-50/60 border-stone-200 text-stone-600' : 'bg-stone-950/50 border-stone-800 text-stone-400'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate">
              <Compass className="w-3 h-3 shrink-0" />
              <span>Perch:</span>
              <select
                aria-label="Select perch for this page"
                value={perchPlacement.perchId}
                onChange={(e) => setPerchForCurrentPage(e.target.value as PerchTargetId)}
                className={`px-1.5 py-0.5 rounded border text-[11px] ${
                  isLight ? 'bg-white border-stone-200 text-stone-800' : 'bg-stone-900 border-stone-700 text-stone-200'
                }`}
              >
                {Object.values(PERCH_TARGETS_REGISTRY).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setPopoutChatOpen(false);
                toggleCollapsedToDot(true);
              }}
              className="text-[11px] hover:underline whitespace-nowrap"
            >
              Collapse to dot
            </button>
          </div>

          {/* Message List */}
          <div
            ref={popoutScrollRef}
            className="p-3 space-y-2.5 max-h-64 overflow-y-auto text-xs"
          >
            {chatMessages.length === 0 ? (
              <div className="text-center py-6 text-stone-400">
                Ask {companionName} anything or run a verified skill from here.
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[86%] rounded-2xl px-3 py-2 leading-relaxed space-y-1 ${
                      msg.role === 'user'
                        ? 'bg-sky-600 text-white'
                        : isLight
                          ? 'bg-stone-100 border border-stone-200 text-stone-800'
                          : 'bg-stone-800/80 border border-stone-700/70 text-stone-200'
                    }`}
                  >
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-sky-400">
                        <Wrench className="w-3 h-3 shrink-0" />
                        <span className="truncate">{msg.toolsUsed.join(' · ')}</span>
                      </div>
                    )}
                    <div>{msg.content.replace(/\*\*/g, '')}</div>
                    {msg.verifiedProof && (
                      <div className="flex items-center gap-1 text-[11px] text-emerald-400 pt-0.5">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">Verified</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isAiThinking && (
              <div className="text-[11px] text-sky-400 pl-1">{companionName} is thinking...</div>
            )}

            {/* Approval Cards Inline */}
            {pendingApproval && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-xs">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>Needs your approval: {pendingApproval.title}</span>
                </div>
                <p className="text-stone-300 text-[11px]">{pendingApproval.reason}</p>
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onApproveAction('local_sheet')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 text-[11px]"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={onRejectAction}
                    className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 text-[11px]"
                  >
                    Reject
                  </button>
                  {onSimulateOnlyAction && (
                    <button
                      type="button"
                      onClick={onSimulateOnlyAction}
                      className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 text-[11px]"
                    >
                      Simulation only
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Prompt box with Mic and Send */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendFromPopout();
            }}
            className={`p-2.5 border-t flex items-center gap-2 ${
              isLight ? 'border-stone-200 bg-white' : 'border-stone-800 bg-stone-950'
            }`}
          >
            <input
              type="text"
              aria-label={`Message ${companionName}`}
              value={popoutInput}
              onChange={(e) => setPopoutInput(e.target.value)}
              placeholder={`Message ${companionName}...`}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-stone-500 px-1"
            />
            <button
              type="button"
              data-testid="morrow-mic-btn"
              onClick={() =>
                handleSendFromPopout(
                  'Summarize the files in this project and verify their SHA-256 hashes'
                )
              }
              aria-label="Talk with microphone"
              title="Talk with microphone"
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-500/15"
            >
              <Mic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="morrow-record-chip"
              onClick={() => {
                setPopoutChatOpen(false);
                if (isRecordingSkill) {
                  if (onStopAndReviewRecording) onStopAndReviewRecording();
                } else if (onOpenRecordConsent) {
                  onOpenRecordConsent();
                }
              }}
              aria-label={isRecordingSkill ? 'Stop recording' : 'Record skill'}
              title={
                isRecordingSkill
                  ? 'Stop recording and review keyframes'
                  : 'Record a task into a reusable skill (asks consent first)'
              }
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-xl font-medium text-[11px] transition-colors ${
                isRecordingSkill
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/30'
              }`}
            >
              <Video className="w-3 h-3" />
              <span>{isRecordingSkill ? 'Stop' : 'Record'}</span>
            </button>
            <button
              type="submit"
              aria-label="Send message"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors"
            >
              <span>Send</span>
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}

      {/* Quick Appearance & Idle Preferences Popover (no manual animation buttons) */}
      {customizeOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${companionName} preferences`}
          className={`fixed top-16 right-6 z-50 w-76 rounded-2xl border p-4 shadow-xl space-y-3 text-xs ${
            isLight
              ? 'bg-white border-stone-200 text-stone-900'
              : 'bg-stone-900 border-stone-800 text-stone-100'
          }`}
        >
          <div className="flex items-center justify-between border-b border-stone-700/40 pb-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              <span>{companionName} preferences</span>
            </div>
            <button
              type="button"
              onClick={() => setCustomizeOpen(false)}
              aria-label="Close preferences"
              className="p-1 rounded-lg hover:bg-stone-500/20"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="morrow-name-input" className="text-stone-400 w-14">
              Name
            </label>
            <input
              id="morrow-name-input"
              data-testid="companion-prefs-name-input"
              type="text"
              value={companionName}
              onChange={(e) => onChangeCompanionName && onChangeCompanionName(e.target.value)}
              className={`flex-1 px-2.5 py-1 rounded-lg border text-xs ${
                isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>

          {/* Floating Figure Size Slider & Presets */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label htmlFor="morrow-prefs-size-slider" className="text-stone-400">
                Figure size
              </label>
              <span className="font-mono text-[11px] text-sky-400">{effectiveScalePct}%</span>
            </div>
            <input
              id="morrow-prefs-size-slider"
              data-testid="morrow-prefs-size-slider"
              type="range"
              min={50}
              max={200}
              step={5}
              value={effectiveScalePct}
              onChange={(e) => handleUpdateScalePct(Number(e.target.value))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'S (75%)', pct: 75 },
                { label: 'M (100%)', pct: 100 },
                { label: 'L (135%)', pct: 135 },
                { label: 'XL (165%)', pct: 165 },
              ].map((preset) => (
                <button
                  key={preset.pct}
                  type="button"
                  onClick={() => handleUpdateScalePct(preset.pct)}
                  className={`py-1 rounded border text-[10px] font-medium transition-colors ${
                    effectiveScalePct === preset.pct
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                      : 'border-stone-700/60 hover:bg-stone-500/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={neverSit}
                onChange={(e) => setNeverSit(e.target.checked)}
                className="accent-sky-500"
              />
              <span>Never sit</span>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={neverSleep}
                onChange={(e) => setNeverSleep(e.target.checked)}
                className="accent-sky-500"
              />
              <span>Never sleep</span>
            </label>
          </div>

          <div>
            <span className="block text-stone-400 mb-1">Appearance</span>
            <div className="grid grid-cols-2 gap-1.5">
              {COMPANION_LOOK_PRESETS.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onChangeLookId && onChangeLookId(look.id)}
                  className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] truncate transition-colors ${
                    activeLookId === look.id
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 font-medium'
                      : 'border-stone-700/60 hover:bg-stone-500/10'
                  }`}
                >
                  {look.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-stone-400 mb-1">Proportion</label>
              <select
                value={activeLive2DProportion}
                onChange={(e) =>
                  onChangeLive2DProportion &&
                  onChangeLive2DProportion(e.target.value as Live2DProportionMode)
                }
                className={`w-full px-2 py-1 rounded-lg border text-[11px] ${
                  isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-800'
                }`}
              >
                <option value="vtuber_full">Full body</option>
                <option value="chibi_full">Compact</option>
                <option value="vtuber_bust">Portrait</option>
              </select>
            </div>
            <div>
              <label className="block text-stone-400 mb-1">Accessory</label>
              <select
                value={activeLive2DProp}
                onChange={(e) =>
                  onChangeLive2DProp && onChangeLive2DProp(e.target.value as Live2DPropId)
                }
                className={`w-full px-2 py-1 rounded-lg border text-[11px] ${
                  isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-800'
                }`}
              >
                <option value="none">None</option>
                <option value="boba">Boba tea</option>
                <option value="popsicle">Popsicle</option>
                <option value="headpat">Headpat</option>
              </select>
            </div>
          </div>

          {onOpenRecordConsent && (
            <div className="pt-2 border-t border-stone-700/40 flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-400">
                Screen: <strong>{screenAwarenessMode.toUpperCase()}</strong>
              </span>
              <button
                type="button"
                data-testid="morrow-menu-record-chip"
                onClick={() => {
                  setCustomizeOpen(false);
                  onOpenRecordConsent();
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium"
              >
                <Video className="w-3.5 h-3.5" />
                <span>Record skill</span>
              </button>
            </div>
          )}

          {onOpenSoulView && (
            <button
              type="button"
              onClick={() => {
                setCustomizeOpen(false);
                onOpenSoulView();
              }}
              className="w-full py-1.5 rounded-lg border border-stone-700 hover:bg-stone-800 text-xs font-medium"
            >
              Open Soul &amp; personality
            </button>
          )}
        </div>
      )}
    </>
  );
};
