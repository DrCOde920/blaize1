/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Character Studio Package (`src/packages/character/index.ts`)
 * - Part A: Adjust current figure via Zod-validated `CharacterPatch` (scale 50..200%,
 *   opacity, speed, position, palette, accessory toggles) + Undo/Reset stack.
 * - Part B: Create new figure via Zod-validated `CharacterSpec` + Character Packs
 *   (pose slot checklist, nearest-pose fallback, feet/seat anchor editor, license & source
 *   validation, PNG/WebP size caps, WebP conversion & IndexedDB active-only loader).
 * - Safety: Original, adult-presenting, SFW characters only. Blocks real-person likeness
 *   and copyrighted characters.
 */

import { z } from 'zod';

export const CHARACTER_POSITION_VALUES = [
  'left',
  'right',
  'composer-top',
  'panel-top-right',
  'screen-floor',
] as const;

export type CharacterPositionSlot = (typeof CHARACTER_POSITION_VALUES)[number];

export const CharacterPaletteSchema = z.object({
  hairColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1A1922'),
  accentBraidColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#C5B0F2'),
  jacketColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#4E4F58'),
  topColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1A1A21'),
  eyeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#7C5CBF'),
});

export const CharacterAccessoriesSchema = z.object({
  headphones: z.boolean().default(true),
  starClips: z.boolean().default(true),
  hoopEarrings: z.boolean().default(true),
  neckChains: z.boolean().default(true),
  glasses: z.boolean().default(false),
});

export const CharacterPatchSchema = z.object({
  scalePct: z.number().min(50).max(200).optional(),
  opacityPct: z.number().min(20).max(100).optional(),
  speedMultiplier: z.number().min(0.25).max(2.0).optional(),
  position: z.enum(CHARACTER_POSITION_VALUES).optional(),
  palette: CharacterPaletteSchema.partial().optional(),
  accessories: CharacterAccessoriesSchema.partial().optional(),
  summary: z.string().min(1).max(140).optional(),
});

export type CharacterPatch = z.infer<typeof CharacterPatchSchema>;

export interface CharacterParametricState {
  scalePct: number;
  opacityPct: number;
  speedMultiplier: number;
  position: CharacterPositionSlot;
  palette: z.infer<typeof CharacterPaletteSchema>;
  accessories: z.infer<typeof CharacterAccessoriesSchema>;
}

export const DEFAULT_CHARACTER_PARAMETRIC_STATE: CharacterParametricState = {
  scalePct: 100,
  opacityPct: 100,
  speedMultiplier: 1.0,
  position: 'composer-top',
  palette: {
    hairColor: '#1A1922',
    accentBraidColor: '#C5B0F2',
    jacketColor: '#4E4F58',
    topColor: '#1A1A21',
    eyeColor: '#7C5CBF',
  },
  accessories: {
    headphones: true,
    starClips: true,
    hoopEarrings: true,
    neckChains: true,
    glasses: false,
  },
};

export const CHARACTER_SIZE_PRESETS: Array<{
  id: string;
  label: string;
  patch: CharacterPatch;
}> = [
  {
    id: 'preset-compact',
    label: 'Compact (75%)',
    patch: { scalePct: 75, summary: 'Compact 75% scale' },
  },
  {
    id: 'preset-default',
    label: 'Balanced (100%)',
    patch: {
      scalePct: 100,
      opacityPct: 100,
      speedMultiplier: 1.0,
      palette: DEFAULT_CHARACTER_PARAMETRIC_STATE.palette,
      accessories: DEFAULT_CHARACTER_PARAMETRIC_STATE.accessories,
      summary: 'Default signature look',
    },
  },
  {
    id: 'preset-rose-gold',
    label: 'Pink Braids',
    patch: {
      palette: { accentBraidColor: '#F472B6', jacketColor: '#334155' },
      accessories: { glasses: true },
      summary: 'Pink braids with studio glasses',
    },
  },
  {
    id: 'preset-cyber-blue',
    label: 'Cobalt Blue',
    patch: {
      palette: { hairColor: '#1E3A8A', accentBraidColor: '#38BDF8', eyeColor: '#0EA5E9' },
      summary: 'Cobalt blue hair and sky highlights',
    },
  },
  {
    id: 'preset-calm-left',
    label: 'Calm Left Perch',
    patch: {
      position: 'left',
      speedMultiplier: 0.65,
      scalePct: 90,
      summary: 'Calm slower motion on the left',
    },
  },
];

