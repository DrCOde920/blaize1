/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MorrowLive2DRig: Multi-Layered Interactive 2D VTuber Character Rig for Morrow
 * Faithfully modeled after Morrow's Official 2D Character Turnaround & Expression Sheet
 * (/assets/aistudio/Generated_Image_October_29__2026_-_5_12AM_34da62c7.jpg) while keeping
 * real-time Live2D physics, cursor eye/head tracking, spring-braid sway, and 0-token local life:
 *
 * 1. Signature Character Design:
 *    - Warm medium-deep brown skin (#B77A52 / #955C38) with warm terracotta blush & bare left shoulder.
 *    - Long articulated black box braids (#1A1922) with 3 signature lavender/lilac accent braids (#C5B0F2)
 *      and silver/lavender star hair clips (★) on both sides of the part + silver hoop earrings.
 *    - Dark metallic slate-purple over-ear headphones (#3E3A4B / #68617B) resting around her neck.
 *    - Fitted black ribbed sleeveless mock-neck top (#1A1A21) with layered double silver chain necklaces + pendant.
 *    - Oversized charcoal-grey bomber jacket (#4E4F58) worn stylishly off her left shoulder (viewer's right shoulder bare).
 *    - High-waisted black wide-leg trousers (#1B1B21) with silver waist chain belt & swinging silver hip chain.
 *
 * 2. 3 Turnaround Angles (Top Row of Sheet):
 *    - 'front': Confident front stance with cursor-tracked eyes, head tilt & off-shoulder jacket.
 *    - 'three_quarter': 3/4 perspective turn (also triggered automatically on strong side gaze / run).
 *    - 'back': Full back turnaround showing cascading black + lavender box braids, bare left shoulder & jacket back.
 *
 * 3. 5 Signature Facial Expressions (Bottom Row of Sheet):
 *    - 'default': Calm, warm confident closed-lip smile.
 *    - 'joy_beam': Bright toothy grin with happy squinting eyes.
 *    - 'starry_surprise': Wide-eyed surprised face with raised brows & open 'O' mouth.
 *    - 'watery_plead': Concerned/worried expression with upturned inner brows & parted mouth.
 *    - 'pout_fierce': Sleepy/exhausted closed eyes with open mouth & signature anime drool droplet (💧).
 *
 * 4. 6 Interactive VTuber Props & Gestures + Chibi / Full-Body / Bust Proportions:
 *    - 'boba', 'popsicle', 'cheek_touch', 'shy_poke', 'squish_cheeks', 'headpat' (plus rub-crown-to-headpat).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import {
  COMPANION_LOOK_PRESETS,
  CompanionLookPreset,
  Live2DExpressionId,
  Live2DPropId,
  Live2DProportionMode,
  Live2DViewAngle,
  MorrowAnimationAction,
  MorrowPresenceState,
  getClipGroundAnchor,
} from '../packages/living';

export interface MorrowLive2DRigProps {
  action: MorrowAnimationAction;
  presenceState?: MorrowPresenceState;
  badge?: 'check' | 'shield' | 'pending' | null;
  lookId?: string;
  propId?: Live2DPropId;
  expressionId?: Live2DExpressionId;
  proportionMode?: Live2DProportionMode;
  viewAngle?: Live2DViewAngle;
  animationPaused?: boolean;
  isSpeaking?: boolean;
  isPlayingMusic?: boolean;
  onAutoHeadpat?: () => void;
  onCursorGlance?: (nx: number, ny: number) => void;
  className?: string;
}

export const MorrowLive2DRig: React.FC<MorrowLive2DRigProps> = ({
  action,
  presenceState,
  badge = null,
  lookId = 'look-sage-emerald',
  propId = 'none',
  expressionId = 'default',
  proportionMode = 'vtuber_full',
  viewAngle = 'auto',
  animationPaused = false,
  isSpeaking = false,
  isPlayingMusic = false,
  onAutoHeadpat,
  onCursorGlance,
  className = 'w-44 h-60',
}) => {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef<SVGSVGElement | null>(null);

  const look: CompanionLookPreset =
    COMPANION_LOOK_PRESETS.find((l) => l.id === lookId) || COMPANION_LOOK_PRESETS[0];

  // Cursor-tracked normalized gaze (-1..1) for eye irises, head tilt, and spring-braid sway
  const [gaze, setGaze] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const [breathPhase, setBreathPhase] = useState<number>(0);
  const [mouthOpenPhase, setMouthOpenPhase] = useState<number>(0);
  const [headpatRubActive, setHeadpatRubActive] = useState(false);
  const rubCountRef = useRef<{ lastX: number; reversals: number; timeout: number | null }>({
    lastX: 0,
    reversals: 0,
    timeout: null,
  });

  // Track mouse cursor across window (paused at 0 FPS when resting/sleeping)
  useEffect(() => {
    if (
      animationPaused ||
      action === 'sleep_rest' ||
      action === 'sleep' ||
      presenceState === 'rest' ||
      presenceState === 'sleep'
    ) {
      setGaze({ x: 0, y: 0 });
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.34;
      const nx = Math.max(-1, Math.min(1, (e.clientX - centerX) / 220));
      const ny = Math.max(-1, Math.min(1, (e.clientY - centerY) / 180));
      setGaze({ x: nx, y: ny });
      if (onCursorGlance) onCursorGlance(nx, ny);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [animationPaused, action, presenceState, onCursorGlance]);

  // Natural blinking & breathing/speaking loop (strictly halted at 0 FPS when resting/sleeping)
  useEffect(() => {
    if (
      animationPaused ||
      action === 'sleep_rest' ||
      action === 'sleep' ||
      presenceState === 'rest' ||
      presenceState === 'sleep'
    ) {
      setIsBlinking(false);
      setBreathPhase(0);
      setMouthOpenPhase(0);
      return;
    }

    const blinkTimer = window.setInterval(() => {
      setIsBlinking(true);
      window.setTimeout(() => setIsBlinking(false), 140);
    }, 3400);

    const physicsIntervalMs =
      action === 'dance' || action === 'run' || isPlayingMusic ? 240 : 620;

    const physicsTimer = window.setInterval(() => {
      setBreathPhase((prev) => (prev + 1) % 4);
      if (
        isSpeaking ||
        action === 'listen_speak' ||
        action === 'speak' ||
        presenceState === 'speak' ||
        propId === 'boba' ||
        propId === 'popsicle'
      ) {
        setMouthOpenPhase((m) => (m + 1) % 3);
      } else {
        setMouthOpenPhase(0);
      }
    }, physicsIntervalMs);

    return () => {
      window.clearInterval(blinkTimer);
      window.clearInterval(physicsTimer);
    };
  }, [animationPaused, action, presenceState, isSpeaking, isPlayingMusic, propId]);

  // Derive effective expression from presenceState + action + prop + explicit expressionId
  const effectiveExpression: Live2DExpressionId =
    action === 'sleep_rest' ||
    action === 'sleep' ||
    presenceState === 'rest' ||
    presenceState === 'sleep'
      ? 'pout_fierce' // 5th portrait in sheet: sleeping/exhausted closed eyes with drool drop!
      : headpatRubActive || propId === 'headpat' || presenceState === 'smile'
      ? 'joy_beam'
      : presenceState === 'surprised' || presenceState === 'carried'
      ? 'starry_surprise'
      : presenceState === 'concerned'
      ? 'watery_plead'
      : expressionId !== 'default'
      ? expressionId
      : action === 'celebrate' || propId === 'squish_cheeks' || propId === 'popsicle'
      ? 'joy_beam'
      : action === 'uncertain_concerned' || action === 'concerned' || propId === 'shy_poke'
      ? 'watery_plead'
      : action === 'wake_attention' || action === 'stretch'
      ? 'starry_surprise'
      : 'default';

  const effectiveProp: Live2DPropId = headpatRubActive
    ? 'headpat'
    : propId !== 'none'
    ? propId
    : action === 'think_read' ||
      action === 'think' ||
      presenceState === 'think' ||
      presenceState === 'verify'
    ? 'cheek_touch'
    : 'none';

  const isSleeping =
    action === 'sleep_rest' ||
    action === 'sleep' ||
    presenceState === 'rest' ||
    presenceState === 'sleep';
  const isSitting =
    action === 'sit' ||
    presenceState === 'sit_down' ||
    presenceState === 'sit_idle' ||
    presenceState === 'rest' ||
    presenceState === 'sleep';
  const isDancing = action === 'dance' || presenceState === 'dance' || isPlayingMusic;
  const isRunning = action === 'run' || presenceState === 'run';
  const isCelebrating = action === 'celebrate' || presenceState === 'celebrate';
  const isWaitingApproval =
    action === 'waiting_approval' || presenceState === 'waiting_approval';
  const isChibi = proportionMode === 'chibi_full';
  const isBust = proportionMode === 'vtuber_bust';
  const groundAnchor = getClipGroundAnchor(presenceState || action);

  // Resolve effective turnaround view angle ('front' | 'three_quarter' | 'back')
  const effectiveAngle: 'front' | 'three_quarter' | 'back' =
    viewAngle === 'back'
      ? 'back'
      : viewAngle === 'three_quarter'
      ? 'three_quarter'
      : viewAngle === 'front'
      ? 'front'
      : isRunning || Math.abs(gaze.x) > 0.62
      ? 'three_quarter'
      : 'front';

  const isBackView = effectiveAngle === 'back';
  const isThreeQuarter = effectiveAngle === 'three_quarter';
  const turnShiftX = isThreeQuarter ? (gaze.x < -0.2 ? -4.5 : 4.5) : 0;

  // Live2D Physics Offsets (Head tilt, eye iris shift, braid & hip-chain secondary motion)
  const headTiltDeg = animationPaused
    ? 0
    : isDancing
    ? breathPhase % 2 === 0
      ? -4.2
      : 4.2
    : effectiveProp === 'shy_poke' || effectiveExpression === 'watery_plead'
    ? -3.2
    : effectiveProp === 'cheek_touch'
    ? 3.0
    : gaze.x * 5.2;

  const headShiftX = (animationPaused ? 0 : gaze.x * 3.8) + turnShiftX;
  const headShiftY = animationPaused
    ? 0
    : (breathPhase % 2 === 0 ? -1.6 : 1.1) + gaze.y * 2.5;
  const irisX = (animationPaused ? 0 : gaze.x * 3.2) + (isThreeQuarter ? 1.4 : 0);
  const irisY = animationPaused ? 0 : gaze.y * 2.2;
  const braidSwayDeg = animationPaused
    ? 0
    : -headTiltDeg * 0.72 + (breathPhase % 2 === 0 ? 2.0 : -2.0);
  const chainSwingDeg = animationPaused
    ? 0
    : isDancing || isRunning || isCelebrating
    ? breathPhase % 2 === 0
      ? 10
      : -8
    : breathPhase % 2 === 0
    ? 3
    : -2;

  // Handle interactive headpat rubbing on crown hitbox
  const handleCrownMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (animationPaused) return;
    const dx = e.clientX - rubCountRef.current.lastX;
    if (Math.abs(dx) > 6) {
      rubCountRef.current.reversals += 1;
      rubCountRef.current.lastX = e.clientX;
      if (rubCountRef.current.reversals >= 4 && !headpatRubActive) {
        setHeadpatRubActive(true);
        if (onAutoHeadpat) onAutoHeadpat();
        if (rubCountRef.current.timeout) window.clearTimeout(rubCountRef.current.timeout);
        rubCountRef.current.timeout = window.setTimeout(() => {
          setHeadpatRubActive(false);
          rubCountRef.current.reversals = 0;
        }, 2600);
      }
    }
  };

  // ViewBox crops smoothly for Bust vs Chibi vs Full-Body VTuber proportions
  const viewBox = isBust
    ? '24 6 192 188'
    : isChibi
    ? '10 0 220 285'
    : '10 0 220 320';

  const bodyScaleTransform = isChibi
    ? 'translate(120, 146) scale(1.06, 0.86) translate(-120, -146)'
    : undefined;

  const headScaleTransform = isChibi
    ? `translate(${120 + headShiftX}, ${84 + headShiftY}) rotate(${headTiltDeg}) scale(1.18) translate(-120, -84)`
    : `translate(${120 + headShiftX}, ${82 + headShiftY}) rotate(${headTiltDeg}) translate(-120, -82)`;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} select-none overflow-visible`}
      role="img"
      aria-label={`Morrow Live2D Rig (${action}, angle: ${effectiveAngle}, prop: ${effectiveProp}, expression: ${effectiveExpression}, mode: ${proportionMode})`}
    >
      <defs>
        {/* Warm Medium-Deep Brown Skin Gradient (Matches Uploaded Character Sheet) */}
        <linearGradient id={`skinGrad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#C4875E" />
          <stop offset="55%" stopColor="#B5764E" />
          <stop offset="100%" stopColor="#965B37" />
        </linearGradient>

        {/* Neck & Chin Deep Warm Brown Shadow */}
        <linearGradient id={`skinShadow-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#854E2E" />
          <stop offset="100%" stopColor="#9E633D" />
        </linearGradient>

        {/* Rich Black Box Braid Gradient */}
        <linearGradient id={`braidBlack-${uid}`} x1="0%" y1="0%" x2="10%" y2="100%">
          <stop offset="0%" stopColor="#2C2A38" />
          <stop offset="35%" stopColor={look.hairColor} />
          <stop offset="100%" stopColor="#121118" />
        </linearGradient>

        {/* Signature Lavender / Lilac Accent Braid Gradient */}
        <linearGradient id={`braidLavender-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#E0D2FF" />
          <stop offset="45%" stopColor={look.hairHighlight} />
          <stop offset="100%" stopColor="#947BD3" />
        </linearGradient>

        {/* Warm Dark Espresso-Amber Iris Gradient */}
        <linearGradient id={`eyeGrad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#23120B" />
          <stop offset="55%" stopColor={look.eyeColor} />
          <stop offset="100%" stopColor={look.eyeHighlight} />
        </linearGradient>

        {/* Charcoal Off-Shoulder Bomber Jacket Gradient */}
        <linearGradient id={`jacketGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5C5D68" />
          <stop offset="50%" stopColor={look.outfitPrimary} />
          <stop offset="100%" stopColor="#35363E" />
        </linearGradient>

        {/* Black Ribbed Mock-Neck & High-Waisted Trousers Gradient */}
        <linearGradient id={`blackFabric-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#25252E" />
          <stop offset="50%" stopColor={look.outfitAccent} />
          <stop offset="100%" stopColor="#111116" />
        </linearGradient>

        {/* Metallic Slate-Purple Headphones Gradient */}
        <linearGradient id={`headphoneGrad-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6D6682" />
          <stop offset="55%" stopColor="#454054" />
          <stop offset="100%" stopColor="#262330" />
        </linearGradient>

        {/* Soft Ambient Drop Glow */}
        <filter id={`softGlow-${uid}`} x="-15%" y="-15%" width="130%" height="130%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#020617" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* Soft Floor Contact Shadow (Shrinks when sitting, expands on land, fades when carried) */}
      {!isBust && (
        <ellipse
          cx="120"
          cy={isChibi ? '272' : '306'}
          rx={Math.round(46 * groundAnchor.shadowScale)}
          ry={isSitting ? '5.2' : '7.5'}
          fill="#020617"
          opacity={groundAnchor.posture === 'airborne' ? '0.22' : isSitting ? '0.38' : '0.48'}
          data-shadow-posture={groundAnchor.posture}
          data-shadow-scale={groundAnchor.shadowScale}
        />
      )}

      {/* ==================== LAYER 1: BACK BOX BRAIDS (SWAYING WITH SPRING PHYSICS) ==================== */}
      <g
        transform={`translate(${headShiftX * 0.55}, ${headShiftY * 0.45}) rotate(${
          braidSwayDeg * 0.65
        }, 120, 82)`}
        filter={`url(#softGlow-${uid})`}
      >
        {/* Dense Back Curtain of Long Black Box Braids */}
        <path
          d="M 76 52 C 66 104, 64 166, 70 218 C 88 226, 152 226, 170 218 C 176 166, 174 104, 164 52 Z"
          fill={`url(#braidBlack-${uid})`}
          stroke="#0E0E14"
          strokeWidth="1.8"
        />
        {/* Individual Back Box Braid Strands & Tapered Tips */}
        {[74, 82, 90, 98, 106, 114, 122, 130, 138, 146, 154, 162].map((bx, i) => (
          <g key={`back-braid-${bx}`}>
            <path
              d={`M ${bx} 60 C ${bx + (i % 2 === 0 ? -3 : 3)} 124, ${
                bx + (i % 2 === 0 ? 2 : -2)
              } 176, ${bx} ${212 + (i % 3) * 5}`}
              fill="none"
              stroke={i % 2 === 0 ? '#181720' : '#292736'}
              strokeWidth="5.2"
              strokeLinecap="round"
            />
            <path
              d={`M ${bx} 64 C ${bx + (i % 2 === 0 ? -3 : 3)} 124, ${
                bx + (i % 2 === 0 ? 2 : -2)
              } 176, ${bx} ${212 + (i % 3) * 5}`}
              fill="none"
              stroke="#3B384D"
              strokeWidth="1.2"
              strokeDasharray="3 5"
              opacity="0.65"
            />
          </g>
        ))}
      </g>

      {/* ==================== LAYER 2: BODY, OFF-SHOULDER BOMBER JACKET, MOCK-NECK & WIDE-LEG PANTS ==================== */}
      <g transform={bodyScaleTransform}>
        {/* HIGH-WAISTED BLACK WIDE-LEG TROUSERS & SILVER CHAINS (Hidden only in close-up bust mode) */}
        {!isBust && (
          <g
            transform={
              isSitting
                ? 'translate(0, -14)'
                : isRunning
                ? `translate(0, ${breathPhase % 2 === 0 ? -4 : 2})`
                : undefined
            }
          >
            {/* Left Wide-Leg Trouser Leg */}
            <g
              transform={
                isSitting
                  ? 'rotate(-14, 102, 214)'
                  : isDancing
                  ? `rotate(${breathPhase % 2 === 0 ? -4 : 2}, 104, 214)`
                  : isRunning
                  ? `rotate(${breathPhase % 2 === 0 ? 12 : -10}, 104, 214)`
                  : undefined
              }
            >
              <path
                d="M 86 196 L 120 196 L 117 302 L 78 302 C 80 262, 83 228, 86 196 Z"
                fill={`url(#blackFabric-${uid})`}
                stroke="#0B0B10"
                strokeWidth="2"
              />
              {/* Crisp Tailored Crease Line */}
              <line x1="99" y1="208" x2="95" y2="298" stroke="#2E2E3A" strokeWidth="1.4" />
              {/* Dark Streetwear Sneaker Sole Peek */}
              <path
                d="M 80 300 L 114 300 C 115 305, 111 307, 96 307 C 82 307, 79 305, 80 300 Z"
                fill="#181820"
                stroke="#09090D"
                strokeWidth="1.5"
              />
            </g>

            {/* Right Wide-Leg Trouser Leg */}
            <g
              transform={
                isSitting
                  ? 'rotate(14, 138, 214)'
                  : isDancing
                  ? `rotate(${breathPhase % 2 === 0 ? 2 : -4}, 136, 214)`
                  : isRunning
                  ? `rotate(${breathPhase % 2 === 0 ? -12 : 10}, 136, 214)`
                  : undefined
              }
            >
              <path
                d="M 120 196 L 154 196 C 157 228, 160 262, 162 302 L 123 302 Z"
                fill={`url(#blackFabric-${uid})`}
                stroke="#0B0B10"
                strokeWidth="2"
              />
              {/* Crisp Tailored Crease Line */}
              <line x1="141" y1="208" x2="145" y2="298" stroke="#2E2E3A" strokeWidth="1.4" />
              {/* Dark Streetwear Sneaker Sole Peek */}
              <path
                d="M 126 300 L 160 300 C 161 305, 158 307, 144 307 C 129 307, 125 305, 126 300 Z"
                fill="#181820"
                stroke="#09090D"
                strokeWidth="1.5"
              />
            </g>

            {/* High-Waisted Trouser Waistband, Seam & Pockets */}
            <path
              d="M 88 184 L 152 184 L 154 202 L 86 202 Z"
              fill="#181820"
              stroke="#0B0B10"
              strokeWidth="2"
            />
            {!isBackView ? (
              <g>
                {/* Center Fly Seam & Silver Waist Button */}
                <line x1="120" y1="184" x2="120" y2="222" stroke="#2E2E3B" strokeWidth="1.6" />
                <circle cx="120" cy="189" r="2.2" fill="#E2E8F0" stroke="#0F172A" strokeWidth="0.9" />
                {/* Front Pocket Slants */}
                <path d="M 88 194 L 102 206" stroke="#2E2E3B" strokeWidth="1.4" />
                <path d="M 152 194 L 138 206" stroke="#2E2E3B" strokeWidth="1.4" />

                {/* SILVER WAIST CHAIN BELT & SWINGING RIGHT HIP POCKET CHAIN (Signature Sheet Detail) */}
                <path
                  d="M 88 190 Q 120 195 152 190"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="2.2"
                  strokeDasharray="3 2"
                />
                <g
                  transform={`rotate(${chainSwingDeg}, 130, 191)`}
                  style={{ transition: animationPaused ? 'none' : 'transform 240ms ease-out' }}
                >
                  {/* Upper Silver Hip Chain Loop */}
                  <path
                    d="M 129 191 Q 140 214 154 222"
                    fill="none"
                    stroke="#E2E8F0"
                    strokeWidth="2.2"
                    strokeDasharray="2.8 1.8"
                  />
                  {/* Lower Hanging Silver Hip Chain Loop */}
                  <path
                    d="M 126 192 Q 138 224 155 232"
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth="1.8"
                    strokeDasharray="2.5 1.8"
                  />
                  {/* Silver Clasp Ring */}
                  <circle cx="128" cy="191" r="2" fill="#F8FAFC" />
                </g>
              </g>
            ) : (
              <g>
                {/* Back Trouser Center Seam, Back Pockets & Left Hip Chain Peek (Matches Top-Right Back View!) */}
                <line x1="120" y1="188" x2="120" y2="226" stroke="#2E2E3B" strokeWidth="1.6" />
                <polygon
                  points="94,202 112,202 110,218 96,218"
                  fill="none"
                  stroke="#2E2E3B"
                  strokeWidth="1.4"
                />
                <polygon
                  points="128,202 146,202 144,218 130,218"
                  fill="none"
                  stroke="#2E2E3B"
                  strokeWidth="1.4"
                />
                <path
                  d="M 96 196 Q 89 210 85 220"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="2.1"
                  strokeDasharray="2.5 1.8"
                />
              </g>
            )}
          </g>
        )}

        {/* TORSO: BLACK RIBBED SLEEVELESS MOCK-NECK + BARE SHOULDER + OFF-SHOULDER CHARCOAL BOMBER JACKET */}
        <g transform={`translate(${turnShiftX * 0.4}, ${breathPhase % 2 === 0 ? -1.5 : 0.5})`}>
          {/* Neck & Warm Brown Shoulders / Exposed Right Shoulder (Her Left Shoulder) */}
          <path
            d="M 110 112 L 130 112 L 133 134 L 107 134 Z"
            fill={`url(#skinShadow-${uid})`}
            stroke="#141118"
            strokeWidth="1.6"
          />

          {/* BARE SHOULDER SKIN:
              In Front / 3/4 View: Viewer's Right Shoulder (x: 134..172) is bare warm brown skin!
              In Back View: Viewer's Left Shoulder (x: 68..106) is bare warm brown skin! */}
          {!isBackView ? (
            <path
              d="M 132 128 C 148 128, 164 134, 168 150 L 144 156 L 132 136 Z"
              fill={`url(#skinGrad-${uid})`}
              stroke="#141118"
              strokeWidth="1.8"
            />
          ) : (
            <path
              d="M 108 128 C 92 128, 76 134, 72 150 L 96 156 L 108 136 Z"
              fill={`url(#skinGrad-${uid})`}
              stroke="#141118"
              strokeWidth="1.8"
            />
          )}

          {/* Fitted Black Ribbed Sleeveless Mock-Neck Top */}
          <path
            d="M 92 128 C 102 124, 138 124, 146 130 L 150 186 L 90 186 Z"
            fill={`url(#blackFabric-${uid})`}
            stroke="#0B0B10"
            strokeWidth="2"
          />
          {/* High Ribbed Mock-Neck Collar */}
          <path
            d="M 106 118 L 134 118 L 136 130 C 124 133, 116 133, 104 130 Z"
            fill="#1D1D26"
            stroke="#0B0B10"
            strokeWidth="1.8"
          />
          {/* Subtle Ribbed Knit Vertical Lines on Mock-Neck */}
          {[100, 108, 116, 124, 132, 140].map((rx) => (
            <line
              key={`rib-${rx}`}
              x1={rx}
              y1="130"
              x2={rx}
              y2="184"
              stroke="#2A2A36"
              strokeWidth="1"
              opacity="0.7"
            />
          ))}

          {/* Double Layered Silver Chain Necklaces + Silver Drop Pendant (Front & 3/4 Views) */}
          {!isBackView && (
            <g>
              {/* Short Inner Silver Chain */}
              <path
                d="M 107 129 Q 120 143 133 129"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="1.5"
              />
              {/* Longer Outer Silver Chain with Pendant */}
              <path
                d="M 105 131 Q 120 156 135 131"
                fill="none"
                stroke="#CBD5E1"
                strokeWidth="1.6"
              />
              <circle
                cx="120"
                cy="146"
                r="2.4"
                fill="#F8FAFC"
                stroke="#475569"
                strokeWidth="0.8"
              />
            </g>
          )}

          {/* OVER-EAR METALLIC SLATE-PURPLE NECK HEADPHONES (Resting around neck in Front / 3/4) */}
          {!isBackView && (
            <g transform="translate(0, 1)">
              {/* Headphone Neckband Behind Collar */}
              <path
                d="M 94 126 C 98 136, 142 136, 146 126"
                fill="none"
                stroke="#322F3D"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              {/* Left Headphone Earcup */}
              <g transform="rotate(14, 98, 126)">
                <ellipse
                  cx="98"
                  cy="126"
                  rx="8.5"
                  ry="11"
                  fill="#23202C"
                  stroke="#0F0E14"
                  strokeWidth="1.6"
                />
                <ellipse
                  cx="96.5"
                  cy="126"
                  rx="6.5"
                  ry="9.2"
                  fill={`url(#headphoneGrad-${uid})`}
                  stroke="#7D7594"
                  strokeWidth="1.2"
                />
              </g>
              {/* Right Headphone Earcup */}
              <g transform="rotate(-14, 142, 126)">
                <ellipse
                  cx="142"
                  cy="126"
                  rx="8.5"
                  ry="11"
                  fill="#23202C"
                  stroke="#0F0E14"
                  strokeWidth="1.6"
                />
                <ellipse
                  cx="143.5"
                  cy="126"
                  rx="6.5"
                  ry="9.2"
                  fill={`url(#headphoneGrad-${uid})`}
                  stroke="#7D7594"
                  strokeWidth="1.2"
                />
              </g>
            </g>
          )}

          {/* ==================== OVERSIZED CHARCOAL-GREY OFF-SHOULDER BOMBER JACKET ==================== */}
          {!isBackView ? (
            <g>
              {/* LEFT SIDE OF JACKET (Viewer's Left — Worn On Shoulder) */}
              <path
                d="M 94 124 C 76 126, 64 138, 58 158 L 54 198 L 74 202 L 78 192 L 96 192 L 96 128 Z"
                fill={`url(#jacketGrad-${uid})`}
                stroke="#181820"
                strokeWidth="2"
              />
              {/* Left Jacket Collar Lapel & Metallic Zipper Track */}
              <path
                d="M 96 126 L 84 144 L 96 154 Z"
                fill="#5E606B"
                stroke="#181820"
                strokeWidth="1.5"
              />
              <line x1="95.5" y1="130" x2="95.5" y2="192" stroke="#CBD5E1" strokeWidth="1.4" strokeDasharray="2 2" />
              {/* Left Ribbed Waistband Hem */}
              <rect
                x="76"
                y="185"
                width="20"
                height="8"
                rx="2"
                fill="#35363E"
                stroke="#181820"
                strokeWidth="1.5"
              />

              {/* RIGHT SIDE OF JACKET (Viewer's Right — Slouched Off Shoulder exposing bare brown skin!) */}
              <path
                d="M 146 146 C 158 140, 172 144, 178 160 L 184 198 L 164 202 L 160 192 L 144 192 L 144 152 Z"
                fill={`url(#jacketGrad-${uid})`}
                stroke="#181820"
                strokeWidth="2"
              />
              {/* Wide Folded Off-Shoulder Lapel Draped Across Right Upper Arm */}
              <path
                d="M 143 154 C 152 142, 166 138, 175 147 C 166 156, 154 162, 143 166 Z"
                fill="#636572"
                stroke="#181820"
                strokeWidth="1.7"
              />
              <line x1="144.5" y1="154" x2="144.5" y2="192" stroke="#CBD5E1" strokeWidth="1.4" strokeDasharray="2 2" />
              {/* Right Ribbed Waistband Hem */}
              <rect
                x="144"
                y="185"
                width="18"
                height="8"
                rx="2"
                fill="#35363E"
                stroke="#181820"
                strokeWidth="1.5"
              />

              {/* RELAXED ARMS & HANDS AT SIDES (When no hand prop is active) */}
              {effectiveProp === 'none' && (
                <g>
                  {/* Left Oversized Bomber Sleeve + Ribbed Cuff + Warm Brown Hand */}
                  <g
                    transform={
                      isDancing || isCelebrating || action === 'wave_greet' || action === 'wave'
                        ? `rotate(${breathPhase % 2 === 0 ? -16 : -6}, 68, 148)`
                        : `rotate(${braidSwayDeg * 0.25}, 68, 148)`
                    }
                  >
                    <path
                      d="M 66 140 C 52 156, 46 182, 50 206 L 74 206 C 76 186, 76 164, 76 146 Z"
                      fill={`url(#jacketGrad-${uid})`}
                      stroke="#181820"
                      strokeWidth="2"
                    />
                    {/* Sleeve Crease Folds */}
                    <path d="M 54 176 L 68 182" stroke="#32333B" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M 52 190 L 69 194" stroke="#32333B" strokeWidth="1.6" strokeLinecap="round" />
                    {/* Dark Ribbed Wrist Cuff */}
                    <rect
                      x="52"
                      y="204"
                      width="20"
                      height="8"
                      rx="2.5"
                      fill="#2F3038"
                      stroke="#181820"
                      strokeWidth="1.6"
                    />
                    {/* Left Warm Brown Hand */}
                    <path
                      d="M 54 212 C 52 220, 55 227, 61 227 C 66 227, 69 221, 69 212 Z"
                      fill={`url(#skinGrad-${uid})`}
                      stroke="#181820"
                      strokeWidth="1.6"
                    />
                    <path d="M 68 214 C 72 217, 72 222, 68 223" fill="none" stroke="#181820" strokeWidth="1.4" />
                  </g>

                  {/* Right Off-Shoulder Bomber Sleeve + Ribbed Cuff + Warm Brown Hand */}
                  <g
                    transform={
                      isWaitingApproval
                        ? `rotate(-44, 170, 154)`
                        : action === 'wave_greet' || action === 'wave' || isCelebrating
                        ? `rotate(${breathPhase % 2 === 0 ? -38 : -22}, 170, 154)`
                        : isDancing
                        ? `rotate(${breathPhase % 2 === 0 ? 6 : 16}, 170, 154)`
                        : `rotate(${braidSwayDeg * 0.25}, 170, 154)`
                    }
                  >
                    <path
                      d="M 164 150 C 164 168, 164 188, 166 206 L 190 206 C 194 182, 188 158, 174 144 Z"
                      fill={`url(#jacketGrad-${uid})`}
                      stroke="#181820"
                      strokeWidth="2"
                    />
                    {/* Sleeve Crease Folds */}
                    <path d="M 186 176 L 172 182" stroke="#32333B" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M 188 190 L 171 194" stroke="#32333B" strokeWidth="1.6" strokeLinecap="round" />
                    {/* Dark Ribbed Wrist Cuff */}
                    <rect
                      x="168"
                      y="204"
                      width="20"
                      height="8"
                      rx="2.5"
                      fill="#2F3038"
                      stroke="#181820"
                      strokeWidth="1.6"
                    />
                    {/* Right Warm Brown Hand */}
                    <path
                      d="M 171 212 C 171 221, 174 227, 179 227 C 185 227, 188 220, 186 212 Z"
                      fill={`url(#skinGrad-${uid})`}
                      stroke="#181820"
                      strokeWidth="1.6"
                    />
                    <path d="M 172 214 C 168 217, 168 222, 172 223" fill="none" stroke="#181820" strokeWidth="1.4" />
                  </g>
                </g>
              )}
            </g>
          ) : (
            /* BACK VIEW BOMBER JACKET (Matches Top-Right Figure in Character Sheet!) */
            <g>
              <path
                d="M 74 148 C 82 140, 96 138, 108 136 L 138 128 C 156 130, 168 142, 176 164 L 186 204 L 166 206 L 160 192 L 80 192 L 74 206 L 54 204 C 60 176, 66 158, 74 148 Z"
                fill={`url(#jacketGrad-${uid})`}
                stroke="#181820"
                strokeWidth="2"
              />
              {/* Off-Shoulder Left Collar Fold on Back View */}
              <path
                d="M 72 150 C 84 142, 98 140, 112 142 L 108 152 C 94 150, 82 152, 72 158 Z"
                fill="#636572"
                stroke="#181820"
                strokeWidth="1.6"
              />
              {/* Ribbed Back Hem of Bomber Jacket */}
              <rect
                x="80"
                y="184"
                width="80"
                height="9"
                rx="2.5"
                fill="#35363E"
                stroke="#181820"
                strokeWidth="1.6"
              />
              {/* Back View Hands & Cuffs */}
              <rect x="54" y="204" width="20" height="8" rx="2.5" fill="#2F3038" stroke="#181820" strokeWidth="1.6" />
              <path d="M 56 212 C 54 220, 57 227, 63 227 C 68 227, 70 220, 70 212 Z" fill={`url(#skinGrad-${uid})`} stroke="#181820" strokeWidth="1.6" />
              <rect x="166" y="204" width="20" height="8" rx="2.5" fill="#2F3038" stroke="#181820" strokeWidth="1.6" />
              <path d="M 170 212 C 170 220, 172 227, 177 227 C 183 227, 186 220, 184 212 Z" fill={`url(#skinGrad-${uid})`} stroke="#181820" strokeWidth="1.6" />
            </g>
          )}
        </g>
      </g>

      {/* ==================== LAYER 3: HEAD, FACE, 5 EXPRESSIONS, BOX BRAIDS & STAR CLIPS ==================== */}
      <g
        transform={headScaleTransform}
        style={{ transition: animationPaused ? 'none' : 'transform 160ms ease-out' }}
      >
        {!isBackView ? (
          <g>
            {/* Warm Brown Ears + Silver Hoop Earrings (Left & Right) */}
            <g>
              {/* Left Ear & Silver Hoop */}
              <path
                d="M 86 78 C 80 78, 79 90, 86 93 Z"
                fill={`url(#skinGrad-${uid})`}
                stroke="#18141C"
                strokeWidth="1.6"
              />
              <circle
                cx="83.5"
                cy="95.5"
                r="4.2"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="1.5"
              />
              {/* Right Ear & Silver Hoop */}
              <path
                d="M 154 78 C 160 78, 161 90, 154 93 Z"
                fill={`url(#skinGrad-${uid})`}
                stroke="#18141C"
                strokeWidth="1.6"
              />
              <circle
                cx="156.5"
                cy="95.5"
                r="4.2"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="1.5"
              />
            </g>

            {/* Face Base Contour (Warm Medium-Deep Brown Skin with Sculpted Jaw & Chin) */}
            <path
              d="M 88 54 C 85 78, 88 100, 102 112 C 112 119, 128 119, 138 112 C 152 100, 155 78, 152 54 C 142 38, 98 38, 88 54 Z"
              fill={`url(#skinGrad-${uid})`}
              stroke="#18141C"
              strokeWidth="2"
            />

            {/* Soft Warm Terracotta Cheek Blush & Nose Bridge Highlight */}
            <ellipse
              cx="99"
              cy="91"
              rx="6.8"
              ry="3.4"
              fill="#A84A40"
              opacity={
                effectiveExpression === 'joy_beam' ||
                effectiveProp === 'shy_poke' ||
                effectiveProp === 'squish_cheeks' ||
                effectiveProp === 'headpat'
                  ? '0.52'
                  : '0.28'
              }
            />
            <ellipse
              cx="141"
              cy="91"
              rx="6.8"
              ry="3.4"
              fill="#A84A40"
              opacity={
                effectiveExpression === 'joy_beam' ||
                effectiveProp === 'shy_poke' ||
                effectiveProp === 'squish_cheeks' ||
                effectiveProp === 'headpat'
                  ? '0.52'
                  : '0.28'
              }
            />

            {/* ==================== 5 FACIAL EXPRESSIONS (Bottom Row of Uploaded Sheet) ==================== */}
            {effectiveExpression === 'pout_fierce' || isSleeping ? (
              /* EXPRESSION 5: SLEEPY / EXHAUSTED CLOSED EYES WITH YAWN & ANIME DROOL DROP (💧) */
              <g>
                {/* Slightly Furrowed Sleepy Eyebrows */}
                <path
                  d="M 94 69 Q 103 65 112 68"
                  fill="none"
                  stroke="#1A151E"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <path
                  d="M 146 69 Q 137 65 128 68"
                  fill="none"
                  stroke="#1A151E"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                {/* Closed Curved Eyelids with Long Dark Lashes */}
                <path
                  d="M 94 81 Q 103 86 112 81"
                  fill="none"
                  stroke="#141018"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path d="M 95 82 L 92 85" stroke="#141018" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M 103 84 L 103 87" stroke="#141018" strokeWidth="1.6" strokeLinecap="round" />
                <path
                  d="M 128 81 Q 137 86 146 81"
                  fill="none"
                  stroke="#141018"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path d="M 145 82 L 148 85" stroke="#141018" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M 137 84 L 137 87" stroke="#141018" strokeWidth="1.6" strokeLinecap="round" />
              </g>
            ) : isBlinking ? (
              /* Natural Blinking Frame */
              <g>
                <path d="M 94 68 Q 103 65 112 67" fill="none" stroke="#1A151E" strokeWidth="2.3" strokeLinecap="round" />
                <path d="M 146 68 Q 137 65 128 67" fill="none" stroke="#1A151E" strokeWidth="2.3" strokeLinecap="round" />
                <path d="M 94 81 Q 103 85 112 81" fill="none" stroke="#141018" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M 128 81 Q 137 85 146 81" fill="none" stroke="#141018" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            ) : (
              /* OPEN EYES FOR EXPRESSIONS 1 (Smile), 2 (Radiant Grin), 3 (Wide-Eyed Surprise), 4 (Concerned Worry) */
              <g>
                {/* Eyebrows tailored per expression */}
                {effectiveExpression === 'watery_plead' ? (
                  /* Expression 4: Concerned / Worried Upturned Inner Brows + Brow Crease */
                  <g>
                    <path
                      d="M 93 71 Q 103 68 112 63"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 147 71 Q 137 68 128 63"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path d="M 116 64 L 117 68" stroke="#7A4428" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M 124 64 L 123 68" stroke="#7A4428" strokeWidth="1.2" strokeLinecap="round" />
                  </g>
                ) : effectiveExpression === 'starry_surprise' ? (
                  /* Expression 3: High Raised Surprised Brows */
                  <g>
                    <path
                      d="M 93 64 Q 103 57 112 62"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 147 64 Q 137 57 128 62"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </g>
                ) : (
                  /* Expression 1 & 2: Confident Arched Dark Brows */
                  <g>
                    <path
                      d="M 93 68 Q 103 63 113 66"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 147 68 Q 137 63 127 66"
                      fill="none"
                      stroke="#1A151E"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {/* LEFT EYE (Viewer's Left) */}
                <g transform="translate(103, 79)">
                  {/* White Sclera */}
                  <ellipse
                    cx="0"
                    cy="0"
                    rx="8.5"
                    ry={
                      effectiveExpression === 'starry_surprise'
                        ? 7.2
                        : effectiveExpression === 'joy_beam'
                        ? 4.6
                        : 5.8
                    }
                    fill="#FFFFFF"
                  />
                  {/* Cursor-Tracked Warm Dark Brown Iris */}
                  <g transform={`translate(${irisX}, ${irisY})`}>
                    <ellipse
                      cx="0"
                      cy="0.3"
                      rx={effectiveExpression === 'starry_surprise' ? 5.0 : 5.5}
                      ry={
                        effectiveExpression === 'starry_surprise'
                          ? 5.2
                          : effectiveExpression === 'joy_beam'
                          ? 4.2
                          : 5.3
                      }
                      fill={`url(#eyeGrad-${uid})`}
                    />
                    {/* Deep Espresso Pupil */}
                    <circle cx="0" cy="0.3" r="2.5" fill="#120906" />
                    {/* Crisp White Anime Catchlights */}
                    <circle cx="-1.8" cy="-1.6" r="1.6" fill="#FFFFFF" />
                    <circle cx="1.8" cy="1.8" r="0.8" fill="#FFFFFF" opacity="0.9" />
                  </g>
                  {/* Winged Upper Eyelash Line */}
                  <path
                    d="M -9.2 -1.2 C -5 -6.8, 5 -6.8, 9.2 -0.8 L 10.8 -2.4"
                    fill="none"
                    stroke="#120E16"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {/* Lower Lid Curve (Squinted up on joy_beam) */}
                  <path
                    d={
                      effectiveExpression === 'joy_beam'
                        ? 'M -7 3.8 Q 0 1.8 7 3.8'
                        : 'M -6.5 5.2 Q 0 6.4 6.5 5.2'
                    }
                    fill="none"
                    stroke="#4E2D1E"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </g>

                {/* RIGHT EYE (Viewer's Right) */}
                <g transform="translate(137, 79)">
                  {/* White Sclera */}
                  <ellipse
                    cx="0"
                    cy="0"
                    rx="8.5"
                    ry={
                      effectiveExpression === 'starry_surprise'
                        ? 7.2
                        : effectiveExpression === 'joy_beam'
                        ? 4.6
                        : 5.8
                    }
                    fill="#FFFFFF"
                  />
                  {/* Cursor-Tracked Warm Dark Brown Iris */}
                  <g transform={`translate(${irisX}, ${irisY})`}>
                    <ellipse
                      cx="0"
                      cy="0.3"
                      rx={effectiveExpression === 'starry_surprise' ? 5.0 : 5.5}
                      ry={
                        effectiveExpression === 'starry_surprise'
                          ? 5.2
                          : effectiveExpression === 'joy_beam'
                          ? 4.2
                          : 5.3
                      }
                      fill={`url(#eyeGrad-${uid})`}
                    />
                    {/* Deep Espresso Pupil */}
                    <circle cx="0" cy="0.3" r="2.5" fill="#120906" />
                    {/* Crisp White Anime Catchlights */}
                    <circle cx="-1.8" cy="-1.6" r="1.6" fill="#FFFFFF" />
                    <circle cx="1.8" cy="1.8" r="0.8" fill="#FFFFFF" />
                  </g>
                  {/* Winged Upper Eyelash Line */}
                  <path
                    d="M -9.2 -0.8 C -5 -6.8, 5 -6.8, 9.2 -1.2 L 10.8 -2.4"
                    fill="none"
                    stroke="#120E16"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {/* Lower Lid Curve */}
                  <path
                    d={
                      effectiveExpression === 'joy_beam'
                        ? 'M -7 3.8 Q 0 1.8 7 3.8'
                        : 'M -6.5 5.2 Q 0 6.4 6.5 5.2'
                    }
                    fill="none"
                    stroke="#4E2D1E"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </g>
              </g>
            )}

            {/* Sculpted Anime Nose Bridge, Nostril Shadow & Tip Highlight */}
            <path
              d="M 119.5 78 L 118.2 89.5 C 119.5 91.2, 121.5 91.2, 122.5 89.8"
              fill="none"
              stroke="#7A4428"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="120.4" cy="88.2" r="1.1" fill="#DDA382" opacity="0.7" />

            {/* MOUTH & FULL LIPS (Matching All 5 Portraits in Bottom Row of Sheet + Speaking Lip-Sync) */}
            <g transform="translate(120, 100.5)">
              {mouthOpenPhase > 0 ? (
                /* Speaking / Sipping Boba Animated Lip-Sync */
                <ellipse
                  cx="0"
                  cy="0"
                  rx={mouthOpenPhase === 1 ? '4.2' : '3.0'}
                  ry={mouthOpenPhase === 1 ? '3.4' : '2.2'}
                  fill="#6E2822"
                  stroke="#3B1512"
                  strokeWidth="1.3"
                />
              ) : effectiveExpression === 'pout_fierce' || isSleeping ? (
                /* Expression 5: Open Sleepy Mouth + Signature Glistening Drool Droplet (💧) */
                <g>
                  <path
                    d="M -5.5 0.5 C -3.5 -3.5, 3.5 -3.5, 5.5 0.5 C 4.5 4.2, -4.5 4.2, -5.5 0.5 Z"
                    fill="#5E201C"
                    stroke="#2E110E"
                    strokeWidth="1.4"
                  />
                  {/* Upper Teeth Hint */}
                  <path d="M -3.5 -1.4 L 3.5 -1.4" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" />
                  {/* Tongue Tint */}
                  <path d="M -3.2 1.8 Q 0 0.2 3.2 1.8" fill="#C8645A" />
                  {/* Signature Anime Drool Droplet at Right Corner of Mouth! */}
                  <path
                    d="M 3.8 2.2 C 3.2 5.2, 4.4 7.8, 5.2 7.8 C 6.0 7.8, 6.4 5.2, 4.8 2.2 Z"
                    fill="#E0F2FE"
                    stroke="#38BDF8"
                    strokeWidth="0.9"
                  />
                  <circle cx="4.9" cy="6.1" r="0.7" fill="#FFFFFF" />
                </g>
              ) : effectiveExpression === 'joy_beam' ? (
                /* Expression 2: Bright White Toothy Grin */
                <g>
                  <path
                    d="M -7.5 -1.2 Q 0 1.2 7.5 -1.2 C 6.2 4.8, -6.2 4.8, -7.5 -1.2 Z"
                    fill="#FFFFFF"
                    stroke="#4A1E17"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M -7.5 -1.2 Q 0 -2.6 7.5 -1.2"
                    fill="none"
                    stroke="#964B3B"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M -5.2 3.6 Q 0 5.5 5.2 3.6"
                    fill="none"
                    stroke="#B86B58"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </g>
              ) : effectiveExpression === 'starry_surprise' ? (
                /* Expression 3: Surprised 'O' Mouth */
                <g>
                  <ellipse
                    cx="0"
                    cy="0.6"
                    rx="4.2"
                    ry="3.6"
                    fill="#5E201C"
                    stroke="#3B1512"
                    strokeWidth="1.5"
                  />
                  <path d="M -2.5 2.2 Q 0 0.8 2.5 2.2" fill="#C8645A" />
                </g>
              ) : effectiveExpression === 'watery_plead' ? (
                /* Expression 4: Concerned Slightly Parted Mouth */
                <g>
                  <path
                    d="M -5.2 0.8 Q 0 -1.6 5.2 0.8 C 3.8 2.8, -3.8 2.8, -5.2 0.8 Z"
                    fill="#6E2822"
                    stroke="#3B1512"
                    strokeWidth="1.3"
                  />
                  <path d="M -3.2 0.3 L 3.2 0.3" stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round" />
                </g>
              ) : (
                /* Expression 1 (Default): Warm Confident Full-Lip Smile */
                <g>
                  {/* Upper Lip Cupid's Bow */}
                  <path
                    d="M -6.8 -0.2 Q -3 -1.8 0 -0.8 Q 3 -1.8 6.8 -0.2 Q 0 1.4 -6.8 -0.2 Z"
                    fill="#944B3B"
                  />
                  {/* Lower Full Lip */}
                  <path
                    d="M -6.2 0.2 Q 0 4.2 6.2 0.2 Q 0 1.6 -6.2 0.2 Z"
                    fill="#B66A56"
                  />
                  {/* Crisp Smile Line */}
                  <path
                    d="M -7.0 -0.3 Q 0 2.0 7.0 -0.3"
                    fill="none"
                    stroke="#3E1812"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>

            {/* ==================== CROWN BOX BRAIDS, FOREHEAD PART, LAVENDER BRAIDS & STAR CLIPS ==================== */}
            <g>
              {/* Sculpted Braided Crown Volume */}
              <path
                d="M 80 68 C 78 36, 98 24, 122 24 C 144 24, 162 38, 160 68 C 154 52, 142 42, 132 40 C 126 46, 110 42, 98 48 C 90 52, 84 60, 80 68 Z"
                fill={`url(#braidBlack-${uid})`}
                stroke="#0E0E14"
                strokeWidth="1.8"
              />
              {/* Curved Scalp Part Line on Viewer's Right (Her Left Forehead) */}
              <path
                d="M 131 40 C 134 33, 138 29, 143 27"
                fill="none"
                stroke="#B5764E"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              {/* Delicate Baby Hair Edges Along Forehead */}
              <path
                d="M 96 49 Q 102 53 106 49"
                fill="none"
                stroke="#181720"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <path
                d="M 132 42 Q 137 47 143 45"
                fill="none"
                stroke="#181720"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              {/* Braided Crown Ridge Texture Lines */}
              <path d="M 90 42 Q 110 30 130 38" fill="none" stroke="#353246" strokeWidth="1.6" strokeDasharray="4 3" />
              <path d="M 86 50 Q 108 36 128 42" fill="none" stroke="#353246" strokeWidth="1.6" strokeDasharray="4 3" />

              {/* FRONT LEFT CASCADING BOX BRAIDS + 3 SIGNATURE LAVENDER ACCENT BRAIDS (Viewer's Left) */}
              <g
                transform={`rotate(${braidSwayDeg * 0.85}, 86, 52)`}
                style={{ transition: animationPaused ? 'none' : 'transform 200ms ease-out' }}
              >
                {/* Outer Black Box Braids (Left Side) */}
                <path
                  d="M 82 48 C 72 86, 68 134, 70 176"
                  fill="none"
                  stroke={`url(#braidBlack-${uid})`}
                  strokeWidth="5.8"
                  strokeLinecap="round"
                />
                <path
                  d="M 86 46 C 77 88, 74 138, 76 184"
                  fill="none"
                  stroke="#23212E"
                  strokeWidth="5.2"
                  strokeLinecap="round"
                />
                {/* SIGNATURE LAVENDER / LILAC ACCENT BRAIDS (3 Strands on Viewer's Left!) */}
                <path
                  d="M 90 46 C 83 88, 81 136, 83 182"
                  fill="none"
                  stroke={`url(#braidLavender-${uid})`}
                  strokeWidth="4.4"
                  strokeLinecap="round"
                />
                <path
                  d="M 94 48 C 88 90, 86 138, 88 176"
                  fill="none"
                  stroke={`url(#braidLavender-${uid})`}
                  strokeWidth="3.8"
                  strokeLinecap="round"
                />
                <path
                  d="M 89 62 C 80 100, 78 142, 80 170"
                  fill="none"
                  stroke={look.hairHighlight}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  opacity="0.9"
                />
                {/* Woven Braid Segment Lines on Lavender Braids */}
                <path
                  d="M 90 50 C 83 88, 81 136, 83 180"
                  fill="none"
                  stroke="#5B468E"
                  strokeWidth="1.2"
                  strokeDasharray="3 4"
                />
                <path
                  d="M 94 52 C 88 90, 86 138, 88 174"
                  fill="none"
                  stroke="#5B468E"
                  strokeWidth="1.1"
                  strokeDasharray="3 4"
                />
              </g>

              {/* FRONT RIGHT CASCADING BOX BRAIDS (Viewer's Right) */}
              <g
                transform={`rotate(${braidSwayDeg * 0.75}, 152, 52)`}
                style={{ transition: animationPaused ? 'none' : 'transform 200ms ease-out' }}
              >
                <path
                  d="M 152 48 C 160 82, 162 114, 158 136"
                  fill="none"
                  stroke={`url(#braidBlack-${uid})`}
                  strokeWidth="5.6"
                  strokeLinecap="round"
                />
                <path
                  d="M 156 54 C 164 86, 166 116, 162 138"
                  fill="none"
                  stroke="#252330"
                  strokeWidth="4.8"
                  strokeLinecap="round"
                />
                <path
                  d="M 152 52 C 160 82, 162 114, 158 134"
                  fill="none"
                  stroke="#3E3B52"
                  strokeWidth="1.2"
                  strokeDasharray="3 4"
                />
              </g>

              {/* SILVER & LAVENDER STAR HAIR CLIPS (★) ON BOTH SIDES OF BRAIDS */}
              {/* Viewer's Left Temple Star Clips (2 Stars on Lavender/Black Braids) */}
              <g transform="translate(86, 55)">
                <polygon
                  points="0,-5 1.4,-1.5 5,-1.2 2.2,1.2 3.1,4.8 0,2.8 -3.1,4.8 -2.2,1.2 -5,-1.2 -1.4,-1.5"
                  fill={look.hairHighlight}
                  stroke="#1E1B2E"
                  strokeWidth="0.9"
                />
              </g>
              <g transform="translate(83, 64) scale(0.82)">
                <polygon
                  points="0,-5 1.4,-1.5 5,-1.2 2.2,1.2 3.1,4.8 0,2.8 -3.1,4.8 -2.2,1.2 -5,-1.2 -1.4,-1.5"
                  fill="#F8FAFC"
                  stroke="#1E1B2E"
                  strokeWidth="1"
                />
              </g>

              {/* Viewer's Right Temple Star Clips (2 Silver Stars along the Part) */}
              <g transform="translate(148, 50) scale(0.88)">
                <polygon
                  points="0,-5 1.4,-1.5 5,-1.2 2.2,1.2 3.1,4.8 0,2.8 -3.1,4.8 -2.2,1.2 -5,-1.2 -1.4,-1.5"
                  fill="#F8FAFC"
                  stroke="#1E1B2E"
                  strokeWidth="0.9"
                />
              </g>
              <g transform="translate(153, 58) scale(0.78)">
                <polygon
                  points="0,-5 1.4,-1.5 5,-1.2 2.2,1.2 3.1,4.8 0,2.8 -3.1,4.8 -2.2,1.2 -5,-1.2 -1.4,-1.5"
                  fill={look.hairHighlight}
                  stroke="#1E1B2E"
                  strokeWidth="0.9"
                />
              </g>
            </g>
          </g>
        ) : (
          /* ==================== BACK VIEW OF HEAD & LONG BLACK + LAVENDER BOX BRAIDS (Top-Right of Sheet!) ==================== */
          <g>
            {/* Full Crown & Cascading Back Box Braids */}
            <path
              d="M 80 54 C 80 28, 100 22, 120 22 C 140 22, 160 28, 160 54 L 168 188 C 142 198, 98 198, 72 188 Z"
              fill={`url(#braidBlack-${uid})`}
              stroke="#0E0E14"
              strokeWidth="2"
            />
            {/* Individual Vertical Back Box Braids */}
            {[80, 88, 96, 104, 112, 120, 128, 136, 144, 152, 160].map((bx, idx) => (
              <path
                key={`full-back-braid-${bx}`}
                d={`M ${bx} 34 C ${bx + (idx % 2 === 0 ? -2 : 2)} 96, ${bx} 148, ${bx} ${
                  182 + (idx % 3) * 6
                }`}
                fill="none"
                stroke={idx % 2 === 0 ? '#181720' : '#2A2838'}
                strokeWidth="5.4"
                strokeLinecap="round"
              />
            ))}
            {/* 2 Signature Long Lavender Accent Braids Running Down the Back (Matches Top-Right Sheet Figure!) */}
            <path
              d="M 106 30 C 102 84, 101 138, 103 186"
              fill="none"
              stroke={`url(#braidLavender-${uid})`}
              strokeWidth="4.6"
              strokeLinecap="round"
            />
            <path
              d="M 134 30 C 138 84, 139 138, 137 186"
              fill="none"
              stroke={`url(#braidLavender-${uid})`}
              strokeWidth="4.6"
              strokeLinecap="round"
            />
            <path
              d="M 106 34 C 102 84, 101 138, 103 184"
              fill="none"
              stroke="#5B468E"
              strokeWidth="1.2"
              strokeDasharray="3 4"
            />
            <path
              d="M 134 34 C 138 84, 139 138, 137 184"
              fill="none"
              stroke="#5B468E"
              strokeWidth="1.2"
              strokeDasharray="3 4"
            />
          </g>
        )}

        {/* ==================== LAYER 4: INTERACTIVE VTUBER PROPS & WARM BROWN HAND POSES ==================== */}

        {/* PROP 1: ICED BOBA CUP WITH STRAW */}
        {effectiveProp === 'boba' && !isBackView && (
          <g
            transform={`translate(114, ${
              breathPhase % 2 === 0 ? 112 : 114
            })`}
          >
            {/* Left & Right Charcoal Bomber Forearms + Warm Brown Hands Holding Cup */}
            <path
              d="M -30 22 C -18 14, -10 10, -4 10"
              fill="none"
              stroke={`url(#jacketGrad-${uid})`}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M 42 22 C 30 14, 22 10, 16 10"
              fill="none"
              stroke={`url(#jacketGrad-${uid})`}
              strokeWidth="10"
              strokeLinecap="round"
            />
            {/* Straw Reaching Toward Mouth */}
            <line
              x1="6"
              y1="2"
              x2="6"
              y2="-11"
              stroke={look.hairHighlight}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            {/* Clear Dome Lid */}
            <path
              d="M -6 4 C -6 -5, 18 -5, 18 4 Z"
              fill="#E2E8F0"
              fillOpacity="0.75"
              stroke="#0F172A"
              strokeWidth="1.5"
            />
            {/* Iced Milk Tea Cup Body */}
            <polygon
              points="-6,4 18,4 15,28 -3,28"
              fill="#FDE68A"
              stroke="#0F172A"
              strokeWidth="1.6"
            />
            <polygon points="-5,8 17,8 15,26 -3,26" fill="#D97706" fillOpacity="0.55" />
            {/* Tapioca Boba Pearls */}
            {[-1, 3, 7, 11, 1, 6, 10].map((px, idx) => (
              <circle
                key={idx}
                cx={px}
                cy={idx < 4 ? 24.5 : 21.5}
                r="1.8"
                fill="#1E1B4B"
              />
            ))}
            {/* Warm Brown Hands Clasping Cup */}
            <circle cx="-4" cy="14" r="4.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.4" />
            <circle cx="16" cy="14" r="4.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.4" />
          </g>
        )}

        {/* PROP 2: STRAWBERRY POPSICLE BAR */}
        {effectiveProp === 'popsicle' && !isBackView && (
          <g
            transform={`translate(132, ${
              breathPhase % 2 === 0 ? 104 : 106
            }) rotate(-16)`}
          >
            <rect
              x="-2.5"
              y="16"
              width="5"
              height="12"
              rx="2"
              fill="#FCD34D"
              stroke="#0F172A"
              strokeWidth="1.3"
            />
            <rect
              x="-8"
              y="-6"
              width="16"
              height="23"
              rx="7"
              fill="#FB7185"
              stroke="#0F172A"
              strokeWidth="1.6"
            />
            <path
              d="M -8 2 C -8 -6, 8 -6, 8 2 C 4 5, -4 5, -8 2 Z"
              fill="#FFF1F2"
            />
            <circle
              cx="0"
              cy="24"
              r="4.8"
              fill={`url(#skinGrad-${uid})`}
              stroke="#141018"
              strokeWidth="1.4"
            />
          </g>
        )}

        {/* PROP 3: HAND ON CHEEK / PONDER POSE */}
        {effectiveProp === 'cheek_touch' && !isBackView && (
          <g transform="translate(136, 98)">
            <path
              d="M 16 26 C 12 14, 6 6, 0 0"
              fill="none"
              stroke={`url(#jacketGrad-${uid})`}
              strokeWidth="9"
              strokeLinecap="round"
            />
            <circle
              cx="-2"
              cy="-2"
              r="5.2"
              fill={`url(#skinGrad-${uid})`}
              stroke="#141018"
              strokeWidth="1.5"
            />
          </g>
        )}

        {/* PROP 4: SHY FINGER-POKE POSE (👉👈) */}
        {effectiveProp === 'shy_poke' && !isBackView && (
          <g transform="translate(120, 122)">
            <path
              d="M -28 16 C -20 8, -12 4, -5 2"
              fill="none"
              stroke={`url(#jacketGrad-${uid})`}
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d="M 28 16 C 20 8, 12 4, 5 2"
              fill="none"
              stroke={`url(#jacketGrad-${uid})`}
              strokeWidth="9"
              strokeLinecap="round"
            />
            <circle cx="-6" cy="2" r="4.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.4" />
            <circle cx="6" cy="2" r="4.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.4" />
            <line x1="-3" y1="2" x2="-0.8" y2="2" stroke="#141018" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="3" y1="2" x2="0.8" y2="2" stroke="#141018" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}

        {/* PROP 5: CUPPING BOTH CHEEKS POSE (🫶) */}
        {effectiveProp === 'squish_cheeks' && !isBackView && (
          <g>
            <circle cx="91" cy="96" r="5.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.5" />
            <circle cx="149" cy="96" r="5.5" fill={`url(#skinGrad-${uid})`} stroke="#141018" strokeWidth="1.5" />
            <path
              d="M 80 34 C 76 30, 82 25, 85 30 C 88 25, 94 30, 90 34 L 85 39 Z"
              fill={look.hairHighlight}
            />
            <path
              d="M 155 34 C 151 30, 157 25, 160 30 C 163 25, 169 30, 165 34 L 160 39 Z"
              fill={look.hairHighlight}
            />
          </g>
        )}

        {/* PROP 6: INTERACTIVE HEADPAT HAND + FLOATING HEARTS */}
        {effectiveProp === 'headpat' && (
          <g
            transform={`translate(${
              breathPhase % 2 === 0 ? -4 : 4
            }, ${breathPhase % 2 === 0 ? -2 : 1})`}
          >
            <path
              d="M 100 18 C 110 10, 132 10, 142 18 C 145 23, 136 27, 120 26 C 106 27, 97 23, 100 18 Z"
              fill="#FDE68A"
              stroke="#0F172A"
              strokeWidth="1.8"
            />
            <path
              d="M 76 32 C 72 27, 79 22, 82 27 C 85 22, 92 27, 88 32 L 82 38 Z"
              fill={look.hairHighlight}
              stroke="#0F172A"
              strokeWidth="1"
            />
            <path
              d="M 156 28 C 152 23, 159 18, 162 23 C 165 18, 172 23, 168 28 L 162 34 Z"
              fill={look.hairHighlight}
              stroke="#0F172A"
              strokeWidth="1"
            />
          </g>
        )}

        {/* Invisible Crown Rub Hitbox so rubbing Morrow's head with the mouse triggers Headpat */}
        <rect
          x="78"
          y="14"
          width="84"
          height="38"
          fill="transparent"
          onMouseMove={handleCrownMouseMove}
        />
      </g>

      {/* ==================== LAYER 5: STATE OVERLAYS (HOLO-KEYBOARD, CELEBRATE SPARKLES, SLEEP ZZZ, VERIFY/SHIELD/APPROVAL BADGES) ==================== */}
      {(action === 'work_type' || action === 'work' || presenceState === 'work_type') && (
        <g transform="translate(68, 156)">
          <rect
            x="0"
            y="0"
            width="104"
            height="14"
            rx="4"
            fill="#0EA5E9"
            fillOpacity="0.22"
            stroke="#38BDF8"
            strokeWidth="1.5"
          />
          <line
            x1="10"
            y1="7"
            x2="94"
            y2="7"
            stroke="#BAE6FD"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </g>
      )}

      {/* Verify Check Badge (reuses think pose with small check badge) */}
      {(badge === 'check' || presenceState === 'verify') && (
        <g transform="translate(168, 42)" data-badge="check">
          <circle cx="14" cy="14" r="13" fill="#10B981" stroke="#064E3B" strokeWidth="2" />
          <path
            d="M 8 14.5 L 12.2 18.5 L 20.5 9.5"
            fill="none"
            stroke="#ECFDF5"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}

      {/* Shield Badge for blocked_by_guard (surprised + shield badge) */}
      {(badge === 'shield' || presenceState === 'surprised') && (
        <g transform="translate(166, 40)" data-badge="shield">
          <path
            d="M 16 2 L 29 7 V 16 C 29 24.5, 23 30.5, 16 33 C 9 30.5, 3 24.5, 3 16 V 7 Z"
            fill="#F59E0B"
            stroke="#78350F"
            strokeWidth="2"
          />
          <path
            d="M 16 8 V 19 M 16 24.5 H 16.02"
            stroke="#FFFBEB"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Raised-Hand Waiting Approval Indicator Badge */}
      {(badge === 'pending' || isWaitingApproval) && (
        <g transform="translate(164, 38)" data-badge="pending">
          <rect
            x="0"
            y="0"
            width="34"
            height="24"
            rx="8"
            fill="#F59E0B"
            stroke="#78350F"
            strokeWidth="1.8"
          />
          <text
            x="17"
            y="16"
            textAnchor="middle"
            fill="#0F172A"
            fontSize="12"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            ✋!
          </text>
        </g>
      )}

      {isCelebrating && (
        <g>
          <polygon
            points="54,48 57,56 65,59 57,62 54,70 51,62 43,59 51,56"
            fill="#FDE047"
          />
          <polygon
            points="186,44 189,52 197,55 189,58 186,66 183,58 175,55 183,52"
            fill={look.hairHighlight}
          />
        </g>
      )}

      {isSleeping && (
        <g fill={look.hairHighlight} fontFamily="monospace" fontWeight="bold">
          <text x="164" y="46" fontSize="13">
            Z
          </text>
          <text x="176" y="34" fontSize="10" opacity="0.8">
            z
          </text>
          <text x="185" y="24" fontSize="8" opacity="0.6">
            z
          </text>
        </g>
      )}
    </svg>
  );
};
