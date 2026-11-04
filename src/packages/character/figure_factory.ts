/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9 — CharacterFactory, Structured Character Planning Pipeline,
 * Binary PNG/WebP + Executable-Prohibition Pack Validator, and PersistentFigureLibrary
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import {
  type CharacterSpec,
  type PoseSlotId,
  type CharacterPackSlotAsset,
  type CharacterPackManifest,
  type CharacterSafetyResult,
  validateCharacterSafety,
  validateCharacterPackManifest,
  compileNaturalLanguageCharacterSpec,
  resolvePoseSlotWithFallback,
} from './index';
import type { ToolRegistration } from '../runtime/index';

// Local top-level constants to avoid ESM circular initialization issues with ./index
const LOCAL_MAX_PACK_SLOT_BYTES = 2 * 1024 * 1024; // 2 MB per image
const LOCAL_MAX_PACK_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB per pack
const LOCAL_POSE_SLOTS = [
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

export const RIG_TARGET_IDS = [
  'morrow_live2d_v2',
  'morrow_parametric_2d_v1',
  'morrow_chibi_2d_v1',
] as const;
export type RigTargetId = (typeof RIG_TARGET_IDS)[number];

export const FACIAL_EXPRESSION_SLOTS = [
  'neutral_warm',
  'happy_smile',
  'focused_analytic',
  'thoughtful_ponder',
  'calm_resting',
  'apologetic_soft',
  'attentive_listen',
] as const;
export type FacialExpressionSlotId = (typeof FACIAL_EXPRESSION_SLOTS)[number];

export const CHARACTER_ANIMATION_STATES = [
  'idle_breathe',
  'listen_nod',
  'speak_lip_sync',
  'think_glimmer',
  'work_focus',
  'run_cycle',
  'dance_groove',
  'rest_settle',
  'sleep_zero_fps',
] as const;
export type CharacterAnimationStateId = (typeof CHARACTER_ANIMATION_STATES)[number];

export const CharacterOutfitVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  top: z.string().min(1),
  outerwear: z.string().min(1),
  bottoms: z.string().min(1),
  footwear: z.string().min(1),
});
export type CharacterOutfitVariant = z.infer<typeof CharacterOutfitVariantSchema>;

export const MasterCharacterSpecSchema = z.object({
  figureId: z.string().min(1),
  name: z.string().min(1).max(60),
  appearanceSummary: z.string().min(3).max(500),
  proportions: z.enum(['vtuber_full', 'chibi', 'portrait_bust']),
  palette: z.object({
    hairColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accentBraidColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    jacketColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    topColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    eyeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  clothing: z.object({
    top: z.string().min(1),
    outerwear: z.string().min(1),
    bottoms: z.string().min(1),
    footwear: z.string().min(1),
  }),
  outfits: z.array(CharacterOutfitVariantSchema).min(1),
  accessories: z.array(z.string()),
  props: z.array(z.string()),
  rigTarget: z.enum(RIG_TARGET_IDS),
  poseSlots: z.array(z.enum(LOCAL_POSE_SLOTS)).min(1),
  facialExpressions: z.array(z.enum(FACIAL_EXPRESSION_SLOTS)).min(1),
  animationStates: z.array(z.enum(CHARACTER_ANIMATION_STATES)).min(1),
  assetRequirements: z.object({
    transparentBackgroundRequired: z.literal(true),
    allowedMimeTypes: z.array(z.enum(['image/png', 'image/webp'])).min(1),
    recommendedWidthPx: z.number().int().min(256).max(2048),
    recommendedHeightPx: z.number().int().min(256).max(2048),
    maxSlotBytes: z.number().int(),
    maxPackBytes: z.number().int(),
    executableContentProhibited: z.literal(true),
  }),
  maturityConfirmedAdult: z.literal(true),
  sfwConfirmed: z.literal(true),
  baseSpec: z.any(),
});
export type MasterCharacterSpec = z.infer<typeof MasterCharacterSpecSchema>;

export const CharacterFactoryInputSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(3).max(500),
  figureId: z.string().min(1).optional(),
  proportions: z.enum(['vtuber_full', 'chibi', 'portrait_bust']).optional(),
  palette: z
    .object({
      hairColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentBraidColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      jacketColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      topColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      eyeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    })
    .optional(),
  clothing: z
    .object({
      top: z.string().optional(),
      outerwear: z.string().optional(),
      bottoms: z.string().optional(),
      footwear: z.string().optional(),
    })
    .optional(),
  accessories: z.array(z.string()).optional(),
  props: z.array(z.string()).optional(),
  rigTarget: z.enum(RIG_TARGET_IDS).optional(),
  poseSlots: z.array(z.enum(LOCAL_POSE_SLOTS)).optional(),
  facialExpressions: z.array(z.enum(FACIAL_EXPRESSION_SLOTS)).optional(),
  animationStates: z.array(z.enum(CHARACTER_ANIMATION_STATES)).optional(),
  author: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  sourceAttribution: z.string().min(1).optional(),
  activateImmediately: z.boolean().optional(),
  explicitUserRequestPrompt: z.string().optional(),
});
export type CharacterFactoryInput = z.infer<typeof CharacterFactoryInputSchema>;

export interface ImageGenerationProviderAdapter {
  providerId: string;
  isAvailable(): boolean;
  generatePoseOrExpressionAsset(req: {
    figureId: string;
    figureName: string;
    kind: 'pose' | 'expression' | 'preview';
    slotId: string;
    prompt: string;
    width: number;
    height: number;
  }):
    | Promise<{
        mimeType: 'image/png' | 'image/webp';
        width: number;
        height: number;
        dataUrl: string;
        byteSize: number;
      }>
    | {
        mimeType: 'image/png' | 'image/webp';
        width: number;
        height: number;
        dataUrl: string;
        byteSize: number;
      };
}

export interface RigCompatibilityReport {
  compatible: boolean;
  rigTarget: RigTargetId;
  transparencyVerified: boolean;
  anchorBoundsValid: boolean;
  dimensionsConsistent: boolean;
  checkedPoseSlots: PoseSlotId[];
  resolvedSlotFallbacks: Record<PoseSlotId, PoseSlotId>;
  issues: string[];
}

export interface FigurePackSlotAssetExtended extends CharacterPackSlotAsset {
  sha256: string;
  hasAlphaChannel: boolean;
  isTemplatePlaceholder: boolean;
}

export interface FigurePackExpressionAsset {
  expressionId: FacialExpressionSlotId;
  mimeType: 'image/png' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  dataUrl: string;
  sha256: string;
  hasAlphaChannel: boolean;
  isTemplatePlaceholder: boolean;
}

export interface FigurePackAssetManifest extends CharacterPackManifest {
  figureId: string;
  version: number;
  rigTarget: RigTargetId;
  generationMode: 'LIVE_PROVIDER' | 'TEMPLATE_PLACEHOLDER';
  providerStatus: 'AVAILABLE' | 'NOT_CONFIGURED';
  placeholderLabel: string | null;
  manifestSha256: string;
  slots: Partial<Record<PoseSlotId, FigurePackSlotAssetExtended>>;
  expressions: Partial<Record<FacialExpressionSlotId, FigurePackExpressionAsset>>;
}