// Safety blocklists: Real-person likeness, copyrighted characters, NSFW/underage
const BLOCKED_COPYRIGHT_CHARACTERS = [
  'hatsune miku',
  'miku',
  'pikachu',
  'mario',
  'luigi',
  'naruto',
  'sasuke',
  'goku',
  'spider-man',
  'spiderman',
  'batman',
  'superman',
  'elsa',
  'mickey mouse',
  'sonic',
  'lara croft',
  '2b nier',
  'asuka langley',
  'rei ayanami',
  'genshin',
  'zelda',
];

const BLOCKED_REAL_PERSON_PATTERNS = [
  /\b(taylor swift|elon musk|beyonce|scarlett johansson|keanu reeves|barack obama|donald trump|zendaya|rihanna|drake|ariana grande)\b/i,
  /\b(real person|celebrity likeness|deepfake|photo of my|actual human photo|politician|living actor)\b/i,
];

const BLOCKED_UNSAFE_OR_MINOR_PATTERNS = [
  /\b(nsfw|nude|naked|explicit|erotic|lingerie|bikini|fetish|sexual|lewd)\b/i,
  /\b(child|kid|toddler|minor|underage|loli|shota|schoolgirl|elementary|preteen)\b/i,
];

export interface CharacterSafetyResult {
  allowed: boolean;
  reason?: string;
  category?: 'copyright' | 'real_person' | 'unsafe_sfw_or_age' | 'ok';
}

export function validateCharacterSafety(text: string): CharacterSafetyResult {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) {
    return { allowed: true, category: 'ok' };
  }

  for (const pat of BLOCKED_UNSAFE_OR_MINOR_PATTERNS) {
    if (pat.test(normalized)) {
      return {
        allowed: false,
        category: 'unsafe_sfw_or_age',
        reason:
          'Blocked for safety: Character Studio only allows original, adult-presenting, SFW characters.',
      };
    }
  }

  for (const pat of BLOCKED_REAL_PERSON_PATTERNS) {
    if (pat.test(normalized)) {
      return {
        allowed: false,
        category: 'real_person',
        reason:
          'Blocked for safety: Real-person likenesses and celebrity/photo recreations are not permitted.',
      };
    }
  }

  for (const name of BLOCKED_COPYRIGHT_CHARACTERS) {
    if (normalized.includes(name)) {
      return {
        allowed: false,
        category: 'copyright',
        reason: `Blocked for safety: "${name}" is an existing copyrighted character. Describe an original character instead.`,
      };
    }
  }

  return { allowed: true, category: 'ok' };
}

/**
 * Clamp and validate a raw CharacterPatch using Zod (`CharacterPatchSchema`).
 * If raw numbers exceed bounds (e.g. 300% scale or 10% scale), clampCharacterPatchBounds
 * enforces 50..200% scale, 20..100% opacity, and 0.25..2.0 speed before schema parse.
 */
export function clampAndValidateCharacterPatch(raw: Partial<CharacterPatch>): CharacterPatch {
  const clamped: Record<string, unknown> = { ...raw };
  if (typeof raw.scalePct === 'number') {
    clamped.scalePct = Math.max(50, Math.min(200, Math.round(raw.scalePct)));
  }
  if (typeof raw.opacityPct === 'number') {
    clamped.opacityPct = Math.max(20, Math.min(100, Math.round(raw.opacityPct)));
  }
  if (typeof raw.speedMultiplier === 'number') {
    clamped.speedMultiplier = Number(
      Math.max(0.25, Math.min(2.0, raw.speedMultiplier)).toFixed(2)
    );
  }
  return CharacterPatchSchema.parse(clamped);
}

