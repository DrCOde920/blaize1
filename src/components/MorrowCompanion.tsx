/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Morrow 2D Companion —
 * 1. Top-Center Chair Stage in the Chat Panel:
 *    Whenever the Chat panel is open (`isChatViewOpen === true`), Morrow walks to and sits on
 *    her executive chair at the top center of the Chat column. Supports a space-efficient
 *    Compact Presence Strip toggle for deep conversations.
 * 2. Contextual Pop-out Chat Box on Click:
 *    Clicking Morrow from any workspace opens the shared conversation pop-out right beside her.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Wrench,
  X,
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
  PRESENCE_STATE_USAGE_MAP,
  mapModelActivityToPresence,
} from '../packages/living';
import { MorrowLive2DRig } from './MorrowLive2DRig';

export type HubNavigationTarget =
  | 'mission_control'
  | 'blaize_browser'
  | 'l3xi_finance'
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
  /** Whether the main Chat workspace is currently open */
  isChatViewOpen?: boolean;
  /** Whether the Chat stage is collapsed into a compact presence strip */
  compactChatStage?: boolean;
  onToggleCompactChatStage?: () => void;
  /** Whether the left navigation sidebar is collapsed */
  sidebarCollapsed?: boolean;
  /** Whether the right-hand Artifact Split Drawer is open in Chat */
  chatArtifactDrawerOpen?: boolean;
  /** Current width of the right-hand Artifact Split Drawer in px */
  artifactDrawerWidthPx?: number;
  /** Callback when clicking "Open Full Chat" from outside Chat */
  onJumpToChat?: () => void;
  /** Live messages from the active conversation thread for the Pop-out Chat Box */
  chatMessages?: CompanionChatTurnMessage[];
  /** Callback to send a chat message from the Pop-out Chat Box */
  onSendChatMessage?: (text: string) => void;
  /** Whether AI is currently thinking/coordinating tools */
  isAiThinking?: boolean;
  /** External customize modal trigger */
  customizeOpen?: boolean;
  setCustomizeOpen?: (open: boolean) => void;
}