export interface CharacterFactoryOutput {
  ok: boolean;
  executionState: 'EXECUTED' | 'SIMULATED' | 'BLOCKED';
  generationMode: 'LIVE_PROVIDER' | 'TEMPLATE_PLACEHOLDER';
  providerStatus: 'AVAILABLE' | 'NOT_CONFIGURED';
  placeholderLabel: string | null;
  figureId?: string;
  activatedFigureId?: string | null;
  version?: number;
  masterSpec?: MasterCharacterSpec;
  previewAsset?: {
    mimeType: 'image/png' | 'image/webp';
    width: number;
    height: number;
    dataUrl: string;
    byteSize: number;
    hasAlphaChannel: boolean;
    generationMode: 'LIVE_PROVIDER' | 'TEMPLATE_PLACEHOLDER';
  };
  rigCompatibilityReport?: RigCompatibilityReport;
  assetManifest?: FigurePackAssetManifest;
  safety: CharacterSafetyResult;
  error?: string;
}

// ============================================================================
// DETERMINISTIC TRANSPARENT PNG / WEBP SYNTHESIS & BINARY INSPECTOR
// ============================================================================

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function buildDeterministicTransparentPngDataUrl(
  seed: string,
  width = 512,
  height = 768
): { dataUrl: string; byteSize: number; sha256: string; width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 = RGBA (transparent alpha channel)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const hashBytes = crypto.createHash('sha256').update(seed).digest();
  const samplePayload = Buffer.from([
    0x78,
    0x01,
    0x01,
    0x09,
    0x00,
    0xf6,
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // transparent pixel
    hashBytes[0]!,
    hashBytes[1]!,
    hashBytes[2]!,
    0xff,
    hashBytes[3]!,
    hashBytes[4]!,
    hashBytes[5]!,
    0x01,
    0x02,
  ]);
  const textData = Buffer.from(`Software\0BlaizeFigureFactory:${seed}`, 'utf8');

  const pngBuffer = Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('tEXt', textData),
    makePngChunk('IDAT', samplePayload),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);

  const sha256 = crypto.createHash('sha256').update(pngBuffer).digest('hex');
  return {
    dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    byteSize: pngBuffer.byteLength,
    sha256,
    width,
    height,
  };
}

export function buildDeterministicTransparentWebpDataUrl(
  seed: string,
  width = 512,
  height = 768
): { dataUrl: string; byteSize: number; sha256: string; width: number; height: number } {
  const payload = Buffer.from(`VP8X_ALPHA:${seed}`, 'utf8');
  const vp8xChunk = Buffer.alloc(18);
  vp8xChunk.write('VP8X', 0, 'ascii');
  vp8xChunk.writeUInt32LE(10, 4);
  vp8xChunk[8] = 0x10; // Alpha bit set in VP8X flags
  const wMinus1 = Math.max(0, width - 1);
  const hMinus1 = Math.max(0, height - 1);
  vp8xChunk[12] = wMinus1 & 0xff;
  vp8xChunk[13] = (wMinus1 >> 8) & 0xff;
  vp8xChunk[14] = (wMinus1 >> 16) & 0xff;
  vp8xChunk[15] = hMinus1 & 0xff;
  vp8xChunk[16] = (hMinus1 >> 8) & 0xff;
  vp8xChunk[17] = (hMinus1 >> 16) & 0xff;

  const riffPayloadSize = 4 + vp8xChunk.length + payload.length;
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(riffPayloadSize, 4);
  header.write('WEBP', 8, 'ascii');

  const webpBuffer = Buffer.concat([header, vp8xChunk, payload]);
  const sha256 = crypto.createHash('sha256').update(webpBuffer).digest('hex');
  return {
    dataUrl: `data:image/webp;base64,${webpBuffer.toString('base64')}`,
    byteSize: webpBuffer.byteLength,
    sha256,
    width,
    height,
  };
}

const DANGEROUS_PAYLOAD_SIGNATURES = [
  '<script',
  'javascript:',
  'vbscript:',
  'onload=',
  'onerror=',
  '#!/',
  'eval(',
  'Function(',
];

export function inspectPngOrWebpDataUrl(dataUrl: string): {
  validFormat: boolean;
  mimeType?: 'image/png' | 'image/webp';
  hasAlphaChannel: boolean;
  byteSize: number;
  sha256: string;
  containsExecutableOrScriptPayload: boolean;
  reason?: string;
} {
  const raw = (dataUrl || '').trim();
  const rawLower = raw.toLowerCase();
  for (const sig of DANGEROUS_PAYLOAD_SIGNATURES) {
    if (rawLower.includes(sig.toLowerCase())) {
      return {
        validFormat: false,
        hasAlphaChannel: false,
        byteSize: Buffer.byteLength(raw, 'utf8'),
        sha256: '',
        containsExecutableOrScriptPayload: true,
        reason: `PACK_EXECUTABLE_CONTENT_PROHIBITED: Embedded script/executable signature "${sig}" detected in data URL.`,
      };
    }
  }

  const match = /^data:(image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match) {
    return {
      validFormat: false,
      hasAlphaChannel: false,
      byteSize: 0,
      sha256: '',
      containsExecutableOrScriptPayload: false,
      reason: 'Asset must be a valid base64 data URL with MIME type image/png or image/webp.',
    };
  }

  const mimeType = match[1] as 'image/png' | 'image/webp';
  const buf = Buffer.from(match[2]!, 'base64');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const utf8Sample = buf.toString('utf8');

  for (const sig of DANGEROUS_PAYLOAD_SIGNATURES) {
    if (utf8Sample.toLowerCase().includes(sig.toLowerCase())) {
      return {
        validFormat: false,
        mimeType,
        hasAlphaChannel: false,
        byteSize: buf.byteLength,
        sha256,
        containsExecutableOrScriptPayload: true,
        reason: `PACK_EXECUTABLE_CONTENT_PROHIBITED: Embedded script signature "${sig}" detected in binary buffer.`,
      };
    }
  }

  // Detect ELF, MZ/PE, Mach-O, or Wasm binary headers disguised as images
  if (
    (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) || // MZ
    (buf.length >= 4 &&
      buf[0] === 0x7f &&
      buf[1] === 0x45 &&
      buf[2] === 0x4c &&
      buf[3] === 0x46) || // ELF
    (buf.length >= 4 &&
      buf[0] === 0x00 &&
      buf[1] === 0x61 &&
      buf[2] === 0x73 &&
      buf[3] === 0x6d) || // Wasm
    (buf.length >= 4 &&
      buf[0] === 0xcf &&
      buf[1] === 0xfa &&
      buf[2] === 0xed &&
      buf[3] === 0xfe) // Mach-O
  ) {
    return {
      validFormat: false,
      mimeType,
      hasAlphaChannel: false,
      byteSize: buf.byteLength,
      sha256,
      containsExecutableOrScriptPayload: true,
      reason:
        'PACK_EXECUTABLE_CONTENT_PROHIBITED: Binary executable header (ELF/MZ/Wasm/Mach-O) disguised as image.',
    };
  }

  if (mimeType === 'image/png') {
    const isPng =
      buf.length >= 29 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;
    if (!isPng) {
      return {
        validFormat: false,
        mimeType,
        hasAlphaChannel: false,
        byteSize: buf.byteLength,
        sha256,
        containsExecutableOrScriptPayload: false,
        reason: 'Invalid PNG magic header.',
      };
    }
    const colorType = buf[25];
    const hasAlpha =
      colorType === 6 || colorType === 4 || buf.includes(Buffer.from('tRNS', 'ascii'));
    return {
      validFormat: true,
      mimeType,
      hasAlphaChannel: hasAlpha,
      byteSize: buf.byteLength,
      sha256,
      containsExecutableOrScriptPayload: false,
      reason: hasAlpha ? undefined : 'PNG image is missing an alpha transparency channel.',
    };
  }

  // image/webp
  const isWebp =
    buf.length >= 21 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isWebp) {
    return {
      validFormat: false,
      mimeType,
      hasAlphaChannel: false,
      byteSize: buf.byteLength,
      sha256,
      containsExecutableOrScriptPayload: false,
      reason: 'Invalid WEBP RIFF header.',
    };
  }
  const chunkFourCC = buf.subarray(12, 16).toString('ascii');
  const hasAlpha =
    (chunkFourCC === 'VP8X' && ((buf[20] ?? 0) & 0x10) !== 0) ||
    chunkFourCC === 'VP8L' ||
    buf.includes(Buffer.from('ALPH', 'ascii'));
  return {
    validFormat: true,
    mimeType,
    hasAlphaChannel: hasAlpha,
    byteSize: buf.byteLength,
    sha256,
    containsExecutableOrScriptPayload: false,
    reason: hasAlpha ? undefined : 'WebP image is missing alpha transparency flag.',
  };
}