/**
 * Natural-language request -> Zod-validated CharacterPatch
 * Examples: 'make her smaller', 'a bit bigger', 'pink hair', 'blue hair',
 * 'put her on the left', 'slower', 'glasses on', 'hide headphones'
 */
export function compileNaturalLanguageCharacterPatch(
  requestText: string,
  currentState: CharacterParametricState = DEFAULT_CHARACTER_PARAMETRIC_STATE
): {
  ok: boolean;
  patch?: CharacterPatch;
  safety: CharacterSafetyResult;
  error?: string;
} {
  const safety = validateCharacterSafety(requestText);
  if (!safety.allowed) {
    return { ok: false, safety, error: safety.reason };
  }

  const lower = requestText.trim().toLowerCase();
  if (!lower) {
    return {
      ok: false,
      safety,
      error: 'Enter an adjustment request (for example: "make her smaller" or "pink hair").',
    };
  }

  const draft: Partial<CharacterPatch> = {
    palette: {},
    accessories: {},
  };
  const notes: string[] = [];

  // Scale adjustments
  const explicitPctMatch = lower.match(/(\d{2,3})\s*%/);
  if (explicitPctMatch) {
    const requestedPct = Number(explicitPctMatch[1]);
    draft.scalePct = Math.max(50, Math.min(200, requestedPct));
    notes.push(`Scale ${draft.scalePct}%`);
  } else if (/\b(tiny|much smaller|way smaller|half size)\b/.test(lower)) {
    draft.scalePct = Math.max(50, currentState.scalePct - 35);
    notes.push(`Scale ${draft.scalePct}%`);
  } else if (/\b(smaller|shrink|little smaller|bit smaller)\b/.test(lower)) {
    draft.scalePct = Math.max(50, currentState.scalePct - 20);
    notes.push(`Scale ${draft.scalePct}%`);
  } else if (/\b(much bigger|huge|giant|double size|way bigger)\b/.test(lower)) {
    draft.scalePct = Math.min(200, currentState.scalePct + 45);
    notes.push(`Scale ${draft.scalePct}%`);
  } else if (/\b(bigger|larger|taller|bit bigger)\b/.test(lower)) {
    draft.scalePct = Math.min(200, currentState.scalePct + 20);
    notes.push(`Scale ${draft.scalePct}%`);
  }

  // Speed adjustments
  if (/\b(slower|calm down|gentle|half speed|slow)\b/.test(lower)) {
    draft.speedMultiplier = Math.max(0.25, Number((currentState.speedMultiplier - 0.35).toFixed(2)));
    notes.push(`Speed ${draft.speedMultiplier}x`);
  } else if (/\b(faster|speed up|energetic|quick)\b/.test(lower)) {
    draft.speedMultiplier = Math.min(2.0, Number((currentState.speedMultiplier + 0.4).toFixed(2)));
    notes.push(`Speed ${draft.speedMultiplier}x`);
  }

  // Opacity adjustments
  if (/\b(transparent|subtle|faint|ghostly|less visible)\b/.test(lower)) {
    draft.opacityPct = 70;
    notes.push('Opacity 70%');
  } else if (/\b(solid|opaque|full opacity)\b/.test(lower)) {
    draft.opacityPct = 100;
    notes.push('Opacity 100%');
  }

  // Position adjustments
  if (/\b(on the left|to the left|move left|left side)\b/.test(lower)) {
    draft.position = 'left';
    notes.push('Position left');
  } else if (/\b(on the right|to the right|move right|right side)\b/.test(lower)) {
    draft.position = 'right';
    notes.push('Position right');
  } else if (/\b(floor|bottom|ground)\b/.test(lower)) {
    draft.position = 'screen-floor';
    notes.push('Position floor');
  } else if (/\b(composer|chat box|center)\b/.test(lower)) {
    draft.position = 'composer-top';
    notes.push('Position chat bar');
  }

  // Palette adjustments (instant parametric rig changes, zero image gen required)
  if (/\b(pink hair|rose hair|pink braids|magenta hair)\b/.test(lower)) {
    draft.palette = {
      ...draft.palette,
      hairColor: '#831843',
      accentBraidColor: '#F472B6',
    };
    notes.push('Pink hair palette');
  } else if (/\b(blue hair|cobalt hair|cyan hair|sapphire hair)\b/.test(lower)) {
    draft.palette = {
      ...draft.palette,
      hairColor: '#1E3A8A',
      accentBraidColor: '#38BDF8',
    };
    notes.push('Blue hair palette');
  } else if (/\b(silver hair|white hair|platinum hair)\b/.test(lower)) {
    draft.palette = {
      ...draft.palette,
      hairColor: '#94A3B8',
      accentBraidColor: '#E2E8F0',
    };
    notes.push('Silver hair palette');
  } else if (/\b(emerald hair|green hair|mint hair)\b/.test(lower)) {
    draft.palette = {
      ...draft.palette,
      hairColor: '#064E3B',
      accentBraidColor: '#34D399',
    };
    notes.push('Emerald hair palette');
  } else if (/\b(gold hair|blonde hair|amber hair)\b/.test(lower)) {
    draft.palette = {
      ...draft.palette,
      hairColor: '#78350F',
      accentBraidColor: '#FBBF24',
    };
    notes.push('Amber gold hair palette');
  }

  if (/\b(red jacket|crimson jacket)\b/.test(lower)) {
    draft.palette = { ...draft.palette, jacketColor: '#991B1B' };
    notes.push('Crimson jacket');
  } else if (/\b(white jacket|cream jacket)\b/.test(lower)) {
    draft.palette = { ...draft.palette, jacketColor: '#E2E8F0' };
    notes.push('Cream jacket');
  }

  // Accessory toggles
  if (/\b(no headphones|remove headphones|hide headphones)\b/.test(lower)) {
    draft.accessories = { ...draft.accessories, headphones: false };
    notes.push('Headphones off');
  } else if (/\b(wear headphones|show headphones|add headphones)\b/.test(lower)) {
    draft.accessories = { ...draft.accessories, headphones: true };
    notes.push('Headphones on');
  }

  if (/\b(add glasses|wear glasses|glasses on|with glasses)\b/.test(lower)) {
    draft.accessories = { ...draft.accessories, glasses: true };
    notes.push('Glasses on');
  } else if (/\b(no glasses|remove glasses|glasses off)\b/.test(lower)) {
    draft.accessories = { ...draft.accessories, glasses: false };
    notes.push('Glasses off');
  }

  if (/\b(no earrings|remove earrings)\b/.test(lower)) {
    draft.accessories = { ...draft.accessories, hoopEarrings: false };
    notes.push('Earrings off');
  }

  if (Object.keys(draft.palette || {}).length === 0) delete draft.palette;
  if (Object.keys(draft.accessories || {}).length === 0) delete draft.accessories;

  if (notes.length === 0) {
    // Fallback gentle adjustment so any valid benign description produces a meaningful patch
    draft.scalePct = currentState.scalePct;
    notes.push(`Adjusted figure: "${requestText.slice(0, 40)}"`);
  }

  draft.summary = notes.join(' · ');
  const validated = clampAndValidateCharacterPatch(draft);
  return { ok: true, patch: validated, safety };
}