export const MorrowCompanion: React.FC<MorrowCompanionProps> = ({
  morrowState,
  pendingApproval,
  onApproveAction,
  onRejectAction,
  onSubmitVoiceMission,
  companionName = 'Morrow',
  onChangeCompanionName,
  activeLookId = 'look-sage-emerald',
  onChangeLookId,
  activeAnimAction = 'idle',
  onChangeAnimAction,
  activeLive2DProp = 'none',
  onChangeLive2DProp,
  activeLive2DExpression = 'default',
  onChangeLive2DExpression,
  activeLive2DProportion = 'vtuber_full',
  onChangeLive2DProportion,
  isPlayingMusic = false,
  onToggleMusic,
  uiTheme = 'dark',
  missionActivityEvent,
  isChatViewOpen = true,
  compactChatStage = false,
  onToggleCompactChatStage,
  sidebarCollapsed = false,
  chatArtifactDrawerOpen = false,
  artifactDrawerWidthPx = 500,
  onJumpToChat,
  chatMessages = [],
  onSendChatMessage,
  isAiThinking = false,
  customizeOpen: externalCustomizeOpen,
  setCustomizeOpen: setExternalCustomizeOpen,
}) => {
  const isLight = uiTheme === 'light';

  // Walk-and-sit state machine whenever `isChatViewOpen` transitions to true
  const [walkPhase, setWalkPhase] = useState<
    'walking_to_chat' | 'sitting_down' | 'seated_in_chat' | 'corner_perch'
  >('walking_to_chat');

  const [walkOffsetX, setWalkOffsetX] = useState<number>(130);
  const [manualPostureOverride, setManualPostureOverride] =
    useState<MorrowPresenceState | null>(null);

  // Pop-out Chat Box state when clicking Morrow
  const [popoutChatOpen, setPopoutChatOpen] = useState<boolean>(false);
  const [popoutInput, setPopoutInput] = useState<string>('');
  const popoutScrollRef = useRef<HTMLDivElement | null>(null);

  // Dragging support
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragMoved, setDragMoved] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFallingToFloor, setIsFallingToFloor] = useState(false);

  // Customize popover state
  const [internalCustomizeOpen, setInternalCustomizeOpen] = useState(false);
  const customizeOpen =
    externalCustomizeOpen !== undefined ? externalCustomizeOpen : internalCustomizeOpen;
  const setCustomizeOpen = setExternalCustomizeOpen || setInternalCustomizeOpen;

  // Trigger walk-to-center-chair and sit transition ONLY when `isChatViewOpen` changes
  const prevChatOpenRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevChatOpenRef.current === isChatViewOpen) return;
    prevChatOpenRef.current = isChatViewOpen;

    if (isChatViewOpen) {
      setManualPostureOverride(null);
      setDragOffset({ x: 0, y: 0 });
      setWalkPhase('walking_to_chat');
      setWalkOffsetX(120);

      const startWalkTimer = window.setTimeout(() => {
        setWalkOffsetX(0);
      }, 30);

      const sitDownTimer = window.setTimeout(() => {
        setWalkPhase('sitting_down');
      }, 580);

      const sitIdleTimer = window.setTimeout(() => {
        setWalkPhase('seated_in_chat');
      }, 880);

      return () => {
        window.clearTimeout(startWalkTimer);
        window.clearTimeout(sitDownTimer);
        window.clearTimeout(sitIdleTimer);
      };
    } else {
      setWalkPhase('corner_perch');
      setWalkOffsetX(0);
      setDragOffset({ x: 0, y: 0 });
    }
  }, [isChatViewOpen]);

  // Auto-scroll Pop-out Chat Box when new messages arrive or when opened
  useEffect(() => {
    if (popoutChatOpen && popoutScrollRef.current) {
      popoutScrollRef.current.scrollTop = popoutScrollRef.current.scrollHeight;
    }
  }, [popoutChatOpen, chatMessages.length, isAiThinking]);

  // Close pop-out on Escape
  useEffect(() => {
    if (!popoutChatOpen && !customizeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopoutChatOpen(false);
        setCustomizeOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popoutChatOpen, customizeOpen, setCustomizeOpen]);

  // Sync explicit chat animation commands
  useEffect(() => {
    if (activeAnimAction === 'sit') {
      setManualPostureOverride('sit_idle');
    } else if (activeAnimAction === 'dance') {
      setManualPostureOverride('dance_loop');
    } else if (activeAnimAction === 'run') {
      setManualPostureOverride('walk_left');
    } else if (activeAnimAction === 'sleep_rest') {
      setManualPostureOverride('rest');
    } else if (activeAnimAction === 'idle') {
      setManualPostureOverride(null);
    }
  }, [activeAnimAction]);

  // Derive live activity event
  const currentActivityEvent: MissionEngineActivityEvent = useMemo(() => {
    if (missionActivityEvent) return missionActivityEvent;
    if (pendingApproval || morrowState === 'asking_approval') return 'awaiting_approval';
    if (morrowState === 'speaking') return 'streaming_reply';
    if (morrowState === 'working') return 'tool_running';
    if (morrowState === 'verifying') return 'verifying';
    if (morrowState === 'thinking') return 'planning';
    if (morrowState === 'done_with_proof') return 'done_verified';
    if (isPlayingMusic) return 'music_playing';
    return 'idle';
  }, [missionActivityEvent, pendingApproval, morrowState, isPlayingMusic]);

  const activityPresence = useMemo(
    () =>
      mapModelActivityToPresence(currentActivityEvent, {
        importantOrScheduledMission: morrowState === 'done_with_proof',
        toolLabel: 'running tools',
        focusModeOrFullscreen: false,
        dockSide: 'right',
        danceEnthusiasm: 'high',
        warmth: 85,
      }),
    [currentActivityEvent, morrowState]
  );

  const effectivePresenceState: MorrowPresenceState = useMemo(() => {
    if (isDragging) return 'carried';
    if (isFallingToFloor) return 'land';
    if (walkPhase === 'walking_to_chat') return 'walk_left';
    if (walkPhase === 'sitting_down') return 'sit_down';
    if (manualPostureOverride) return manualPostureOverride;
    if (isChatViewOpen) {
      return 'sit_idle';
    }
    if (currentActivityEvent !== 'idle') return activityPresence.presenceState;
    return 'stand_idle';
  }, [
    isDragging,
    isFallingToFloor,
    walkPhase,
    manualPostureOverride,
    isChatViewOpen,
    currentActivityEvent,
    activityPresence.presenceState,
  ]);

  const presenceMeta =
    PRESENCE_STATE_USAGE_MAP[effectivePresenceState] || PRESENCE_STATE_USAGE_MAP.sit_idle;

  // Dragging handlers
  const handlePointerDownCharacter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragMoved(false);
    setDragStart({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const nextX = Math.max(-320, Math.min(320, e.clientX - dragStart.x));
      const nextY = Math.max(-160, Math.min(160, e.clientY - dragStart.y));
      if (Math.abs(nextX - dragOffset.x) > 4 || Math.abs(nextY - dragOffset.y) > 4) {
        setDragMoved(true);
      }
      setDragOffset({ x: nextX, y: nextY });
    };
    const onUp = () => {
      setIsDragging(false);
      if (Math.abs(dragOffset.y) > 12 || Math.abs(dragOffset.x) > 12) {
        setIsFallingToFloor(true);
        setDragOffset({ x: 0, y: 0 });
        window.setTimeout(() => {
          setIsFallingToFloor(false);
        }, 360);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, dragStart, dragOffset]);

  const handleCursorGlance = useCallback((_nx: number, _ny: number) => {}, []);

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

  const groundAnchor = presenceMeta.groundAnchor;
  const postureSeatOffsetPx =
    groundAnchor.posture === 'sitting'
      ? 10
      : effectivePresenceState === 'land'
      ? 4
      : 0;
  const squashScaleY = groundAnchor.squashY ?? 1.0;

  // Compute horizontal center of the Chat column based on sidebar width (240px or 56px) and right-hand Artifact Split Drawer
  const sidebarHalfOffset = sidebarCollapsed ? 28 : 120;
  const drawerHalfOffset = chatArtifactDrawerOpen ? Math.round(artifactDrawerWidthPx / 2) : 0;
  const netHorizontalOffset = sidebarHalfOffset - drawerHalfOffset;
  const chatCenterLeftCalc =
    netHorizontalOffset >= 0
      ? `calc(50% + ${netHorizontalOffset}px)`
      : `calc(50% - ${Math.abs(netHorizontalOffset)}px)`;

  const statusText = pendingApproval
    ? 'Approval needed'
    : isAiThinking
    ? 'Working...'
    : walkPhase === 'walking_to_chat'
    ? 'Walking to chair...'
    : isChatViewOpen
    ? 'Seated · Ready'
    : 'Ready';

  return (
    <>
      {/* 1A. COMPACT PRESENCE STRIP MODE IN CHAT (When collapsed for deep conversation) */}
      {isChatViewOpen && compactChatStage && (
        <div
          data-testid="chat-top-center-chair"
          style={{
            top: '54px',
            left: chatCenterLeftCalc,
            transform: 'translate3d(-50%, 0, 0)',
          }}
          className="fixed z-30 flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm transition-all text-xs pointer-events-auto bg-[#141824]/95 border-stone-700/80 text-stone-200"
        >
          <button
            type="button"
            data-testid="morrow-character-trigger"
            onClick={() => setPopoutChatOpen((prev) => !prev)}
            className="flex items-center gap-2 font-medium hover:text-amber-300"
          >
            <span className="w-5 h-5 rounded-full bg-amber-400 text-stone-950 font-bold text-[10px] flex items-center justify-center">
              M
            </span>
            <span>{companionName}</span>
            <span aria-hidden="true" className="text-stone-500">
              ·
            </span>
            <span className="text-stone-400 text-[11px]">{statusText}</span>
          </button>

          {onToggleCompactChatStage && (
            <button
              type="button"
              onClick={onToggleCompactChatStage}
              aria-label="Expand Morrow stage"
              title="Expand chair stage"
              className="p-1 rounded hover:bg-stone-500/20 text-stone-400 hover:text-stone-200"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 1B. PERMANENT EXECUTIVE CHAIR AT THE TOP CENTER OF THE CHAT PANEL (When expanded) */}
      {isChatViewOpen && !compactChatStage && (
        <div
          data-testid="chat-top-center-chair"
          aria-label="Morrow's Chair at Top Center of Chat Panel"
          style={{
            top: '50px',
            left: chatCenterLeftCalc,
            transform: 'translate3d(-50%, 0, 0)',
          }}
          className="fixed z-30 pointer-events-none select-none flex flex-col items-center w-40 h-40 transition-[left] duration-150"
        >
          <div
            className={`absolute top-2 w-28 h-28 rounded-full blur-2xl transition-opacity ${
              isLight ? 'bg-amber-300/25' : 'bg-amber-400/12'
            }`}
          />

          <svg
            viewBox="0 0 180 180"
            className="w-36 h-36 overflow-visible drop-shadow-lg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="chairBackGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isLight ? '#3f3f46' : '#27272a'} />
                <stop offset="100%" stopColor={isLight ? '#18181b' : '#12131a'} />
              </linearGradient>
              <linearGradient id="chairSeatGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={isLight ? '#52525b' : '#323646'} />
                <stop offset="100%" stopColor={isLight ? '#27272a' : '#181b24'} />
              </linearGradient>
              <linearGradient id="chairTrimGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="50%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#d97706" />
              </linearGradient>
            </defs>

            <ellipse
              cx="90"
              cy="168"
              rx="48"
              ry="6"
              fill={isLight ? 'rgba(28, 25, 23, 0.18)' : 'rgba(0, 0, 0, 0.5)'}
            />

            <path
              d="M90 136 L90 163 M90 158 L54 166 M90 158 L126 166 M90 158 L68 168 M90 158 L112 168"
              stroke={isLight ? '#52525b' : '#475569'}
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="54" cy="167" r="3" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
            <circle cx="126" cy="167" r="3" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
            <circle cx="68" cy="169" r="3" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
            <circle cx="112" cy="169" r="3" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />

            <rect
              x="50"
              y="28"
              width="80"
              height="92"
              rx="20"
              fill="url(#chairBackGrad)"
              stroke="url(#chairTrimGrad)"
              strokeWidth="2"
            />
            <rect
              x="58"
              y="38"
              width="64"
              height="74"
              rx="14"
              fill={isLight ? '#27272a' : '#191d28'}
              stroke={isLight ? '#52525b' : '#334155'}
              strokeWidth="1"
            />
            <rect
              x="67"
              y="33"
              width="46"
              height="13"
              rx="6.5"
              fill={isLight ? '#3f3f46' : '#262b3d'}
              stroke="#fbbf24"
              strokeWidth="1"
            />

            <path
              d="M48 92 C34 92, 34 122, 48 124"
              fill="none"
              stroke={isLight ? '#3f3f46' : '#334155'}
              strokeWidth="5.5"
              strokeLinecap="round"
            />
            <rect x="31" y="88" width="17" height="6.5" rx="3" fill="#f59e0b" />

            <path
              d="M132 92 C146 92, 146 122, 132 124"
              fill="none"
              stroke={isLight ? '#3f3f46' : '#334155'}
              strokeWidth="5.5"
              strokeLinecap="round"
            />
            <rect x="132" y="88" width="17" height="6.5" rx="3" fill="#f59e0b" />

            <rect
              x="42"
              y="114"
              width="96"
              height="21"
              rx="10"
              fill="url(#chairSeatGrad)"
              stroke="url(#chairTrimGrad)"
              strokeWidth="2"
            />
          </svg>
        </div>
      )}

      {/* 2. FLOATING / SEATED 2D COMPANION RIG */}
      {(!isChatViewOpen || !compactChatStage) && (
        <div
          data-testid="morrow-floating-companion"
          data-chat-seated={isChatViewOpen ? 'true' : 'false'}
          data-presence-state={effectivePresenceState}
          style={
            isChatViewOpen
              ? {
                  top: '44px',
                  left: chatCenterLeftCalc,
                  transform: `translate3d(calc(-50% + ${walkOffsetX + dragOffset.x}px), ${dragOffset.y}px, 0px)`,
                  transition: isDragging
                    ? 'none'
                    : 'transform 560ms cubic-bezier(0.22, 1, 0.36, 1), left 150ms ease',
                }
              : {
                  right: `${Math.max(12, 18 - dragOffset.x)}px`,
                  bottom: `${Math.max(12, 14 - dragOffset.y)}px`,
                  transform: 'translate3d(0px, 0px, 0px)',
                  transition: isDragging ? 'none' : 'right 250ms ease, bottom 250ms ease',
                }
          }
          className="fixed z-40 pointer-events-none select-none flex flex-col items-center"
        >
          {/* Interactive 2D Character Rig */}
          <div
            role="button"
            tabIndex={0}
            data-testid="morrow-character-trigger"
            aria-label={`${companionName} 2D Companion (${effectivePresenceState}) - Click to open chat box`}
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
              transform: `translate3d(0px, ${postureSeatOffsetPx}px, 0px) scaleY(${squashScaleY})`,
              transformOrigin: '50% 95%',
              transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            className="pointer-events-auto cursor-pointer active:cursor-grabbing focus:outline-none group relative"
          >
            <MorrowLive2DRig
              action={
                effectivePresenceState === 'sit_idle' || effectivePresenceState === 'sit_down'
                  ? 'sit'
                  : effectivePresenceState === 'walk_left' || effectivePresenceState === 'walk_right'
                  ? 'run'
                  : effectivePresenceState === 'dance_loop'
                  ? 'dance'
                  : effectivePresenceState === 'rest' || effectivePresenceState === 'sleep'
                  ? 'sleep_rest'
                  : activeAnimAction
              }
              presenceState={effectivePresenceState}
              badge={activityPresence.badge}
              lookId={activeLookId}
              propId={activeLive2DProp}
              expressionId={activeLive2DExpression}
              proportionMode={activeLive2DProportion}
              viewAngle="auto"
              animationPaused={
                effectivePresenceState === 'rest' || effectivePresenceState === 'sleep'
              }
              isSpeaking={morrowState === 'speaking' || isAiThinking}
              isPlayingMusic={isPlayingMusic}
              onCursorGlance={handleCursorGlance}
              className={isChatViewOpen ? 'w-28 h-36 sm:w-30 sm:h-40' : 'w-24 h-34'}
            />
          </div>

          {/* Concise Status & Controls Bar under Morrow */}
          <div
            className={`mt-0.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium shadow-sm backdrop-blur-md flex items-center gap-1.5 pointer-events-auto transition-colors ${
              pendingApproval
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : isLight
                ? 'bg-white/95 border-stone-300 text-stone-700'
                : 'bg-[#151924]/95 border-stone-700/80 text-stone-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setPopoutChatOpen((prev) => !prev)}
              className="hover:underline text-left flex items-center gap-1.5"
            >
              <span className="font-semibold">{companionName}</span>
              <span aria-hidden="true" className="text-stone-500">
                ·
              </span>
              <span className={isLight ? 'text-stone-500' : 'text-stone-400'}>{statusText}</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCustomizeOpen(!customizeOpen);
              }}
              aria-label="Customize companion"
              title="Appearance & Pose"
              className="p-0.5 rounded hover:bg-stone-500/20 text-stone-400 hover:text-stone-200"
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>

            {onToggleMusic && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMusic();
                }}
                aria-label={isPlayingMusic ? 'Pause companion music' : 'Play companion music'}
                title={isPlayingMusic ? 'Pause Music' : 'Play Music & Dance'}
                className={`p-0.5 rounded hover:bg-stone-500/20 ${
                  isPlayingMusic ? 'text-amber-400' : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                <Volume2 className="w-3 h-3" />
              </button>
            )}

            {isChatViewOpen && onToggleCompactChatStage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCompactChatStage();
                }}
                aria-label="Collapse Morrow stage to compact bar"
                title="Collapse stage"
                className="p-0.5 rounded hover:bg-stone-500/20 text-stone-400 hover:text-stone-200"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. CONTEXTUAL POP-OUT CHAT BOX (Shared conversation history from anywhere) */}
      {popoutChatOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${companionName} Pop-out Chat Box`}
          data-testid="morrow-popout-chatbox"
          style={
            isChatViewOpen
              ? {
                  top: '56px',
                  right: chatArtifactDrawerOpen ? `${artifactDrawerWidthPx + 16}px` : '20px',
                }
              : {
                  bottom: '180px',
                  right: '20px',
                }
          }
          className={`fixed z-50 w-84 sm:w-92 rounded-2xl border shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden transition-all ${
            isLight
              ? 'bg-white/95 border-stone-300 text-stone-900'
              : 'bg-[#131722]/95 border-stone-700/90 text-stone-100'
          }`}
        >
          {/* Header */}
          <div
            className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 ${
              isLight ? 'bg-stone-100/80 border-stone-200' : 'bg-[#191E2D] border-stone-800'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-amber-400 text-stone-950 font-bold text-xs flex items-center justify-center shrink-0">
                M
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">{companionName}</div>
                <div className="text-[10px] text-stone-400 truncate">{statusText}</div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {[
                {
                  label: 'Sit',
                  state: 'sit_idle' as MorrowPresenceState,
                  act: 'sit' as MorrowAnimationAction,
                },
                {
                  label: 'Stand',
                  state: 'stand_idle' as MorrowPresenceState,
                  act: 'idle' as MorrowAnimationAction,
                },
                {
                  label: 'Dance',
                  state: 'dance_loop' as MorrowPresenceState,
                  act: 'dance' as MorrowAnimationAction,
                },
              ].map((pose) => (
                <button
                  key={pose.label}
                  type="button"
                  onClick={() => {
                    setManualPostureOverride(pose.state);
                    if (onChangeAnimAction) onChangeAnimAction(pose.act, pose.label);
                  }}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border transition-colors ${
                    effectivePresenceState === pose.state
                      ? 'bg-amber-400 border-amber-400 text-stone-950 font-semibold'
                      : 'border-stone-700/70 text-stone-400 hover:text-stone-200 hover:bg-stone-500/15'
                  }`}
                >
                  {pose.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setPopoutChatOpen(false)}
                aria-label="Close pop-out chat box"
                className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-500/20"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Conversation History */}
          <div
            ref={popoutScrollRef}
            className="p-3 space-y-2.5 max-h-60 overflow-y-auto text-xs"
          >
            {chatMessages.length === 0 ? (
              <div className="text-center py-6 text-stone-400">
                Ask {companionName} anything or coordinate your active project tools.
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
                        ? isLight
                          ? 'bg-stone-900 text-white'
                          : 'bg-amber-400 text-stone-950 font-medium'
                        : isLight
                        ? 'bg-stone-100 border border-stone-200 text-stone-800'
                        : 'bg-[#1B2030] border border-stone-800 text-stone-200'
                    }`}
                  >
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-sky-400">
                        <Wrench className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{msg.toolsUsed.join(' · ')}</span>
                      </div>
                    )}
                    <div>{msg.content.replace(/\*\*/g, '')}</div>
                    {msg.verifiedProof && (
                      <div className="flex items-center gap-1 text-[10px] text-emerald-400 pt-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{msg.verifiedProof.summary}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-stone-500 mt-0.5 px-1">{msg.timestamp}</span>
                </div>
              ))
            )}

            {isAiThinking && (
              <div className="text-[11px] text-amber-400 pl-1">{companionName} is working...</div>
            )}

            {pendingApproval && (
              <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-2.5 space-y-2 text-[11px]">
                <div className="font-semibold text-amber-300 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{pendingApproval.title}</span>
                </div>
                <p className="text-stone-300 text-[10px]">{pendingApproval.reason}</p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onApproveAction('local_sheet')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 text-stone-950 font-semibold hover:bg-emerald-400"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={onRejectAction}
                    className="px-2.5 py-1 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div
            className={`px-3 py-1.5 border-t flex items-center gap-1.5 overflow-x-auto no-scrollbar ${
              isLight ? 'border-stone-200 bg-stone-50' : 'border-stone-800/80 bg-[#151925]'
            }`}
          >
            {[
              { label: 'Reconcile statement', prompt: 'Use L3xi Finance to reconcile my October balance' },
              { label: 'Check MockBank', prompt: 'Open MockBank in the AI Browser and check my login' },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleSendFromPopout(chip.prompt)}
                className={`px-2 py-0.5 rounded-lg border text-[10px] whitespace-nowrap transition-colors ${
                  isLight
                    ? 'bg-white border-stone-300 text-stone-700 hover:bg-stone-100'
                    : 'bg-stone-900 border-stone-700 text-stone-300 hover:border-amber-400/50'
                }`}
              >
                {chip.label}
              </button>
            ))}
            {!isChatViewOpen && onJumpToChat && (
              <button
                type="button"
                onClick={onJumpToChat}
                className="px-2 py-0.5 rounded-lg bg-amber-400/15 border border-amber-400/40 text-amber-300 text-[10px] whitespace-nowrap font-medium"
              >
                Open Chat →
              </button>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendFromPopout();
            }}
            className={`p-2.5 border-t flex items-center gap-2 ${
              isLight ? 'border-stone-200 bg-white' : 'border-stone-800 bg-[#10141D]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-stone-400 shrink-0 ml-1" />
            <input
              type="text"
              aria-label={`Message ${companionName} in pop-out chat`}
              value={popoutInput}
              onChange={(e) => setPopoutInput(e.target.value)}
              placeholder={`Message ${companionName}...`}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-stone-500"
            />
            <button
              type="submit"
              aria-label="Send pop-out chat message"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-semibold text-xs transition-colors"
            >
              <span>Send</span>
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      )}

      {/* 4. COMPANION APPEARANCE & POSE CUSTOMIZATION POPOVER */}
      {customizeOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Customize Morrow Companion"
          className={`fixed top-16 left-64 z-50 w-76 rounded-2xl border p-4 shadow-2xl backdrop-blur-md space-y-3 text-xs ${
            isLight
              ? 'bg-white/95 border-stone-300 text-stone-900'
              : 'bg-[#151923]/95 border-stone-700 text-stone-100'
          }`}
        >
          <div className="flex items-center justify-between border-b border-stone-700/50 pb-2">
            <div className="flex items-center gap-1.5 font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{companionName} Appearance</span>
            </div>
            <button
              type="button"
              onClick={() => setCustomizeOpen(false)}
              aria-label="Close companion customization"
              className="p-1 rounded-lg hover:bg-stone-500/20"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-stone-400 w-14">Name</span>
            <input
              type="text"
              value={companionName}
              onChange={(e) => onChangeCompanionName && onChangeCompanionName(e.target.value)}
              className={`flex-1 px-2.5 py-1 rounded-lg border text-xs ${
                isLight ? 'bg-stone-50 border-stone-300' : 'bg-stone-950 border-stone-800'
              }`}
            />
          </div>

          <div>
            <span className="block text-stone-400 mb-1">Posture</span>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'Sit', state: 'sit_idle' as MorrowPresenceState, act: 'sit' as MorrowAnimationAction },
                { label: 'Stand', state: 'stand_idle' as MorrowPresenceState, act: 'idle' as MorrowAnimationAction },
                { label: 'Dance', state: 'dance_loop' as MorrowPresenceState, act: 'dance' as MorrowAnimationAction },
                { label: 'Rest', state: 'rest' as MorrowPresenceState, act: 'sleep_rest' as MorrowAnimationAction },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setManualPostureOverride(item.state);
                    if (onChangeAnimAction) onChangeAnimAction(item.act, item.label);
                  }}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    effectivePresenceState === item.state
                      ? 'bg-amber-400 border-amber-400 text-stone-950 font-semibold'
                      : 'border-stone-700/70 hover:bg-stone-500/15'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-stone-400 mb-1">Outfit</span>
            <div className="grid grid-cols-2 gap-1.5">
              {COMPANION_LOOK_PRESETS.map((look) => (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onChangeLookId && onChangeLookId(look.id)}
                  className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] truncate transition-colors ${
                    activeLookId === look.id
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-semibold'
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
                <option value="vtuber_full">Full Body</option>
                <option value="chibi_full">Chibi</option>
                <option value="vtuber_bust">Bust</option>
              </select>
            </div>
            <div>
              <label className="block text-stone-400 mb-1">Prop</label>
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
                <option value="boba">Boba Tea</option>
                <option value="popsicle">Sea-Salt Popsicle</option>
                <option value="headpat">Headpat</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
