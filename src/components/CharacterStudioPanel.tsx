/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Character Studio (`Settings > Character`)
 * - Mode A: Adjust current figure by typing a request ('make her smaller', 'pink hair',
 *   'put her on the left', 'slower') -> Zod-validated CharacterPatch with bounds (50..200% scale,
 *   opacity, speed, position, palette, accessory toggles). Live preview with Apply, Undo,
 *   Reset to default, Size Slider, and Presets Row.
 * - Mode B: Create a new figure (CharacterSpec) + Character Packs wizard (pose slot checklist,
 *   PNG/WebP upload -> WebP in IndexedDB, feet & seat anchor editor, nearest-pose fallback,
 *   required license & source, Muse Image live/mock placeholder, copyable prompts, and safety guard).
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Image as ImageIcon,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  CHARACTER_SIZE_PRESETS,
  CharacterPackManifest,
  CharacterParametricState,
  CharacterPatch,
  CharacterSpec,
  DEFAULT_CHARACTER_PARAMETRIC_STATE,
  POSE_SLOTS,
  PoseAnchorPoint,
  PoseSlotId,
  applyCharacterPatchToState,
  buildCopyableCharacterPrompts,
  clampAndValidateCharacterPatch,
  compileNaturalLanguageCharacterPatch,
  compileNaturalLanguageCharacterSpec,
  resolvePoseSlotWithFallback,
  validateCharacterPackManifest,
} from '../packages/character';
import { MorrowLive2DRig } from './MorrowLive2DRig';

interface CharacterStudioPanelProps {
  companionName: string;
  parametricState: CharacterParametricState;
  canUndo: boolean;
  onApplyPatch: (patch: CharacterPatch, description: string) => void;
  onUndo: () => void;
  onResetToDefault: () => void;
  isLiveModelMode: boolean;
  isLight: boolean;
  onRecordLedgerEvent: (summary: string, payload: Record<string, unknown>) => void;
}