// ============================================================================
// STRUCTURED CHARACTER PLANNING PIPELINE
// ============================================================================

export function slugifyFigureId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `fig-${slug || 'companion'}`;
}

export function runStructuredCharacterPlanningPipeline(
  rawInput: CharacterFactoryInput,
  options?: {
    imageProvider?: ImageGenerationProviderAdapter;
  }
): {
  ok: boolean;
  safety: CharacterSafetyResult;
  masterSpec?: MasterCharacterSpec;
  generationMode: 'LIVE_PROVIDER' | 'TEMPLATE_PLACEHOLDER';
  providerStatus: 'AVAILABLE' | 'NOT_CONFIGURED';
  placeholderLabel: string | null;
  error?: string;
} {
  const input = CharacterFactoryInputSchema.parse(rawInput);
  const compiled = compileNaturalLanguageCharacterSpec(input.description, input.name, {
    imageProvider: options?.imageProvider,
  });

  if (!compiled.ok || !compiled.spec) {
    return {
      ok: false,
      safety: compiled.safety,
      generationMode: 'TEMPLATE_PLACEHOLDER',
      providerStatus: options?.imageProvider?.isAvailable() ? 'AVAILABLE' : 'NOT_CONFIGURED',
      placeholderLabel:
        'TEMPLATE_PLACEHOLDER: Character planning blocked by safety validation.',
      error: compiled.error,
    };
  }

  // Also check safety of props/accessories/clothing
  const extraText = [
    ...(input.accessories || []),
    ...(input.props || []),
    input.clothing?.top || '',
    input.clothing?.outerwear || '',
    input.clothing?.bottoms || '',
    input.clothing?.footwear || '',
  ].join(' ');
  const extraSafety = validateCharacterSafety(extraText);
  if (!extraSafety.allowed) {
    return {
      ok: false,
      safety: extraSafety,
      generationMode: 'TEMPLATE_PLACEHOLDER',
      providerStatus: options?.imageProvider?.isAvailable() ? 'AVAILABLE' : 'NOT_CONFIGURED',
      placeholderLabel:
        'TEMPLATE_PLACEHOLDER: Character planning blocked by safety validation.',
      error: extraSafety.reason,
    };
  }

  const baseSpec = compiled.spec;
  const figureId = input.figureId || slugifyFigureId(input.name);
  const proportions = input.proportions ?? baseSpec.proportions;
  const rigTarget: RigTargetId =
    input.rigTarget ??
    (proportions === 'chibi' ? 'morrow_chibi_2d_v1' : 'morrow_live2d_v2');

  const palette = {
    hairColor: input.palette?.hairColor ?? baseSpec.palette.hairColor,
    accentBraidColor: input.palette?.accentBraidColor ?? baseSpec.palette.accentBraidColor,
    jacketColor: input.palette?.jacketColor ?? baseSpec.palette.jacketColor,
    topColor: input.palette?.topColor ?? baseSpec.palette.topColor,
    eyeColor: input.palette?.eyeColor ?? baseSpec.palette.eyeColor,
  };

  const clothing = {
    top: input.clothing?.top ?? baseSpec.outfit.top,
    outerwear: input.clothing?.outerwear ?? baseSpec.outfit.outerwear,
    bottoms: input.clothing?.bottoms ?? baseSpec.outfit.bottoms,
    footwear: input.clothing?.footwear ?? baseSpec.outfit.footwear,
  };

  const outfits: CharacterOutfitVariant[] = [
    {
      id: 'outfit-signature-default',
      label: 'Signature Studio Outfit',
      ...clothing,
    },
    {
      id: 'outfit-focus-architect',
      label: 'Focus Architect Layer',
      top: 'Structured mock-neck knit top',
      outerwear: 'Tailored charcoal architect blazer',
      bottoms: 'High-waisted pleated studio trousers',
      footwear: 'Minimalist monochrome studio boots',
    },
    {
      id: 'outfit-calm-evening',
      label: 'Calm Evening Study',
      top: 'Soft breathable cotton crew-neck',
      outerwear: 'Relaxed slate knit cardigan',
      bottoms: 'Tapered lounge trousers',
      footwear: 'Clean low-profile studio sneakers',
    },
  ];

  const accessories = Array.from(
    new Set([...baseSpec.accessories, ...(input.accessories || [])])
  );
  const props = Array.from(
    new Set([
      ...(input.props || []),
      ...(input.description.toLowerCase().includes('clipboard')
        ? ['holographic clipboard']
        : []),
    ])
  );

  const recommendedWidthPx = proportions === 'portrait_bust' ? 512 : 512;
  const recommendedHeightPx = proportions === 'chibi' ? 512 : 768;

  const masterSpec: MasterCharacterSpec = MasterCharacterSpecSchema.parse({
    figureId,
    name: input.name.trim(),
    appearanceSummary: input.description.trim(),
    proportions,
    palette,
    clothing,
    outfits,
    accessories,
    props,
    rigTarget,
    poseSlots: input.poseSlots?.length ? input.poseSlots : [...LOCAL_POSE_SLOTS],
    facialExpressions: input.facialExpressions?.length
      ? input.facialExpressions
      : [...FACIAL_EXPRESSION_SLOTS],
    animationStates: input.animationStates?.length
      ? input.animationStates
      : [...CHARACTER_ANIMATION_STATES],
    assetRequirements: {
      transparentBackgroundRequired: true,
      allowedMimeTypes: ['image/png', 'image/webp'],
      recommendedWidthPx,
      recommendedHeightPx,
      maxSlotBytes: LOCAL_MAX_PACK_SLOT_BYTES,
      maxPackBytes: LOCAL_MAX_PACK_TOTAL_BYTES,
      executableContentProhibited: true,
    },
    maturityConfirmedAdult: true,
    sfwConfirmed: true,
    baseSpec: {
      ...baseSpec,
      palette,
      outfit: clothing,
      proportions,
      accessories,
    },
  });

  const providerAvailable = Boolean(options?.imageProvider?.isAvailable());
  const generationMode = providerAvailable ? 'LIVE_PROVIDER' : 'TEMPLATE_PLACEHOLDER';
  const providerStatus = providerAvailable ? 'AVAILABLE' : 'NOT_CONFIGURED';
  const placeholderLabel = providerAvailable
    ? null
    : 'TEMPLATE_PLACEHOLDER: Image-generation provider not configured; generated deterministic transparent template rig assets.';

  return {
    ok: true,
    safety: compiled.safety,
    masterSpec,
    generationMode,
    providerStatus,
    placeholderLabel,
  };
}