export function applyCharacterPatchToState(
  state: CharacterParametricState,
  patch: CharacterPatch
): CharacterParametricState {
  const checked = clampAndValidateCharacterPatch(patch);
  return {
    scalePct: checked.scalePct ?? state.scalePct,
    opacityPct: checked.opacityPct ?? state.opacityPct,
    speedMultiplier: checked.speedMultiplier ?? state.speedMultiplier,
    position: checked.position ?? state.position,
    palette: {
      ...state.palette,
      ...(checked.palette || {}),
    },
    accessories: {
      ...state.accessories,
      ...(checked.accessories || {}),
    },
  };
}

export class CharacterHistoryStack {
  private current: CharacterParametricState;
  private undoStack: CharacterParametricState[] = [];

  constructor(initial: CharacterParametricState = DEFAULT_CHARACTER_PARAMETRIC_STATE) {
    this.current = structuredClone(initial);
  }

  getState(): CharacterParametricState {
    return structuredClone(this.current);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  applyPatch(patch: CharacterPatch): CharacterParametricState {
    const next = applyCharacterPatchToState(this.current, patch);
    this.undoStack.push(structuredClone(this.current));
    if (this.undoStack.length > 25) {
      this.undoStack.shift();
    }
    this.current = next;
    return this.getState();
  }

  undo(): CharacterParametricState {
    const prev = this.undoStack.pop();
    if (prev) {
      this.current = prev;
    }
    return this.getState();
  }

  resetToDefault(): CharacterParametricState {
    this.undoStack.push(structuredClone(this.current));
    this.current = structuredClone(DEFAULT_CHARACTER_PARAMETRIC_STATE);
    return this.getState();
  }
}

// ============================================================================
// PART B: NEW FIGURE (`CharacterSpec`) & CHARACTER PACKS
// ============================================================================

export const CharacterSpecSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  description: z.string().min(3).max(400),
  hair: z.object({
    style: z.string(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  eyes: z.object({
    shape: z.string(),
    irisColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  outfit: z.object({
    top: z.string(),
    outerwear: z.string(),
    bottoms: z.string(),
    footwear: z.string(),
  }),
  palette: CharacterPaletteSchema,
  proportions: z.enum(['vtuber_full', 'chibi', 'portrait_bust']),
  accessories: z.array(z.string()),
  maturityConfirmedAdult: z.literal(true),
  sfwConfirmed: z.literal(true),
});

export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;

export function compileNaturalLanguageCharacterSpec(
  descriptionText: string,
  nameInput = 'Nova',
  options?: {
    imageProvider?: {
      providerId: string;
      isAvailable(): boolean;
    };
  }
): {
  ok: boolean;
  spec?: CharacterSpec;
  generationMode?: 'LIVE_PROVIDER' | 'TEMPLATE_PLACEHOLDER';
  providerStatus?: 'AVAILABLE' | 'NOT_CONFIGURED';
  placeholderBanner?: string | null;
  safety: CharacterSafetyResult;
  error?: string;
} {
  const safety = validateCharacterSafety(`${nameInput} ${descriptionText}`);
  if (!safety.allowed) {
    return { ok: false, safety, error: safety.reason };
  }

  const lower = (descriptionText || '').toLowerCase();
  const isPink = /\b(pink|rose|magenta|sakura|coral)\b/.test(lower);
  const isBlue = /\b(blue|cyan|cobalt|sapphire|navy|azure)\b/.test(lower);
  const isSilver = /\b(silver|white|platinum|frost|lunar)\b/.test(lower);
  const isEmerald = /\b(emerald|green|mint|sage|jade)\b/.test(lower);
  const isGold = /\b(gold|amber|blonde|honey|solar)\b/.test(lower);

  const hairPrimary = isPink
    ? '#831843'
    : isBlue
      ? '#1E3A8A'
      : isSilver
        ? '#64748B'
        : isEmerald
          ? '#064E3B'
          : isGold
            ? '#78350F'
            : '#1A1922';
  const hairAccent = isPink
    ? '#F472B6'
    : isBlue
      ? '#38BDF8'
      : isSilver
        ? '#E2E8F0'
        : isEmerald
          ? '#34D399'
          : isGold
            ? '#FBBF24'
            : '#C5B0F2';

  const irisColor = isBlue
    ? '#0EA5E9'
    : isPink
      ? '#EC4899'
      : isEmerald
        ? '#10B981'
        : isGold
          ? '#F59E0B'
          : '#7C5CBF';

  const jacketColor =
    lower.includes('white jacket') || lower.includes('cream')
      ? '#E2E8F0'
      : lower.includes('crimson jacket') || lower.includes('red jacket')
        ? '#991B1B'
        : '#334155';

  const accessories = ['studio headphones', 'star clips', 'layered silver chain'];
  if (lower.includes('glasses') || lower.includes('spectacles')) {
    accessories.push('silver frame glasses');
  }
  if (lower.includes('boba')) {
    accessories.push('boba tea');
  }

  const spec: CharacterSpec = CharacterSpecSchema.parse({
    id: `spec-${Date.now()}`,
    name: nameInput.trim() || 'Nova',
    description:
      descriptionText.trim() ||
      'Original adult-presenting studio companion in a tailored techwear jacket.',
    hair: {
      style: /\b(short|bob|pixie)\b/.test(lower)
        ? 'Asymmetric bob with braided side locks'
        : /\b(ponytail|updo)\b/.test(lower)
          ? 'High articulated studio ponytail with ribbon accents'
          : 'Long articulated box braids with star clips',
      primaryColor: hairPrimary,
      accentColor: hairAccent,
    },
    eyes: {
      shape: 'Expressive almond studio eyes',
      irisColor,
    },
    outfit: {
      top: lower.includes('hoodie')
        ? 'Technical zip hoodie with subtle geometric piping'
        : 'Fitted ribbed mock-neck sleeveless top',
      outerwear:
        lower.includes('coat') || lower.includes('trench')
          ? 'Long architectural studio trench coat'
          : 'Structured slate studio bomber jacket',
      bottoms: lower.includes('cargo')
        ? 'Tapered technical cargo trousers'
        : 'High-waisted tailored trousers',
      footwear: lower.includes('sneakers')
        ? 'High-top monochrome studio sneakers'
        : 'Clean monochrome studio boots',
    },
    palette: {
      hairColor: hairPrimary,
      accentBraidColor: hairAccent,
      jacketColor,
      topColor: '#1E293B',
      eyeColor: irisColor,
    },
    proportions: lower.includes('chibi')
      ? 'chibi'
      : lower.includes('bust')
        ? 'portrait_bust'
        : 'vtuber_full',
    accessories,
    maturityConfirmedAdult: true,
    sfwConfirmed: true,
  });

  const providerAvailable = Boolean(options?.imageProvider?.isAvailable());
  const generationMode = providerAvailable ? 'LIVE_PROVIDER' : 'TEMPLATE_PLACEHOLDER';
  const providerStatus = providerAvailable ? 'AVAILABLE' : 'NOT_CONFIGURED';
  const placeholderBanner = providerAvailable
    ? null
    : 'TEMPLATE_PLACEHOLDER: Configured image-generation provider is unavailable; using labelled deterministic template assets.';

  return {
    ok: true,
    spec,
    generationMode,
    providerStatus,
    placeholderBanner,
    safety,
  };
}

export const POSE_SLOTS = [
  'stand_idle',
  'sit_idle',
  'run',
  'dance',
  'rest',
  'sleep',
  'think',
  'work',
  'speak',
] as const;

export type PoseSlotId = (typeof POSE_SLOTS)[number];

export const POSE_FALLBACK_GRAPH: Record<PoseSlotId, PoseSlotId[]> = {
  stand_idle: ['sit_idle', 'think', 'work'],
  sit_idle: ['stand_idle', 'rest', 'think'],
  run: ['stand_idle', 'work', 'dance'],
  dance: ['stand_idle', 'run', 'speak'],
  rest: ['sit_idle', 'sleep', 'stand_idle'],
  sleep: ['rest', 'sit_idle', 'stand_idle'],
  think: ['sit_idle', 'stand_idle', 'work'],
  work: ['think', 'sit_idle', 'stand_idle'],
  speak: ['stand_idle', 'sit_idle', 'think'],
};

export interface PoseAnchorPoint {
  feetX: number; // 0..1 normalized horizontal ground anchor
  feetY: number; // 0..1 normalized vertical feet anchor
  seatX: number; // 0..1 normalized horizontal seat anchor
  seatY: number; // 0..1 normalized vertical seat anchor
}

export interface CharacterPackSlotAsset {
  slot: PoseSlotId;
  mimeType: 'image/png' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  webpDataUrl: string;
  anchor: PoseAnchorPoint;
}

export interface CharacterPackManifest {
  id: string;
  name: string;
  author: string;
  license: string;
  sourceUrlOrNote: string;
  createdAtIso: string;
  spec: CharacterSpec;
  slots: Partial<Record<PoseSlotId, CharacterPackSlotAsset>>;
}

export const MAX_PACK_SLOT_BYTES = 2 * 1024 * 1024; // 2 MB per pose image
export const MAX_PACK_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB per pack

export interface PackValidationResult {
  valid: boolean;
  errors: string[];
  resolvedSlotFallbacks: Record<PoseSlotId, PoseSlotId>;
}

/**
 * Resolves a requested pose slot from a Character Pack, falling back to the nearest
 * available pose slot if the requested one is missing.
 */
export function resolvePoseSlotWithFallback(
  slots: Partial<Record<PoseSlotId, unknown>>,
  requested: PoseSlotId
): PoseSlotId {
  if (slots[requested]) return requested;
  const candidates = POSE_FALLBACK_GRAPH[requested] || [];
  for (const fallback of candidates) {
    if (slots[fallback]) return fallback;
  }
  const anyPresent = POSE_SLOTS.find((s) => Boolean(slots[s]));
  return anyPresent || 'stand_idle';
}

/**
 * Validates a Character Pack manifest:
 * - Required license and source fields
 * - Safety check on name/description
 * - Rejects any code/script files or non-PNG/WebP MIME types
 * - Enforces file size and total pack size caps
 * - Validates feet/seat anchors (0..1)
 */
export function validateCharacterPackManifest(
  manifest: CharacterPackManifest,
  attachedFileNames: string[] = []
): PackValidationResult {
  const errors: string[] = [];

  if (!manifest.name || !manifest.name.trim()) {
    errors.push('Character Pack requires a display name.');
  }
  if (!manifest.license || !manifest.license.trim()) {
    errors.push('Character Pack requires an explicit license (e.g., CC-BY-4.0, CC0, Original).');
  }
  if (!manifest.sourceUrlOrNote || !manifest.sourceUrlOrNote.trim()) {
    errors.push('Character Pack requires a source attribution or creation note.');
  }

  const safety = validateCharacterSafety(`${manifest.name} ${manifest.spec?.description || ''}`);
  if (!safety.allowed && safety.reason) {
    errors.push(safety.reason);
  }

  // Never allow code or executable files inside a Character Pack
  for (const fname of attachedFileNames) {
    if (/\.(js|ts|jsx|tsx|mjs|cjs|wasm|sh|bat|ps1|cmd|exe|dll|so|dylib|py|rb|php|html|htm|svg|jar|app)$/i.test(fname)) {
      errors.push(
        `Blocked file "${fname}": Character Packs may only contain transparent PNG or WebP images and a JSON manifest, never code.`
      );
    }
  }

  const presentSlots = Object.keys(manifest.slots || {}) as PoseSlotId[];
  if (presentSlots.length === 0) {
    errors.push('At least one pose image (such as stand_idle or sit_idle) is required.');
  }

  let totalBytes = 0;
  for (const slotKey of presentSlots) {
    const asset = manifest.slots[slotKey];
    if (!asset) continue;
    if (asset.mimeType !== 'image/png' && asset.mimeType !== 'image/webp') {
      errors.push(`Slot "${slotKey}" has unsupported MIME type "${asset.mimeType}". Use PNG or WebP.`);
    }
    if (asset.byteSize > MAX_PACK_SLOT_BYTES) {
      errors.push(`Slot "${slotKey}" exceeds the 2 MB per-image cap.`);
    }
    if (
      typeof asset.webpDataUrl === 'string' &&
      (/<script\b/i.test(asset.webpDataUrl) ||
        /javascript:/i.test(asset.webpDataUrl) ||
        /\beval\s*\(/i.test(asset.webpDataUrl))
    ) {
      errors.push(
        `Slot "${slotKey}" contains prohibited executable or script content; Character Packs must contain data/assets only.`
      );
    }
    if (
      asset.anchor.feetX < 0 ||
      asset.anchor.feetX > 1 ||
      asset.anchor.feetY < 0 ||
      asset.anchor.feetY > 1 ||
      asset.anchor.seatX < 0 ||
      asset.anchor.seatX > 1 ||
      asset.anchor.seatY < 0 ||
      asset.anchor.seatY > 1
    ) {
      errors.push(`Slot "${slotKey}" anchor coordinates must be normalized between 0.0 and 1.0.`);
    }
    totalBytes += asset.byteSize;
  }

  if (totalBytes > MAX_PACK_TOTAL_BYTES) {
    errors.push('Total Character Pack size exceeds the 15 MB limit.');
  }

  const resolvedSlotFallbacks = {} as Record<PoseSlotId, PoseSlotId>;
  for (const slot of POSE_SLOTS) {
    resolvedSlotFallbacks[slot] = resolvePoseSlotWithFallback(manifest.slots || {}, slot);
  }

  return {
    valid: errors.length === 0,
    errors,
    resolvedSlotFallbacks,
  };
}

export function buildCopyableCharacterPrompts(spec: CharacterSpec): {
  masterPrompt: string;
  posePrompts: Record<PoseSlotId, string>;
} {
  const base = `Original adult-presenting SFW 2D studio companion "${spec.name}": ${spec.hair.style} (${spec.hair.primaryColor} with ${spec.hair.accentColor} highlights), ${spec.eyes.shape} (${spec.eyes.irisColor}), wearing ${spec.outfit.top}, ${spec.outfit.outerwear}, and ${spec.outfit.bottoms}. Clean cel-shaded full-body character art on a 100% transparent background, consistent proportions (${spec.proportions}).`;

  const posePrompts: Record<PoseSlotId, string> = {
    stand_idle: `${base} Pose: Relaxed standing idle stance facing front, feet planted at bottom center anchor.`,
    sit_idle: `${base} Pose: Sitting comfortably on a panel ledge with legs dangling naturally, looking forward.`,
    run: `${base} Pose: Light energetic jog across the screen edge, balanced stride.`,
    dance: `${base} Pose: Rhythmic upbeat studio dance pose with headphones glowing.`,
    rest: `${base} Pose: Calm seated rest pose with relaxed shoulders and gentle half-closed eyes.`,
    sleep: `${base} Pose: Peaceful sleeping pose curled on the ledge with closed eyes.`,
    think: `${base} Pose: Thoughtful pose with one hand on chin, looking slightly upward.`,
    work: `${base} Pose: Focused active working pose inspecting a holographic clipboard.`,
    speak: `${base} Pose: Attentive speaking pose with warm smile and expressive hand gesture.`,
  };

  return {
    masterPrompt: `${base} Full turnaround reference sheet (front, 3/4, back) + 4 clean facial expressions.`,
    posePrompts,
  };
}

export * from './figure_factory';