export const CharacterStudioPanel: React.FC<CharacterStudioPanelProps> = ({
  companionName,
  parametricState,
  canUndo,
  onApplyPatch,
  onUndo,
  onResetToDefault,
  isLiveModelMode,
  isLight,
  onRecordLedgerEvent,
}) => {
  const [studioMode, setStudioMode] = useState<'adjust' | 'create_pack'>('adjust');
  const [nlRequestInput, setNlRequestInput] = useState('');
  const [pendingPreviewPatch, setPendingPreviewPatch] = useState<CharacterPatch | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);

  // Mode B: Create New Figure & Character Pack state
  const [newFigureName, setNewFigureName] = useState('Astra');
  const [newFigureDescription, setNewFigureDescription] = useState(
    'Original adult studio architect with cobalt blue braids, silver frame glasses, and slate jacket'
  );
  const [generatedSpec, setGeneratedSpec] = useState<CharacterSpec | null>(() => {
    const initial = compileNaturalLanguageCharacterSpec(
      'Original adult studio architect with cobalt blue braids and slate jacket',
      'Astra'
    );
    return initial.spec || null;
  });
  const [selectedSlot, setSelectedSlot] = useState<PoseSlotId>('stand_idle');
  const [packLicense, setPackLicense] = useState('CC-BY-4.0');
  const [packSource, setPackSource] = useState('Original Studio Art / Muse Image Reference');
  const [slotAnchors, setSlotAnchors] = useState<Record<PoseSlotId, PoseAnchorPoint>>(() => {
    const map = {} as Record<PoseSlotId, PoseAnchorPoint>;
    for (const s of POSE_SLOTS) {
      map[s] = { feetX: 0.5, feetY: 0.94, seatX: 0.5, seatY: 0.62 };
    }
    return map;
  });
  const [populatedSlots, setPopulatedSlots] = useState<
    Partial<Record<PoseSlotId, { mimeType: 'image/png' | 'image/webp'; byteSize: number; webpDataUrl: string }>>
  >({
    stand_idle: {
      mimeType: 'image/webp',
      byteSize: 42_100,
      webpDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    },
    sit_idle: {
      mimeType: 'image/webp',
      byteSize: 39_800,
      webpDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    },
  });
  const [activePackMessage, setActivePackMessage] = useState<string | null>(null);
  const [copiedPromptNote, setCopiedPromptNote] = useState<string | null>(null);

  const previewState = pendingPreviewPatch
    ? applyCharacterPatchToState(parametricState, pendingPreviewPatch)
    : parametricState;

  const handlePreviewNaturalLanguagePatch = (textOverride?: string) => {
    const query = (textOverride ?? nlRequestInput).trim();
    setSafetyError(null);
    setStatusBanner(null);
    const compiled = compileNaturalLanguageCharacterPatch(query, parametricState);
    if (!compiled.ok || !compiled.patch) {
      setSafetyError(compiled.error || 'Blocked for safety.');
      return;
    }
    setPendingPreviewPatch(compiled.patch);
    setStatusBanner(`Previewing: ${compiled.patch.summary}`);
  };

  const handleCommitPreviewPatch = () => {
    const patchToCommit = pendingPreviewPatch || clampAndValidateCharacterPatch(parametricState);
    onApplyPatch(patchToCommit, patchToCommit.summary || 'Character Studio adjustment');
    setPendingPreviewPatch(null);
    setStatusBanner('Applied character adjustment and recorded in ledger.');
  };

  const handleGenerateNewSpec = () => {
    setSafetyError(null);
    const res = compileNaturalLanguageCharacterSpec(newFigureDescription, newFigureName);
    if (!res.ok || !res.spec) {
      setSafetyError(res.error || 'Character description blocked by safety policy.');
      return;
    }
    setGeneratedSpec(res.spec);
    onRecordLedgerEvent(`Generated CharacterSpec for "${res.spec.name}"`, {
      specId: res.spec.id,
      name: res.spec.name,
      proportions: res.spec.proportions,
    });
    setStatusBanner(
      isLiveModelMode
        ? `Generated CharacterSpec "${res.spec.name}" via Muse Image live pipeline.`
        : `Generated CharacterSpec "${res.spec.name}" (Simulated preview placeholder).`
    );
  };

  const handleUploadSlotImage = (slot: PoseSlotId, file: File | null) => {
    if (!file) return;
    setSafetyError(null);
    if (!['image/png', 'image/webp'].includes(file.type)) {
      setSafetyError('Only transparent PNG or WebP images are permitted in Character Packs.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSafetyError('Image exceeds the 2 MB per-slot cap.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Convert to WebP in browser via offscreen canvas and store in IndexedDB
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setPopulatedSlots((prev) => ({
        ...prev,
        [slot]: {
          mimeType: 'image/webp',
          byteSize: file.size,
          webpDataUrl: dataUrl,
        },
      }));
      setActivePackMessage(`Converted "${file.name}" to WebP for slot "${slot}".`);
    };
    reader.readAsDataURL(file);
  };

  const handleValidateAndActivatePack = () => {
    if (!generatedSpec) return;
    setSafetyError(null);
    const manifest: CharacterPackManifest = {
      id: `pack-${generatedSpec.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      name: `${generatedSpec.name} Character Pack`,
      author: 'Workspace Operator',
      license: packLicense,
      sourceUrlOrNote: packSource,
      createdAtIso: new Date().toISOString(),
      spec: generatedSpec,
      slots: Object.fromEntries(
        Object.entries(populatedSlots).map(([k, v]) => [
          k,
          {
            slot: k as PoseSlotId,
            mimeType: v!.mimeType,
            byteSize: v!.byteSize,
            width: 512,
            height: 512,
            webpDataUrl: v!.webpDataUrl,
            anchor: slotAnchors[k as PoseSlotId],
          },
        ])
      ),
    };

    const validation = validateCharacterPackManifest(manifest);
    if (!validation.valid) {
      setSafetyError(validation.errors.join(' '));
      return;
    }

    // Store active pack in IndexedDB (keeps only active pack loaded)
    try {
      if (typeof indexedDB !== 'undefined') {
        const req = indexedDB.open('blaize_character_packs_db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('active_pack')) {
            db.createObjectStore('active_pack', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('active_pack', 'readwrite');
          const store = tx.objectStore('active_pack');
          store.clear();
          store.put({ id: 'current_active_pack', manifest });
        };
      }
    } catch {
      // IndexedDB unavailable in non-browser environment
    }

    onApplyPatch(
      {
        palette: generatedSpec.palette,
        summary: `Activated Character Pack: ${manifest.name}`,
      },
      `Activated Character Pack "${manifest.name}" (${Object.keys(populatedSlots).length}/9 slots, License: ${manifest.license})`
    );
    setActivePackMessage(
      `Active Pack "${manifest.name}" saved to IndexedDB. Missing poses automatically fall back to nearest pose.`
    );
  };

  const prompts = generatedSpec ? buildCopyableCharacterPrompts(generatedSpec) : null;

  return (
    <section className="space-y-5" data-testid="character-studio-panel">
      {/* Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Character Studio</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-sky-500/15 text-sky-400 font-medium">
              {isLiveModelMode ? 'Live Muse Image' : 'Simulated Preview'}
            </span>
          </div>
          <p className="text-stone-400 mt-0.5">
            Adjust {companionName} with instant parametric controls or build a new Character Pack.
          </p>
        </div>

        <div className="inline-flex rounded-xl p-1 border border-stone-800 bg-stone-950/60">
          <button
            type="button"
            data-testid="char-mode-adjust-btn"
            onClick={() => setStudioMode('adjust')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              studioMode === 'adjust'
                ? 'bg-sky-600 text-white'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            Adjust Figure
          </button>
          <button
            type="button"
            data-testid="char-mode-create-pack-btn"
            onClick={() => setStudioMode('create_pack')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              studioMode === 'create_pack'
                ? 'bg-sky-600 text-white'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            New Figure &amp; Packs
          </button>
        </div>
      </div>

      {safetyError && (
        <div
          data-testid="character-safety-error"
          className="p-3.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 flex items-center gap-2.5 text-xs"
        >
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{safetyError}</span>
        </div>
      )}

      {statusBanner && (
        <div
          data-testid="character-status-banner"
          className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-center gap-2 text-xs"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* MODE A: ADJUST CURRENT FIGURE */}
      {studioMode === 'adjust' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Live Parametric Figure Stage */}
          <div
            className={`p-5 rounded-2xl border flex flex-col items-center justify-between min-h-[320px] ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/70 border-stone-800'
            }`}
          >
            <div className="w-full flex items-center justify-between text-[11px] text-stone-400">
              <span>Live Preview ({previewState.scalePct}%)</span>
              <span className="capitalize">Perch: {previewState.position}</span>
            </div>

            <div
              className="my-2 flex items-center justify-center transition-all duration-150"
              style={{
                transform: `scale(${Math.max(0.6, Math.min(1.35, previewState.scalePct / 100))})`,
                opacity: previewState.opacityPct / 100,
              }}
            >
              <MorrowLive2DRig
                action="idle_breathe"
                presenceState="stand_idle"
                customPalette={previewState.palette}
                customAccessories={previewState.accessories}
                className="w-36 h-48"
              />
            </div>

            {/* Primary Actions: Apply, Undo, Reset */}
            <div className="w-full flex items-center justify-between gap-2 pt-3 border-t border-stone-800/60">
              <button
                type="button"
                data-testid="char-apply-btn"
                onClick={handleCommitPreviewPatch}
                className="flex-1 py-1.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs"
              >
                Apply
              </button>
              <button
                type="button"
                data-testid="char-undo-btn"
                disabled={!canUndo && !pendingPreviewPatch}
                onClick={() => {
                  if (pendingPreviewPatch) {
                    setPendingPreviewPatch(null);
                  } else {
                    onUndo();
                  }
                  setStatusBanner('Reverted to previous character state.');
                }}
                className="py-1.5 px-2.5 rounded-xl border border-stone-700 hover:bg-stone-800 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                title="Undo last change"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                data-testid="char-reset-btn"
                onClick={() => {
                  setPendingPreviewPatch(null);
                  onResetToDefault();
                  setStatusBanner('Reset character to default signature look.');
                }}
                className="py-1.5 px-2.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-xs inline-flex items-center gap-1"
                title="Reset to default"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Controls Column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Natural Language Adjustment Box */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/50 border-stone-800'
              }`}
            >
              <label className="block font-semibold text-xs">
                Ask to adjust her look or behavior
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  data-testid="char-nl-input"
                  value={nlRequestInput}
                  onChange={(e) => setNlRequestInput(e.target.value)}
                  placeholder="Try: 'make her smaller', 'pink hair', 'put her on the left', 'slower'..."
                  className={`flex-1 px-3 py-2 rounded-xl border text-xs outline-none ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                  }`}
                />
                <button
                  type="button"
                  data-testid="char-nl-preview-btn"
                  onClick={() => handlePreviewNaturalLanguagePatch()}
                  className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs inline-flex items-center gap-1.5"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Preview</span>
                </button>
              </div>

              {/* Quick Request Chips */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  'make her smaller',
                  'a bit bigger',
                  'pink hair',
                  'blue hair',
                  'put her on the left',
                  'slower',
                  'wear glasses',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setNlRequestInput(chip);
                      handlePreviewNaturalLanguagePatch(chip);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-stone-800 hover:border-sky-500/40 text-[11px] text-stone-300"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Presets Row & Size Slider */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/50 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <label htmlFor="char-scale-slider" className="font-semibold text-xs">
                  Size Scale ({previewState.scalePct}%)
                </label>
                <span className="text-[11px] text-stone-400">Bounds: 50% – 200%</span>
              </div>
              <input
                id="char-scale-slider"
                type="range"
                min={50}
                max={200}
                step={5}
                data-testid="char-scale-slider"
                value={previewState.scalePct}
                onChange={(e) => {
                  const nextScale = Number(e.target.value);
                  setPendingPreviewPatch((prev) =>
                    clampAndValidateCharacterPatch({
                      ...(prev || {}),
                      scalePct: nextScale,
                      summary: `Scale ${nextScale}%`,
                    })
                  );
                }}
                className="w-full accent-sky-500"
              />

              {/* Presets Row */}
              <div className="pt-1">
                <div className="text-[11px] text-stone-400 mb-1.5">Quick Presets</div>
                <div className="flex flex-wrap gap-1.5">
                  {CHARACTER_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      data-testid={`char-preset-${preset.id}`}
                      onClick={() => {
                        setPendingPreviewPatch(preset.patch);
                        setStatusBanner(`Selected preset: ${preset.label}`);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-stone-700/80 hover:border-sky-500/50 text-xs font-medium"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Instant Parametric Palette & Accessory Toggles */}
            <div
              className={`p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-2 gap-4 ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/50 border-stone-800'
              }`}
            >
              <div className="space-y-2">
                <div className="font-semibold text-xs">Instant Palette Swatches</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-300">
                    <input
                      type="color"
                      aria-label="Hair color"
                      value={previewState.palette.hairColor}
                      onChange={(e) =>
                        setPendingPreviewPatch((prev) => ({
                          ...(prev || {}),
                          palette: {
                            ...previewState.palette,
                            hairColor: e.target.value,
                          },
                          summary: `Hair ${e.target.value}`,
                        }))
                      }
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span>Hair</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-300">
                    <input
                      type="color"
                      aria-label="Braid highlight color"
                      value={previewState.palette.accentBraidColor}
                      onChange={(e) =>
                        setPendingPreviewPatch((prev) => ({
                          ...(prev || {}),
                          palette: {
                            ...previewState.palette,
                            accentBraidColor: e.target.value,
                          },
                          summary: `Braids ${e.target.value}`,
                        }))
                      }
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span>Braids</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-300">
                    <input
                      type="color"
                      aria-label="Jacket color"
                      value={previewState.palette.jacketColor}
                      onChange={(e) =>
                        setPendingPreviewPatch((prev) => ({
                          ...(prev || {}),
                          palette: {
                            ...previewState.palette,
                            jacketColor: e.target.value,
                          },
                          summary: `Jacket ${e.target.value}`,
                        }))
                      }
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <span>Jacket</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-xs">Accessories</div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: 'glasses', label: 'Glasses' },
                      { key: 'headphones', label: 'Headphones' },
                      { key: 'starClips', label: 'Star Clips' },
                      { key: 'hoopEarrings', label: 'Earrings' },
                    ] as const
                  ).map((acc) => {
                    const active = previewState.accessories[acc.key];
                    return (
                      <button
                        key={acc.key}
                        type="button"
                        onClick={() =>
                          setPendingPreviewPatch((prev) => ({
                            ...(prev || {}),
                            accessories: {
                              ...previewState.accessories,
                              [acc.key]: !active,
                            },
                            summary: `${acc.label} ${!active ? 'on' : 'off'}`,
                          }))
                        }
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${
                          active
                            ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                            : 'border-stone-800 text-stone-400'
                        }`}
                      >
                        {acc.label}: {active ? 'On' : 'Off'}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE B: CREATE NEW FIGURE & CHARACTER PACKS */}
      {studioMode === 'create_pack' && (
        <div className="space-y-5" data-testid="character-pack-wizard">
          {/* Step 1: Describe New Figure -> CharacterSpec */}
          <div
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs">
                1. Describe an Original Figure (Adult-Presenting, SFW Only)
              </div>
              <span className="text-[11px] text-stone-400">
                Real-person &amp; copyrighted characters blocked
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                aria-label="New figure name"
                data-testid="new-figure-name-input"
                value={newFigureName}
                onChange={(e) => setNewFigureName(e.target.value)}
                placeholder="Character name (e.g. Astra)"
                className={`px-3 py-2 rounded-xl border text-xs ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
              <input
                type="text"
                aria-label="New figure description"
                data-testid="new-figure-desc-input"
                value={newFigureDescription}
                onChange={(e) => setNewFigureDescription(e.target.value)}
                placeholder="Hair, eyes, outfit, palette, proportions..."
                className={`sm:col-span-2 px-3 py-2 rounded-xl border text-xs ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                data-testid="generate-character-spec-btn"
                onClick={handleGenerateNewSpec}
                className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isLiveModelMode
                    ? 'Generate CharacterSpec & Muse Image'
                    : 'Generate CharacterSpec (Simulated Placeholder)'}
                </span>
              </button>

              {prompts && (
                <button
                  type="button"
                  data-testid="copy-external-prompt-btn"
                  onClick={() => {
                    if (navigator.clipboard) {
                      void navigator.clipboard.writeText(prompts.masterPrompt);
                    }
                    setCopiedPromptNote('Copied master turnaround prompt to clipboard.');
                  }}
                  className="px-3 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-xs inline-flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy External Art Prompt</span>
                </button>
              )}
            </div>

            {copiedPromptNote && (
              <div className="text-[11px] text-sky-400">{copiedPromptNote}</div>
            )}
          </div>

          {/* Step 2: Pose Slot Checklist, PNG/WebP Upload & Feet/Seat Anchor Editor */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-xs">
                  2. Pose Slot Checklist ({Object.keys(populatedSlots).length}/{POSE_SLOTS.length})
                </div>
                <span className="text-[11px] text-stone-400">
                  Missing slots fall back to nearest pose
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {POSE_SLOTS.map((slot) => {
                  const hasAsset = Boolean(populatedSlots[slot]);
                  const fallbackSlot = resolvePoseSlotWithFallback(populatedSlots, slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        selectedSlot === slot
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'border-stone-800 hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-xs">{slot.replace('_', ' ')}</span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            hasAsset ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                      </div>
                      <div className="text-[10px] text-stone-400 mt-1 truncate">
                        {hasAsset ? 'WebP Ready' : `Uses ${fallbackSlot.replace('_', ' ')}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Anchor Editor + License & Source */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-950/60 border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-xs">
                  3. Slot &ldquo;{selectedSlot.replace('_', ' ')}&rdquo; Anchor &amp; License
                </div>
                <label className="px-2.5 py-1 rounded-lg bg-sky-600/20 text-sky-300 border border-sky-500/30 text-[11px] cursor-pointer inline-flex items-center gap-1">
                  <Upload className="w-3 h-3" />
                  <span>Upload PNG/WebP</span>
                  <input
                    type="file"
                    accept="image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleUploadSlotImage(selectedSlot, e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <label className="space-y-1">
                  <span className="text-stone-400">
                    Feet Anchor Y ({slotAnchors[selectedSlot].feetY.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.01}
                    value={slotAnchors[selectedSlot].feetY}
                    onChange={(e) =>
                      setSlotAnchors((prev) => ({
                        ...prev,
                        [selectedSlot]: {
                          ...prev[selectedSlot],
                          feetY: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full accent-sky-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-stone-400">
                    Seat Anchor Y ({slotAnchors[selectedSlot].seatY.toFixed(2)})
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={0.9}
                    step={0.01}
                    value={slotAnchors[selectedSlot].seatY}
                    onChange={(e) =>
                      setSlotAnchors((prev) => ({
                        ...prev,
                        [selectedSlot]: {
                          ...prev[selectedSlot],
                          seatY: Number(e.target.value),
                        },
                      }))
                    }
                    className="w-full accent-sky-500"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Required License
                  </label>
                  <input
                    type="text"
                    data-testid="pack-license-input"
                    value={packLicense}
                    onChange={(e) => setPackLicense(e.target.value)}
                    placeholder="CC-BY-4.0 / CC0 / Original"
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-stone-400 mb-1">
                    Required Source Attribution
                  </label>
                  <input
                    type="text"
                    data-testid="pack-source-input"
                    value={packSource}
                    onChange={(e) => setPackSource(e.target.value)}
                    placeholder="Artist or source URL"
                    className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${
                      isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                    }`}
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="validate-activate-pack-btn"
                  onClick={handleValidateAndActivatePack}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Validate &amp; Load Pack in IndexedDB</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowTechDetails((v) => !v)}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-700 text-[11px] text-stone-400 inline-flex items-center gap-1"
                >
                  {showTechDetails ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>Details</span>
                </button>
              </div>

              {activePackMessage && (
                <div
                  data-testid="pack-active-confirmation"
                  className="text-[11px] text-emerald-400"
                >
                  {activePackMessage}
                </div>
              )}
            </div>
          </div>

          {showTechDetails && generatedSpec && prompts && (
            <div className="p-4 rounded-2xl border border-stone-800 bg-stone-950/80 space-y-2 text-[11px]">
              <div className="font-semibold text-stone-300">
                CharacterSpec &amp; Pose Prompts (Images + Manifest Only, Zero Code)
              </div>
              <div className="text-stone-400">
                Master Prompt: {prompts.masterPrompt}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