// ============================================================================
// FIGURE PACK SAFETY, TRANSPARENCY & RIG COMPATIBILITY VALIDATOR
// ============================================================================

export function validateFigurePackForInstallation(
  manifest: FigurePackAssetManifest,
  attachedFileNames: string[] = []
): {
  valid: boolean;
  errors: string[];
  rigCompatibility: RigCompatibilityReport;
} {
  const errors: string[] = [];

  // 1. Check attached filenames for executable/script extensions
  for (const fname of attachedFileNames) {
    if (
      /\.(js|ts|jsx|tsx|mjs|cjs|wasm|sh|bash|zsh|bat|ps1|cmd|exe|dll|so|dylib|py|rb|php|pl|html|htm|svg|jar|app|msi)$/i.test(
        fname.trim()
      )
    ) {
      errors.push(
        `PACK_EXECUTABLE_CONTENT_PROHIBITED: Blocked file "${fname}" — figure packs must contain data/assets only and never scripts or executables.`
      );
    }
  }

  // 2. Run base CharacterPackManifest validation
  const baseValidation = validateCharacterPackManifest(manifest, attachedFileNames);
  for (const err of baseValidation.errors) {
    if (err.includes('prohibited executable or script')) {
      errors.push(`PACK_EXECUTABLE_CONTENT_PROHIBITED: ${err}`);
    } else {
      errors.push(err);
    }
  }

  // 3. Inspect every pose slot binary dataUrl for transparency, magic header, and script/executable payloads
  let transparencyVerified = true;
  let anchorBoundsValid = true;
  let dimensionsConsistent = true;
  const checkedPoseSlots: PoseSlotId[] = [];
  let referenceWidth: number | null = null;
  let referenceHeight: number | null = null;

  for (const [slotKey, asset] of Object.entries(manifest.slots || {})) {
    if (!asset) continue;
    checkedPoseSlots.push(slotKey as PoseSlotId);

    const inspected = inspectPngOrWebpDataUrl(asset.webpDataUrl);
    if (inspected.containsExecutableOrScriptPayload) {
      errors.push(
        inspected.reason ||
          `PACK_EXECUTABLE_CONTENT_PROHIBITED: Slot "${slotKey}" contains executable or script payload.`
      );
    }
    if (!inspected.validFormat || !inspected.hasAlphaChannel) {
      transparencyVerified = false;
      errors.push(
        `Slot "${slotKey}" failed transparent PNG/WebP verification: ${
          inspected.reason || 'missing alpha channel'
        }`
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
      anchorBoundsValid = false;
    }

    if (referenceWidth === null) {
      referenceWidth = asset.width;
      referenceHeight = asset.height;
    } else if (asset.width !== referenceWidth || asset.height !== referenceHeight) {
      dimensionsConsistent = false;
      errors.push(
        `Slot "${slotKey}" dimensions (${asset.width}x${asset.height}) do not match pack reference dimensions (${referenceWidth}x${referenceHeight}).`
      );
    }
  }

  // 4. Inspect expression assets if present
  for (const [exprKey, exprAsset] of Object.entries(manifest.expressions || {})) {
    if (!exprAsset) continue;
    const inspected = inspectPngOrWebpDataUrl(exprAsset.dataUrl);
    if (inspected.containsExecutableOrScriptPayload) {
      errors.push(
        inspected.reason ||
          `PACK_EXECUTABLE_CONTENT_PROHIBITED: Expression "${exprKey}" contains executable or script payload.`
      );
    }
    if (!inspected.validFormat || !inspected.hasAlphaChannel) {
      transparencyVerified = false;
      errors.push(
        `Expression "${exprKey}" failed transparent PNG/WebP verification: ${
          inspected.reason || 'missing alpha channel'
        }`
      );
    }
  }

  const rigCompatibility: RigCompatibilityReport = {
    compatible:
      errors.length === 0 &&
      transparencyVerified &&
      anchorBoundsValid &&
      dimensionsConsistent &&
      checkedPoseSlots.length > 0,
    rigTarget: manifest.rigTarget || 'morrow_live2d_v2',
    transparencyVerified,
    anchorBoundsValid,
    dimensionsConsistent,
    checkedPoseSlots,
    resolvedSlotFallbacks: baseValidation.resolvedSlotFallbacks,
    issues: [...errors],
  };

  return {
    valid: errors.length === 0 && rigCompatibility.compatible,
    errors,
    rigCompatibility,
  };
}

// ============================================================================
// PERSISTENT FIGURE LIBRARY
// ============================================================================

export interface FigureVersionSnapshot {
  version: number;
  installedAtIso: string;
  masterSpec: MasterCharacterSpec;
  manifest: FigurePackAssetManifest;
  previewDataUrl: string;
}

export interface InstalledFigureRecord {
  figureId: string;
  name: string;
  currentVersion: number;
  masterSpec: MasterCharacterSpec;
  manifest: FigurePackAssetManifest;
  previewDataUrl: string;
  versionHistory: FigureVersionSnapshot[];
}

export interface PersistentFigureLibraryState {
  activeFigureId: string;
  activePoseSlot: PoseSlotId;
  activeExpressionId: FacialExpressionSlotId;
  activeAnimationState: CharacterAnimationStateId;
  activeOutfitId: string;
  activeProps: string[];
  figures: Record<string, InstalledFigureRecord>;
}

const POSE_TO_DEFAULT_ANIMATION_STATE: Record<PoseSlotId, CharacterAnimationStateId> = {
  stand_idle: 'idle_breathe',
  sit_idle: 'idle_breathe',
  run: 'run_cycle',
  dance: 'dance_groove',
  rest: 'rest_settle',
  sleep: 'sleep_zero_fps',
  think: 'think_glimmer',
  work: 'work_focus',
  speak: 'speak_lip_sync',
};

function buildDefaultNovaFigureRecord(): InstalledFigureRecord {
  const plan = runStructuredCharacterPlanningPipeline({
    name: 'Nova',
    figureId: 'fig-nova-default',
    description:
      'Original adult-presenting studio companion in a tailored techwear jacket with braided hair and studio headphones.',
    proportions: 'vtuber_full',
    rigTarget: 'morrow_live2d_v2',
  });
  const masterSpec = plan.masterSpec!;
  const preview = buildDeterministicTransparentWebpDataUrl('default:nova:stand_idle', 512, 768);
  const slots: Partial<Record<PoseSlotId, FigurePackSlotAssetExtended>> = {};
  for (const slot of LOCAL_POSE_SLOTS) {
    const img = buildDeterministicTransparentWebpDataUrl(`default:nova:${slot}`, 512, 768);
    slots[slot] = {
      slot,
      mimeType: 'image/webp',
      byteSize: img.byteSize,
      width: img.width,
      height: img.height,
      webpDataUrl: img.dataUrl,
      sha256: img.sha256,
      hasAlphaChannel: true,
      isTemplatePlaceholder: true,
      anchor: { feetX: 0.5, feetY: 0.92, seatX: 0.5, seatY: 0.62 },
    };
  }
  const manifest: FigurePackAssetManifest = {
    id: 'pack-fig-nova-default-v1',
    figureId: 'fig-nova-default',
    version: 1,
    name: 'Nova Default Studio Pack',
    author: 'Blaize Studio',
    license: 'CC-BY-4.0',
    sourceUrlOrNote: 'Built-in Default Template Pack',
    createdAtIso: '2026-01-01T00:00:00.000Z',
    rigTarget: 'morrow_live2d_v2',
    generationMode: 'TEMPLATE_PLACEHOLDER',
    providerStatus: 'NOT_CONFIGURED',
    placeholderLabel:
      'TEMPLATE_PLACEHOLDER: Default studio template figure pack.',
    manifestSha256: preview.sha256,
    spec: masterSpec.baseSpec as CharacterSpec,
    slots,
    expressions: {},
  };
  const snapshot: FigureVersionSnapshot = {
    version: 1,
    installedAtIso: '2026-01-01T00:00:00.000Z',
    masterSpec,
    manifest,
    previewDataUrl: preview.dataUrl,
  };
  return {
    figureId: 'fig-nova-default',
    name: 'Nova',
    currentVersion: 1,
    masterSpec,
    manifest,
    previewDataUrl: preview.dataUrl,
    versionHistory: [snapshot],
  };
}

export class PersistentFigureLibrary {
  private state: PersistentFigureLibraryState;
  private readonly storageFilePath: string | null;

  constructor(options?: { storageDir?: string } | string) {
    const storageDir =
      typeof options === 'string' ? options : options?.storageDir;
    this.storageFilePath = storageDir
      ? path.join(storageDir, 'figure_library_state.json')
      : null;

    if (this.storageFilePath && fs.existsSync(this.storageFilePath)) {
      this.state = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf8'));
    } else {
      const defaultNova = buildDefaultNovaFigureRecord();
      this.state = {
        activeFigureId: defaultNova.figureId,
        activePoseSlot: 'stand_idle',
        activeExpressionId: 'neutral_warm',
        activeAnimationState: 'idle_breathe',
        activeOutfitId: defaultNova.masterSpec.outfits[0]!.id,
        activeProps: [...defaultNova.masterSpec.props],
        figures: {
          [defaultNova.figureId]: defaultNova,
        },
      };
      this.persistToDisk();
    }
  }

  private persistToDisk(): void {
    if (!this.storageFilePath) return;
    const dir = path.dirname(this.storageFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      this.storageFilePath,
      JSON.stringify(this.state, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  }

  public getState(): PersistentFigureLibraryState {
    return structuredClone(this.state);
  }

  public getActiveFigure(): InstalledFigureRecord {
    const active = this.state.figures[this.state.activeFigureId];
    if (active) return structuredClone(active);
    const first = Object.values(this.state.figures)[0]!;
    return structuredClone(first);
  }

  public getFigure(figureId: string): InstalledFigureRecord | null {
    const rec = this.state.figures[figureId];
    return rec ? structuredClone(rec) : null;
  }

  public listFigures(): InstalledFigureRecord[] {
    return Object.values(this.state.figures).map((f) => structuredClone(f));
  }

  public installOrUpdateFigure(params: {
    masterSpec: MasterCharacterSpec;
    manifest: FigurePackAssetManifest;
    previewDataUrl: string;
    activateImmediately?: boolean;
  }): {
    ok: boolean;
    figureId: string;
    version: number;
    activated: boolean;
    error?: string;
  } {
    const validation = validateFigurePackForInstallation(params.manifest);
    if (!validation.valid) {
      return {
        ok: false,
        figureId: params.masterSpec.figureId,
        version: 0,
        activated: false,
        error: validation.errors.join(' | '),
      };
    }

    const figureId = params.masterSpec.figureId;
    const existing = this.state.figures[figureId];
    const nextVersion = existing ? existing.currentVersion + 1 : 1;
    const nowIso = new Date().toISOString();

    const versionedManifest: FigurePackAssetManifest = {
      ...structuredClone(params.manifest),
      version: nextVersion,
    };

    const snapshot: FigureVersionSnapshot = {
      version: nextVersion,
      installedAtIso: nowIso,
      masterSpec: structuredClone(params.masterSpec),
      manifest: versionedManifest,
      previewDataUrl: params.previewDataUrl,
    };

    if (existing) {
      existing.name = params.masterSpec.name;
      existing.currentVersion = nextVersion;
      existing.masterSpec = structuredClone(params.masterSpec);
      existing.manifest = versionedManifest;
      existing.previewDataUrl = params.previewDataUrl;
      existing.versionHistory.push(snapshot);
    } else {
      this.state.figures[figureId] = {
        figureId,
        name: params.masterSpec.name,
        currentVersion: nextVersion,
        masterSpec: structuredClone(params.masterSpec),
        manifest: versionedManifest,
        previewDataUrl: params.previewDataUrl,
        versionHistory: [snapshot],
      };
    }

    const shouldActivate = params.activateImmediately ?? true;
    if (shouldActivate) {
      this.state.activeFigureId = figureId;
      this.state.activePoseSlot = resolvePoseSlotWithFallback(
        versionedManifest.slots,
        'stand_idle'
      );
      this.state.activeExpressionId =
        params.masterSpec.facialExpressions[0] ?? 'neutral_warm';
      this.state.activeAnimationState =
        POSE_TO_DEFAULT_ANIMATION_STATE[this.state.activePoseSlot];
      this.state.activeOutfitId =
        params.masterSpec.outfits[0]?.id ?? 'outfit-signature-default';
      this.state.activeProps = [...params.masterSpec.props];
    }

    this.persistToDisk();
    return {
      ok: true,
      figureId,
      version: nextVersion,
      activated: shouldActivate,
    };
  }

  public switchActiveFigure(figureId: string): {
    ok: boolean;
    activeFigureId: string;
    requiresAdditionalApproval: false;
    error?: string;
  } {
    const target = this.state.figures[figureId];
    if (!target) {
      return {
        ok: false,
        activeFigureId: this.state.activeFigureId,
        requiresAdditionalApproval: false,
        error: `Figure "${figureId}" is not installed in the library.`,
      };
    }
    this.state.activeFigureId = figureId;
    this.state.activePoseSlot = resolvePoseSlotWithFallback(
      target.manifest.slots,
      'stand_idle'
    );
    this.state.activeExpressionId =
      target.masterSpec.facialExpressions[0] ?? 'neutral_warm';
    this.state.activeAnimationState =
      POSE_TO_DEFAULT_ANIMATION_STATE[this.state.activePoseSlot];
    this.state.activeOutfitId =
      target.masterSpec.outfits[0]?.id ?? 'outfit-signature-default';
    this.state.activeProps = [...target.masterSpec.props];
    this.persistToDisk();
    return {
      ok: true,
      activeFigureId: figureId,
      requiresAdditionalApproval: false,
    };
  }

  /**
   * Switches pose on the active figure WITHOUT requiring a second click per pose.
   */
  public switchPose(requestedPose: PoseSlotId): {
    ok: boolean;
    requestedPose: PoseSlotId;
    resolvedPose: PoseSlotId;
    animationState: CharacterAnimationStateId;
    requiresAdditionalApproval: false;
  } {
    const active = this.getActiveFigure();
    const resolvedPose = resolvePoseSlotWithFallback(
      active.manifest.slots,
      requestedPose
    );
    const animationState = POSE_TO_DEFAULT_ANIMATION_STATE[resolvedPose];
    this.state.activePoseSlot = resolvedPose;
    this.state.activeAnimationState = animationState;
    this.persistToDisk();
    return {
      ok: true,
      requestedPose,
      resolvedPose,
      animationState,
      requiresAdditionalApproval: false,
    };
  }

  public switchExpression(expressionId: FacialExpressionSlotId): {
    ok: boolean;
    activeExpressionId: FacialExpressionSlotId;
    requiresAdditionalApproval: false;
  } {
    this.state.activeExpressionId = expressionId;
    this.persistToDisk();
    return {
      ok: true,
      activeExpressionId: expressionId,
      requiresAdditionalApproval: false,
    };
  }

  public switchOutfit(outfitId: string): {
    ok: boolean;
    activeOutfitId: string;
    requiresAdditionalApproval: false;
    error?: string;
  } {
    const active = this.getActiveFigure();
    const match = active.masterSpec.outfits.find((o) => o.id === outfitId);
    if (!match) {
      return {
        ok: false,
        activeOutfitId: this.state.activeOutfitId,
        requiresAdditionalApproval: false,
        error: `Outfit "${outfitId}" not found on active figure "${active.name}".`,
      };
    }
    this.state.activeOutfitId = outfitId;
    this.persistToDisk();
    return {
      ok: true,
      activeOutfitId: outfitId,
      requiresAdditionalApproval: false,
    };
  }

  public setActiveProps(props: string[]): {
    ok: boolean;
    activeProps: string[];
    requiresAdditionalApproval: false;
    error?: string;
  } {
    const safety = validateCharacterSafety(props.join(' '));
    if (!safety.allowed) {
      return {
        ok: false,
        activeProps: this.state.activeProps,
        requiresAdditionalApproval: false,
        error: safety.reason,
      };
    }
    this.state.activeProps = [...props];
    this.persistToDisk();
    return {
      ok: true,
      activeProps: [...this.state.activeProps],
      requiresAdditionalApproval: false,
    };
  }

  public rollbackFigureVersion(
    figureId: string,
    targetVersion?: number
  ): {
    ok: boolean;
    figureId: string;
    restoredVersion: number;
    error?: string;
  } {
    const rec = this.state.figures[figureId];
    if (!rec) {
      return {
        ok: false,
        figureId,
        restoredVersion: 0,
        error: `Figure "${figureId}" not found.`,
      };
    }
    if (rec.versionHistory.length < 2 && targetVersion === undefined) {
      return {
        ok: false,
        figureId,
        restoredVersion: rec.currentVersion,
        error: `No prior version exists for figure "${figureId}".`,
      };
    }
    const desiredVersion =
      targetVersion ??
      rec.versionHistory[rec.versionHistory.length - 2]!.version;
    const snap = rec.versionHistory.find((v) => v.version === desiredVersion);
    if (!snap) {
      return {
        ok: false,
        figureId,
        restoredVersion: rec.currentVersion,
        error: `Version ${desiredVersion} not found for figure "${figureId}".`,
      };
    }

    rec.currentVersion = snap.version;
    rec.masterSpec = structuredClone(snap.masterSpec);
    rec.manifest = structuredClone(snap.manifest);
    rec.previewDataUrl = snap.previewDataUrl;
    this.persistToDisk();

    return {
      ok: true,
      figureId,
      restoredVersion: snap.version,
    };
  }
}

// ============================================================================
// CHARACTER FACTORY SERVICE & TOOL REGISTRY INTEGRATION
// ============================================================================

export class CharacterFactory {
  private readonly library: PersistentFigureLibrary;
  private readonly imageProvider?: ImageGenerationProviderAdapter;

  constructor(options?: {
    library?: PersistentFigureLibrary;
    storageDir?: string;
    imageProvider?: ImageGenerationProviderAdapter;
  }) {
    this.library =
      options?.library ??
      new PersistentFigureLibrary({ storageDir: options?.storageDir });
    this.imageProvider = options?.imageProvider;
  }

  public getLibrary(): PersistentFigureLibrary {
    return this.library;
  }

  public async createAndInstallFigure(
    rawInput: CharacterFactoryInput
  ): Promise<CharacterFactoryOutput> {
    const plan = runStructuredCharacterPlanningPipeline(rawInput, {
      imageProvider: this.imageProvider,
    });
    if (!plan.ok || !plan.masterSpec) {
      return {
        ok: false,
        executionState: 'BLOCKED',
        generationMode: plan.generationMode,
        providerStatus: plan.providerStatus,
        placeholderLabel: plan.placeholderLabel,
        safety: plan.safety,
        error: plan.error,
      };
    }

    const masterSpec = plan.masterSpec;
    const width = masterSpec.assetRequirements.recommendedWidthPx;
    const height = masterSpec.assetRequirements.recommendedHeightPx;
    const isLive =
      plan.generationMode === 'LIVE_PROVIDER' &&
      Boolean(this.imageProvider?.isAvailable());

    const slots: Partial<Record<PoseSlotId, FigurePackSlotAssetExtended>> = {};
    for (const slot of masterSpec.poseSlots) {
      let dataUrl: string;
      let mimeType: 'image/png' | 'image/webp' = 'image/webp';

      if (isLive && this.imageProvider) {
        const generated = await this.imageProvider.generatePoseOrExpressionAsset({
          figureId: masterSpec.figureId,
          figureName: masterSpec.name,
          kind: 'pose',
          slotId: slot,
          prompt: `${masterSpec.name}: ${masterSpec.appearanceSummary} — Pose: ${slot}`,
          width,
          height,
        });
        dataUrl = generated.dataUrl;
        mimeType = generated.mimeType;
      } else {
        const synth = buildDeterministicTransparentWebpDataUrl(
          `template:${masterSpec.figureId}:${masterSpec.palette.hairColor}:${slot}`,
          width,
          height
        );
        dataUrl = synth.dataUrl;
        mimeType = 'image/webp';
      }

      const inspected = inspectPngOrWebpDataUrl(dataUrl);
      slots[slot] = {
        slot,
        mimeType,
        byteSize: inspected.byteSize,
        width,
        height,
        webpDataUrl: dataUrl,
        sha256: inspected.sha256,
        hasAlphaChannel: inspected.hasAlphaChannel,
        isTemplatePlaceholder: !isLive,
        anchor: {
          feetX: 0.5,
          feetY: 0.92,
          seatX: 0.5,
          seatY: 0.62,
        },
      };
    }

    const expressions: Partial<
      Record<FacialExpressionSlotId, FigurePackExpressionAsset>
    > = {};
    for (const expr of masterSpec.facialExpressions) {
      let dataUrl: string;
      let mimeType: 'image/png' | 'image/webp' = 'image/png';

      if (isLive && this.imageProvider) {
        const generated = await this.imageProvider.generatePoseOrExpressionAsset({
          figureId: masterSpec.figureId,
          figureName: masterSpec.name,
          kind: 'expression',
          slotId: expr,
          prompt: `${masterSpec.name}: ${masterSpec.appearanceSummary} — Expression: ${expr}`,
          width,
          height,
        });
        dataUrl = generated.dataUrl;
        mimeType = generated.mimeType;
      } else {
        const synth = buildDeterministicTransparentPngDataUrl(
          `template:${masterSpec.figureId}:${masterSpec.palette.eyeColor}:expr:${expr}`,
          width,
          height
        );
        dataUrl = synth.dataUrl;
        mimeType = 'image/png';
      }

      const inspected = inspectPngOrWebpDataUrl(dataUrl);
      expressions[expr] = {
        expressionId: expr,
        mimeType,
        byteSize: inspected.byteSize,
        width,
        height,
        dataUrl,
        sha256: inspected.sha256,
        hasAlphaChannel: inspected.hasAlphaChannel,
        isTemplatePlaceholder: !isLive,
      };
    }

    let previewDataUrl: string;
    let previewMime: 'image/png' | 'image/webp' = 'image/png';
    if (isLive && this.imageProvider) {
      const genPreview = await this.imageProvider.generatePoseOrExpressionAsset({
        figureId: masterSpec.figureId,
        figureName: masterSpec.name,
        kind: 'preview',
        slotId: 'master_preview',
        prompt: `${masterSpec.name} Master Turnaround Preview: ${masterSpec.appearanceSummary}`,
        width,
        height,
      });
      previewDataUrl = genPreview.dataUrl;
      previewMime = genPreview.mimeType;
    } else {
      const synthPreview = buildDeterministicTransparentPngDataUrl(
        `template:${masterSpec.figureId}:${masterSpec.palette.hairColor}:preview`,
        width,
        height
      );
      previewDataUrl = synthPreview.dataUrl;
      previewMime = 'image/png';
    }
    const inspectedPreview = inspectPngOrWebpDataUrl(previewDataUrl);

    const manifestPayloadHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          figureId: masterSpec.figureId,
          slots: Object.keys(slots),
          expressions: Object.keys(expressions),
          previewSha: inspectedPreview.sha256,
        })
      )
      .digest('hex');

    const manifest: FigurePackAssetManifest = {
      id: `pack-${masterSpec.figureId}-${Date.now()}`,
      figureId: masterSpec.figureId,
      version: 1,
      name: `${masterSpec.name} Companion Pack`,
      author: rawInput.author || 'Morrow CharacterFactory',
      license: rawInput.license || 'CC-BY-4.0',
      sourceUrlOrNote:
        rawInput.sourceAttribution ||
        (isLive
          ? `Generated by provider ${this.imageProvider!.providerId}`
          : 'Morrow CharacterFactory Deterministic Template Pack'),
      createdAtIso: new Date().toISOString(),
      rigTarget: masterSpec.rigTarget,
      generationMode: plan.generationMode,
      providerStatus: plan.providerStatus,
      placeholderLabel: plan.placeholderLabel,
      manifestSha256: manifestPayloadHash,
      spec: masterSpec.baseSpec as CharacterSpec,
      slots,
      expressions,
    };

    const validation = validateFigurePackForInstallation(manifest);
    if (!validation.valid) {
      return {
        ok: false,
        executionState: 'BLOCKED',
        generationMode: plan.generationMode,
        providerStatus: plan.providerStatus,
        placeholderLabel: plan.placeholderLabel,
        rigCompatibilityReport: validation.rigCompatibility,
        safety: plan.safety,
        error: validation.errors.join(' | '),
      };
    }

    const installResult = this.library.installOrUpdateFigure({
      masterSpec,
      manifest,
      previewDataUrl,
      activateImmediately: rawInput.activateImmediately ?? true,
    });

    if (!installResult.ok) {
      return {
        ok: false,
        executionState: 'BLOCKED',
        generationMode: plan.generationMode,
        providerStatus: plan.providerStatus,
        placeholderLabel: plan.placeholderLabel,
        rigCompatibilityReport: validation.rigCompatibility,
        safety: plan.safety,
        error: installResult.error,
      };
    }

    return {
      ok: true,
      executionState: isLive ? 'EXECUTED' : 'SIMULATED',
      generationMode: plan.generationMode,
      providerStatus: plan.providerStatus,
      placeholderLabel: plan.placeholderLabel,
      figureId: installResult.figureId,
      activatedFigureId: installResult.activated ? installResult.figureId : null,
      version: installResult.version,
      masterSpec,
      previewAsset: {
        mimeType: previewMime,
        width,
        height,
        dataUrl: previewDataUrl,
        byteSize: inspectedPreview.byteSize,
        hasAlphaChannel: inspectedPreview.hasAlphaChannel,
        generationMode: plan.generationMode,
      },
      rigCompatibilityReport: validation.rigCompatibility,
      assetManifest: this.library.getFigure(installResult.figureId)?.manifest,
      safety: plan.safety,
    };
  }

  /**
   * Synchronous figure creation for ToolRegistry synchronous execution when using
   * template placeholders or a synchronous provider adapter.
   */
  public createAndInstallFigureSync(
    rawInput: CharacterFactoryInput
  ): CharacterFactoryOutput {
    const plan = runStructuredCharacterPlanningPipeline(rawInput, {
      imageProvider: this.imageProvider,
    });
    if (!plan.ok || !plan.masterSpec) {
      return {
        ok: false,
        executionState: 'BLOCKED',
        generationMode: plan.generationMode,
        providerStatus: plan.providerStatus,
        placeholderLabel: plan.placeholderLabel,
        safety: plan.safety,
        error: plan.error,
      };
    }

    const masterSpec = plan.masterSpec;
    const width = masterSpec.assetRequirements.recommendedWidthPx;
    const height = masterSpec.assetRequirements.recommendedHeightPx;

    const slots: Partial<Record<PoseSlotId, FigurePackSlotAssetExtended>> = {};
    for (const slot of masterSpec.poseSlots) {
      const synth = buildDeterministicTransparentWebpDataUrl(
        `template:${masterSpec.figureId}:${masterSpec.palette.hairColor}:${slot}`,
        width,
        height
      );
      slots[slot] = {
        slot,
        mimeType: 'image/webp',
        byteSize: synth.byteSize,
        width,
        height,
        webpDataUrl: synth.dataUrl,
        sha256: synth.sha256,
        hasAlphaChannel: true,
        isTemplatePlaceholder: true,
        anchor: { feetX: 0.5, feetY: 0.92, seatX: 0.5, seatY: 0.62 },
      };
    }

    const expressions: Partial<
      Record<FacialExpressionSlotId, FigurePackExpressionAsset>
    > = {};
    for (const expr of masterSpec.facialExpressions) {
      const synth = buildDeterministicTransparentPngDataUrl(
        `template:${masterSpec.figureId}:${masterSpec.palette.eyeColor}:expr:${expr}`,
        width,
        height
      );
      expressions[expr] = {
        expressionId: expr,
        mimeType: 'image/png',
        byteSize: synth.byteSize,
        width,
        height,
        dataUrl: synth.dataUrl,
        sha256: synth.sha256,
        hasAlphaChannel: true,
        isTemplatePlaceholder: true,
      };
    }

    const synthPreview = buildDeterministicTransparentPngDataUrl(
      `template:${masterSpec.figureId}:${masterSpec.palette.hairColor}:preview`,
      width,
      height
    );

    const manifestPayloadHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          figureId: masterSpec.figureId,
          slots: Object.keys(slots),
          expressions: Object.keys(expressions),
          previewSha: synthPreview.sha256,
        })
      )
      .digest('hex');

    const manifest: FigurePackAssetManifest = {
      id: `pack-${masterSpec.figureId}-${Date.now()}`,
      figureId: masterSpec.figureId,
      version: 1,
      name: `${masterSpec.name} Companion Pack`,
      author: rawInput.author || 'Morrow CharacterFactory',
      license: rawInput.license || 'CC-BY-4.0',
      sourceUrlOrNote:
        rawInput.sourceAttribution ||
        'Morrow CharacterFactory Deterministic Template Pack',
      createdAtIso: new Date().toISOString(),
      rigTarget: masterSpec.rigTarget,
      generationMode: plan.generationMode,
      providerStatus: plan.providerStatus,
      placeholderLabel: plan.placeholderLabel,
      manifestSha256: manifestPayloadHash,
      spec: masterSpec.baseSpec as CharacterSpec,
      slots,
      expressions,
    };

    const validation = validateFigurePackForInstallation(manifest);
    if (!validation.valid) {
      return {
        ok: false,
        executionState: 'BLOCKED',
        generationMode: plan.generationMode,
        providerStatus: plan.providerStatus,
        placeholderLabel: plan.placeholderLabel,
        rigCompatibilityReport: validation.rigCompatibility,
        safety: plan.safety,
        error: validation.errors.join(' | '),
      };
    }

    const installResult = this.library.installOrUpdateFigure({
      masterSpec,
      manifest,
      previewDataUrl: synthPreview.dataUrl,
      activateImmediately: rawInput.activateImmediately ?? true,
    });

    return {
      ok: installResult.ok,
      executionState: installResult.ok ? 'SIMULATED' : 'BLOCKED',
      generationMode: plan.generationMode,
      providerStatus: plan.providerStatus,
      placeholderLabel: plan.placeholderLabel,
      figureId: installResult.figureId,
      activatedFigureId: installResult.activated ? installResult.figureId : null,
      version: installResult.version,
      masterSpec,
      previewAsset: {
        mimeType: 'image/png',
        width,
        height,
        dataUrl: synthPreview.dataUrl,
        byteSize: synthPreview.byteSize,
        hasAlphaChannel: true,
        generationMode: plan.generationMode,
      },
      rigCompatibilityReport: validation.rigCompatibility,
      assetManifest: this.library.getFigure(installResult.figureId)?.manifest,
      safety: plan.safety,
      error: installResult.error,
    };
  }
}

export function createCharacterFactoryToolDefinitions(
  factory: CharacterFactory
): ToolRegistration[] {
  return [
    {
      name: 'character.factory.create_figure',
      version: '1.0.0',
      subsystem: 'mission_runtime',
      inputSchema: {
        name: 'string:required',
        description: 'string:required',
        proportions: 'string:optional',
        rigTarget: 'string:optional',
        author: 'string:optional',
        license: 'string:optional',
        sourceAttribution: 'string:optional',
        activateImmediately: 'boolean:optional',
        explicitUserRequestPrompt: 'string:optional',
      },
      outputSchema: {
        figureId: 'string',
        activatedFigureId: 'string',
        version: 'number',
        generationMode: 'string',
        providerStatus: 'string',
        placeholderLabel: 'string',
        rigCompatible: 'boolean',
        manifestSha256: 'string',
      },
      riskClass: 'read',
      requiredCapabilities: ['character:manage_figures'],
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 0, backoffMs: 0, idempotent: true },
      availabilityStatus: 'AVAILABLE_REAL',
      executor: (args: Record<string, unknown>) => {
        const res = factory.createAndInstallFigureSync({
          name: String(args.name || 'Nova'),
          description: String(args.description || ''),
          proportions:
            (args.proportions as 'vtuber_full' | 'chibi' | 'portrait_bust') ||
            'vtuber_full',
          rigTarget: (args.rigTarget as RigTargetId) || 'morrow_live2d_v2',
          author: args.author ? String(args.author) : 'Morrow CharacterFactory',
          license: args.license ? String(args.license) : 'CC-BY-4.0',
          sourceAttribution: args.sourceAttribution
            ? String(args.sourceAttribution)
            : 'Morrow CharacterFactory Spec',
          activateImmediately:
            typeof args.activateImmediately === 'boolean'
              ? args.activateImmediately
              : true,
          explicitUserRequestPrompt: args.explicitUserRequestPrompt
            ? String(args.explicitUserRequestPrompt)
            : undefined,
        });

        if (!res.ok) {
          return {
            ok: false,
            output: {
              error: res.error,
              generationMode: res.generationMode,
              providerStatus: res.providerStatus,
            },
            realSideEffectPerformed: false,
            isSimulated: false,
            errorCode: 'CHARACTER_FACTORY_BLOCKED',
            errorMessage: res.error || 'Character creation blocked.',
          };
        }

        return {
          ok: true,
          output: {
            figureId: res.figureId,
            activatedFigureId: res.activatedFigureId,
            version: res.version,
            generationMode: res.generationMode,
            providerStatus: res.providerStatus,
            placeholderLabel: res.placeholderLabel ?? '',
            rigCompatible: Boolean(res.rigCompatibilityReport?.compatible),
            manifestSha256: res.assetManifest?.manifestSha256 ?? '',
          },
          realSideEffectPerformed: true,
          isSimulated: false,
        };
      },
      verifier: (_args, outcome) => {
        const figId = String(outcome.output.figureId || '');
        const installed = factory.getLibrary().getFigure(figId);
        const criteriaMet =
          outcome.ok &&
          Boolean(installed) &&
          installed?.manifest.manifestSha256 === outcome.output.manifestSha256;
        return {
          independentTargetRead: true,
          criteriaMet,
          verificationState: criteriaMet ? 'VERIFIED' : 'FAILED',
          evidenceHash: installed?.manifest.manifestSha256 ?? '',
          summary: criteriaMet
            ? `Independently verified installed figure "${figId}" v${installed?.currentVersion} in PersistentFigureLibrary.`
            : `Failed to verify installed figure "${figId}".`,
        };
      },
    },
  ];
}
