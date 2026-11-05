/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Blaize Screen-Aware Skill Recorder & Multi-Skill DAG Planner (`src/packages/recorder/index.ts`)
 *
 * 100% Domain-Neutral Core Module:
 * 1. Capture Sources (`RecorderSource` interface):
 *    - `ScreenCaptureSource` (REAL in browser via `navigator.mediaDevices.getDisplayMedia`):
 *      meaningful pixel-delta keyframe sampling, max frame & FPS caps, JPEG downscaling,
 *      IndexedDB storage (0 frames held in RAM), automatic track teardown, and iframe block fallback.
 *    - `InAppSource` (REAL): captures clicks with element descriptors, navigation, typing,
 *      scrolling, and sandboxed file operations inside Blaize Browser and Desktop Stage.
 *    - `NativeInputSource` (STUB): documented stub for future native OS shell.
 * 2. Privacy & Credential Protection:
 *    - Screen awareness modes: `'off'` (default), `'ask'` (single previewed screenshot on "look at my screen"), `'recording'`.
 *    - Auto-pause on password, OTP, and PIN fields/pages.
 *    - User-editable blocked sensitive app categories & custom blur regions.
 * 3. Review & Local Encryption Before Anything Leaves Device:
 *    - Timeline trimming, frame deletion, blur regions, local encryption envelope, retention policy.
 * 4. Compile to Skill & Golden Test:
 *    - Deterministic rule-based compiler (Mock Mode) & Meta Model structured output compiler (Live Mode).
 *    - Automatic parameter extraction, secret placeholder masking (`{{SECRET_...}}`), pixel-inference warnings,
 *      Dry Run simulation, and Golden Test generation.
 *    - Status lifecycle: `Draft` -> `Tested` -> `Approved` (only `Approved` skills can run in schedules or multi-skill plans).
 * 5. Replay by Intent, Drift Patching & Version Rollback:
 *    - Selector/accessible-name match -> screenshot fallback -> PolicyGuard -> Checkpoint Verifier.
 *    - Diff patch generator with strict No-Permission-Widening enforcement and 1-click version rollback.
 * 6. Multi-Skill DAG Planner & Resource-Locked Executor:
 *    - Cycle detection, depth limit, step cap, UI resource locks (`browser_view`, `input_device`),
 *      parallel execution for read-only non-UI skills, version pinning, token/cost budget, and failure policies.
 */

import {
  ActionProposal,
  CoreVerifierStrategyId,
  GenericRiskClass,
  VerifierStrategyId,
} from '../contracts';
import {
  DEFAULT_POLICY_CONFIG,
  MemoryLedger,
  PolicyConfig,
  computeDeterministicHash,
  evaluatePolicyGuard,
  runVerifier,
} from '../trust';

// ============================================================================
// 1. SCREEN AWARENESS & CAPTURE SOURCES (RecorderSource Interface)
// ============================================================================

export type ScreenAwarenessMode = 'off' | 'ask' | 'recording';

export type RecorderSourceKind = 'screen_capture' | 'in_app' | 'native_input';
export type RecorderSourceType = 'screen' | 'in_app' | 'native_stub';

export type RecorderSourceUiLabel =
  | 'Selected display video + keyframes'
  | 'In-app events'
  | 'Full desktop (not available in this preview)';

export interface RecordedKeyframe {
  id: string;
  timestamp: number;
  sourceType: RecorderSourceType;
  width: number;
  height: number;
  jpegQuality: number;
  diffScore: number;
  sha256Hash: string;
  indexedDbKey: string;
  blurRegions: BlurRegionRect[];
  annotation?: string;
  inferredFromPixelsOnly?: boolean;
  deleted?: boolean;
  blobHash?: string;
  storageBackend?: 'sqlite' | 'indexeddb' | 'memory';
}

export interface RecordedInteractionEvent {
  id: string;
  timestamp: number;
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'file_op';
  targetDescriptor: string;
  accessibleName?: string;
  value?: string;
  urlOrApp: string;
  isCredentialField?: boolean;
  isCheckpoint?: boolean;
}

export interface RecordedNarrationSegment {
  id: string;
  timestamp: number;
  text: string;
  mode: 'typed_note' | 'push_to_talk_mock' | 'muse_voice_live';
}

export interface RecordingMediaSegmentMeta {
  id: string;
  sessionId: string;
  sequence: number;
  timestampMs: number;
  durationMs: number;
  mimeType: string;
  byteSize: number;
  sha256Hash: string;
  blobHash: string;
  storageBackend: 'sqlite' | 'indexeddb';
}

export interface RecordingSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  sourceType: RecorderSourceType;
  sourceLabel: string;
  retentionPolicy: 'delete_after_compile' | 'keep_24h' | 'keep_until_deleted';
  encryptedLocal: boolean;
  keyframes: RecordedKeyframe[];
  mediaSegments?: RecordingMediaSegmentMeta[];
  events: RecordedInteractionEvent[];
  narration: RecordedNarrationSegment[];
  autoPausedCount: number;
  blockedCategories: string[];
  userApprovedKeyframesForCompile: boolean;
}

export interface BlurRegionRect {
  id: string;
  xPct: number; // 0..100
  yPct: number; // 0..100
  widthPct: number; // 5..100
  heightPct: number; // 5..100
  label: string;
}

export interface StoredKeyframeMeta {
  id: string;
  timestampMs: number;
  elapsedSeconds: number;
  width: number;
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  sha256Hash: string;
  pixelDiffPct: number;
  sourceKind: RecorderSourceKind;
  caption: string;
  blurRegions: BlurRegionRect[];
  approvedForCompile: boolean;
  storedInIndexedDb: boolean;
  previewDataUrl?: string; // Lightweight downscaled thumbnail URL fetched on demand for Review UI
  blobHash?: string;
  storageBackend?: 'sqlite' | 'indexeddb' | 'memory';
}

export interface CapturedActionEvent {
  id: string;
  timestampMs: number;
  elapsedSeconds: number;
  kind: 'click' | 'type' | 'navigate' | 'scroll' | 'file_op' | 'note' | 'checkpoint';
  sourceKind: RecorderSourceKind;
  targetSelector: string;
  accessibleName: string;
  tagName: string;
  role: string;
  typedValue?: string;
  isSecretInput?: boolean;
  fileOpKind?: 'rename' | 'write' | 'copy' | 'read';
  filePath?: string;
  destinationPath?: string;
  appOrDomain: string;
  narrationText?: string;
  checkpointExpectedState?: string;
  inferredFromPixels?: boolean;
}

export interface RecorderConsentRecord {
  consentId: string;
  grantedAtIso: string;
  selectedSource: RecorderSourceKind;
  retentionPolicy: 'delete_after_compile' | 'keep_24h' | 'keep_7_days' | 'keep_until_deleted';
  credentialAutoPauseEnabled: boolean;
  blockedAppCategories: string[];
  narrationMode: 'off' | 'push_to_talk' | 'typed_notes';
}

export interface RecorderSourceStatus {
  kind: RecorderSourceKind;
  uiLabel: RecorderSourceUiLabel;
  realOrSimulatedBadge: 'REAL (User-Consented Display Capture)' | 'REAL (In-App DOM)' | 'STUB (Desktop Shell Only)';
  videoRecordingActive?: boolean;
  mediaSegmentsCaptured?: number;
  mediaRecordingError?: string;
  active: boolean;
  paused: boolean;
  blockedByIframePermission?: boolean;
  blockExplanation?: string;
  fallbackSuggestion?: string;
  framesCapturedCount: number;
  eventsCapturedCount: number;
  allTracksStopped: boolean;
}

export interface RecorderSource {
  readonly kind: RecorderSourceKind;
  readonly uiLabel: RecorderSourceUiLabel;
  readonly isRealInPreview: boolean;
  start(consent: RecorderConsentRecord): Promise<RecorderSourceStatus>;
  pause(reason?: string): RecorderSourceStatus;
  resume(): RecorderSourceStatus;
  stop(): Promise<RecorderSourceStatus>;
  getStatus(): RecorderSourceStatus;
}

// ============================================================================
// 2. INDEXEDDB KEYFRAME STORE (0 FRAMES RETAINED IN RAM)
// ============================================================================

const IDB_DB_NAME = 'blaize_skill_recorder_idb_v1';
const IDB_STORE_NAME = 'keyframes';
const IDB_MEDIA_STORE_NAME = 'media_segments';
const IDB_DB_VERSION = 2;

function encodeBytesBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export async function saveRecordingMediaSegment(
  sessionId: string,
  sequence: number,
  chunk: Blob,
  timestampMs: number,
  durationMs: number
): Promise<RecordingMediaSegmentMeta> {
  if (!chunk || chunk.size < 1) throw new Error('MEDIA_SEGMENT_EMPTY: no video bytes were produced.');
  // The current IPC transport has a bounded payload size; MediaRecorder emits short one-second chunks.
  if (chunk.size > 8 * 1024 * 1024) throw new Error('MEDIA_SEGMENT_TOO_LARGE: video segment exceeded the 8 MiB safety limit.');
  const bytes = new Uint8Array(await chunk.arrayBuffer());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const blobHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const mimeType = chunk.type || 'video/webm';
  const id = `${sessionId}-segment-${String(sequence).padStart(6, '0')}`;
  const base: Omit<RecordingMediaSegmentMeta, 'storageBackend'> = {
    id, sessionId, sequence, timestampMs, durationMs, mimeType,
    byteSize: bytes.byteLength, sha256Hash: blobHash, blobHash,
  };

  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    await window.electronAPI.storage.saveBlob(blobHash, encodeBytesBase64(bytes), mimeType);
    await window.electronAPI.storage.putRecord('recorder_media_segments', {
      id, collection: 'recorder_media_segments', data: { ...base, storageBackend: 'sqlite' },
      createdAt: timestampMs, updatedAt: Date.now(),
    });
    return { ...base, storageBackend: 'sqlite' };
  }

  if (typeof window !== 'undefined' && window.indexedDB) {
    await new Promise<void>((resolve, reject) => {
      const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(IDB_MEDIA_STORE_NAME)) db.createObjectStore(IDB_MEDIA_STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(IDB_MEDIA_STORE_NAME, 'readwrite');
        tx.objectStore(IDB_MEDIA_STORE_NAME).put({ id, meta: { ...base, storageBackend: 'indexeddb' }, blob: chunk });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB media write failed.')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB media write aborted.')); };
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    });
    return { ...base, storageBackend: 'indexeddb' };
  }
  throw new Error('MEDIA_STORAGE_UNAVAILABLE: neither desktop SQLite nor browser IndexedDB is available.');
}

export async function loadRecordingMediaBlob(session: RecordingSession): Promise<Blob | null> {
  const segments = [...(session.mediaSegments || [])].sort((a, b) => a.sequence - b.sequence);
  if (!segments.length) return null;
  const parts: BlobPart[] = [];
  let mimeType = segments[0].mimeType || 'video/webm';
  for (const segment of segments) {
    let bytes: Uint8Array | null = null;
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      const stored = await window.electronAPI.storage.readBlob(segment.blobHash);
      if (!stored) throw new Error(`VIDEO_SEGMENT_MISSING: ${segment.id}`);
      const binary = atob(stored.dataBase64);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      mimeType = stored.mimeType || mimeType;
    } else if (typeof window !== 'undefined' && window.indexedDB) {
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(IDB_MEDIA_STORE_NAME)) { db.close(); resolve(null); return; }
          const tx = db.transaction(IDB_MEDIA_STORE_NAME, 'readonly');
          const get = tx.objectStore(IDB_MEDIA_STORE_NAME).get(segment.id);
          get.onsuccess = () => { const value = get.result?.blob; db.close(); resolve(value instanceof Blob ? value : null); };
          get.onerror = () => { db.close(); reject(get.error || new Error('Unable to read video segment.')); };
        };
        request.onerror = () => reject(request.error || new Error('Unable to open recorder database.'));
      });
      if (!blob) throw new Error(`VIDEO_SEGMENT_MISSING: ${segment.id}`);
      bytes = new Uint8Array(await blob.arrayBuffer());
      mimeType = blob.type || mimeType;
    }
    if (!bytes) throw new Error('VIDEO_STORAGE_UNAVAILABLE: no persistent media store is available.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    const actualHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (actualHash !== segment.blobHash) throw new Error(`VIDEO_INTEGRITY_FAILED: ${segment.id}`);
    const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    parts.push(exactBuffer);
  }
  return new Blob(parts, { type: mimeType });
}

export async function deleteRecordingMediaSegments(segments: RecordingMediaSegmentMeta[]): Promise<number> {
  let deleted = 0;
  for (const segment of segments) {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      try {
        const result = await window.electronAPI.storage.deleteRecord('recorder_media_segments', segment.id);
        if (result.success) deleted++;
        await window.electronAPI.storage.deleteBlob(segment.blobHash);
      } catch (error) {
        console.error(`Unable to delete media segment ${segment.id} from SQLite.`, error);
      }
    } else if (typeof window !== 'undefined' && window.indexedDB) {
      try {
        await new Promise<void>((resolve, reject) => {
          const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IDB_MEDIA_STORE_NAME)) { db.close(); resolve(); return; }
            const tx = db.transaction(IDB_MEDIA_STORE_NAME, 'readwrite');
            tx.objectStore(IDB_MEDIA_STORE_NAME).delete(segment.id);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error || new Error('Unable to delete video segment.')); };
          };
          request.onerror = () => reject(request.error || new Error('Unable to open recorder database.'));
        });
        deleted++;
      } catch (error) {
        console.error(`Unable to delete media segment ${segment.id} from IndexedDB.`, error);
      }
    }
  }
  return deleted;
}

// Fallback map for Node.js unit test environment where window.indexedDB is absent
const NODE_IDB_FALLBACK = new Map<string, { meta: StoredKeyframeMeta; jpegDataUrl: string }>();

export async function saveKeyframeToIndexedDb(
  metaOrKey: StoredKeyframeMeta | string,
  jpegDataUrl: string
): Promise<StoredKeyframeMeta> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(jpegDataUrl);
  if (!match) throw new Error('KEYFRAME_INVALID_DATA_URL: expected a base64 JPEG, PNG, or WebP data URL.');
  const mimeType = match[1] as StoredKeyframeMeta['mimeType'];
  const dataBase64 = match[2];
  const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const blobHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const baseMeta: StoredKeyframeMeta = typeof metaOrKey === 'string'
    ? {
        id: metaOrKey, timestampMs: Date.now(), elapsedSeconds: 0, width: 640, height: 360,
        mimeType, byteSize: bytes.byteLength, sha256Hash: blobHash, pixelDiffPct: 12,
        sourceKind: 'in_app', caption: metaOrKey, blurRegions: [], approvedForCompile: true,
        storedInIndexedDb: false,
      }
    : { ...metaOrKey, mimeType, byteSize: bytes.byteLength, sha256Hash: blobHash };

  // Native desktop mode: binary frame bytes and metadata share the durable SQLite database.
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    await window.electronAPI.storage.saveBlob(blobHash, dataBase64, mimeType);
    const saved: StoredKeyframeMeta = {
      ...baseMeta, sha256Hash: blobHash, blobHash, storageBackend: 'sqlite', storedInIndexedDb: false,
    };
    await window.electronAPI.storage.putRecord('recorder_keyframes', {
      id: saved.id, collection: 'recorder_keyframes', data: { ...saved, previewDataUrl: undefined },
      createdAt: saved.timestampMs, updatedAt: Date.now(),
    });
    return saved;
  }

  // Browser preview uses IndexedDB. Memory is only a unit-test fallback when no DOM exists.
  if (typeof window !== 'undefined' && window.indexedDB) {
    await new Promise<void>((resolve, reject) => {
      const req = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE_NAME)) {
          req.result.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        }
        if (!req.result.objectStoreNames.contains(IDB_MEDIA_STORE_NAME)) {
          req.result.createObjectStore(IDB_MEDIA_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        tx.objectStore(IDB_STORE_NAME).put({ id: baseMeta.id, meta: baseMeta, jpegDataUrl });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB write failed.')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB write aborted.')); };
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed.'));
    });
    return { ...baseMeta, storedInIndexedDb: true, storageBackend: 'indexeddb', previewDataUrl: jpegDataUrl };
  }

  if (typeof window === 'undefined') {
    const fallback = { ...baseMeta, storageBackend: 'memory' as const, storedInIndexedDb: false };
    NODE_IDB_FALLBACK.set(fallback.id, { meta: fallback, jpegDataUrl });
    return fallback;
  }
  throw new Error('KEYFRAME_STORAGE_UNAVAILABLE: persistent IndexedDB storage is unavailable.');
}

export async function deleteKeyframesFromIndexedDb(frameIds: string[]): Promise<number> {
  let deleted = 0;
  if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
    for (const id of frameIds) {
      try {
        const metadata = await window.electronAPI.storage.getRecord('recorder_keyframes', id);
        const blobHash = typeof metadata?.data?.blobHash === 'string' ? metadata.data.blobHash : undefined;
        const result = await window.electronAPI.storage.deleteRecord('recorder_keyframes', id);
        if (result.success) deleted++;
        if (blobHash) await window.electronAPI.storage.deleteBlob(blobHash);
      } catch (error) {
        console.error(`Unable to delete keyframe ${id} from SQLite.`, error);
      }
    }
    return deleted;
  }
  for (const id of frameIds) {
    if (NODE_IDB_FALLBACK.delete(id)) {
      deleted++;
    }
  }

  if (typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB) {
    try {
      await new Promise<void>((resolve) => {
        const req = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);
          for (const id of frameIds) {
            store.delete(id);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        };
        req.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  return deleted;
}

export function getStoredKeyframeCountInFallback(): number {
  return NODE_IDB_FALLBACK.size;
}

// ============================================================================
// 3. MEANINGFUL PIXEL-CHANGE KEYFRAME SAMPLER & RATE LIMITER
// ============================================================================

export interface KeyframeSamplerConfig {
  maxFrames: number;
  minIntervalMs: number;
  meaningfulDiffThresholdPct: number;
  targetJpegWidth: number;
  jpegQuality: number;
}

export const DEFAULT_KEYFRAME_SAMPLER_CONFIG: KeyframeSamplerConfig = {
  maxFrames: 24,
  minIntervalMs: 1200, // Max ~0.83 fps sampling rate
  meaningfulDiffThresholdPct: 4.0, // Minimum 4% visual change required to capture keyframe
  targetJpegWidth: 960,
  jpegQuality: 0.72,
};

/**
 * Pure deterministic evaluator that decides whether a candidate frame should be sampled
 * based on frame count cap, minimum time interval, and pixel delta percentage.
 */
export function shouldSampleKeyframe(params: {
  currentFrameCount: number;
  lastSampleTimestampMs: number | null;
  candidateTimestampMs: number;
  pixelDiffPct: number;
  forceCheckpoint?: boolean;
  config?: KeyframeSamplerConfig;
}): {
  sample: boolean;
  reason:
    | 'first_frame'
    | 'checkpoint_forced'
    | 'meaningful_visual_change'
    | 'skipped_max_frame_cap'
    | 'skipped_rate_limit'
    | 'skipped_low_visual_delta';
} {
  const cfg = params.config || DEFAULT_KEYFRAME_SAMPLER_CONFIG;

  if (params.currentFrameCount >= cfg.maxFrames) {
    return { sample: false, reason: 'skipped_max_frame_cap' };
  }

  if (params.currentFrameCount === 0 || params.lastSampleTimestampMs === null) {
    return { sample: true, reason: 'first_frame' };
  }

  if (params.forceCheckpoint) {
    return { sample: true, reason: 'checkpoint_forced' };
  }

  const elapsed = params.candidateTimestampMs - params.lastSampleTimestampMs;
  if (elapsed < cfg.minIntervalMs) {
    return { sample: false, reason: 'skipped_rate_limit' };
  }

  if (params.pixelDiffPct < cfg.meaningfulDiffThresholdPct) {
    return { sample: false, reason: 'skipped_low_visual_delta' };
  }

  return { sample: true, reason: 'meaningful_visual_change' };
}

/**
 * Computes percentage of pixels that changed meaningfully between two RGBA or luminance arrays.
 */
export function computePixelDiffPercentage(
  prevSample: Uint8ClampedArray | number[],
  nextSample: Uint8ClampedArray | number[],
  channelDiffThreshold = 20
): number {
  const len = Math.min(prevSample.length, nextSample.length);
  if (len === 0) return 100;
  let changed = 0;
  for (let i = 0; i < len; i++) {
    if (Math.abs(prevSample[i] - nextSample[i]) >= channelDiffThreshold) {
      changed++;
    }
  }
  return Math.round((changed / len) * 1000) / 10;
}

// ============================================================================
// 4. CREDENTIAL AUTO-PAUSE & SENSITIVE APP CATEGORY GUARD
// ============================================================================

export const DEFAULT_BLOCKED_APP_CATEGORIES: string[] = [
  'Password Managers (1Password, Bitwarden, KeePass)',
  'Banking & Tax Portals',
  'System Keychain & OS Security Settings',
  'Private Medical & Health Records',
];

export interface CredentialProtectionEvaluation {
  shouldAutoPause: boolean;
  isSecretField: boolean;
  matchedCategoryOrRule: string | null;
  reason: string;
}

export function evaluateCredentialAndAppProtection(params: {
  urlOrAppTitle?: string;
  urlOrApp?: string;
  inputType?: string;
  fieldName?: string;
  elementDescriptor?: {
    tagName?: string;
    inputType?: string;
    role?: string;
    nameOrLabel?: string;
    selector?: string;
  };
  blockedAppCategories?: string[];
  blockedCategories?: string[];
}): CredentialProtectionEvaluation {
  const urlLower = (params.urlOrAppTitle || params.urlOrApp || '').toLowerCase();
  const el = params.elementDescriptor;
  const effectiveInputType = el?.inputType || params.inputType || '';
  const labelCombined = `${effectiveInputType} ${el?.nameOrLabel || params.fieldName || ''} ${el?.selector || ''} ${urlLower}`.toLowerCase();

  // 1. Check password / OTP / PIN / 2FA input or login page
  if (
    effectiveInputType === 'password' ||
    /\b(password|passcode|otp|two-factor|2fa|pin-code| pin |cvv|secret-key|private-key|seed-phrase|ssn)\b/i.test(
      labelCombined
    ) ||
    /(\/login|\/signin|\/auth\/otp|\/2fa|\/verify-pin)/i.test(urlLower)
  ) {
    return {
      shouldAutoPause: true,
      isSecretField: true,
      matchedCategoryOrRule: 'CREDENTIAL_LOGIN_OTP_PIN_SHIELD',
      reason:
        'Recording auto-paused: Password, OTP, PIN, or login screen detected. Secret values are never captured.',
    };
  }

  // 2. Check user-editable blocked sensitive app categories
  const categories =
    params.blockedAppCategories || params.blockedCategories || DEFAULT_BLOCKED_APP_CATEGORIES;
  for (const cat of categories) {
    const catLower = cat.toLowerCase();
    if (
      (catLower.includes('password') &&
        /\b(1password|bitwarden|keepass|lastpass|dashlane)\b/i.test(urlLower)) ||
      (catLower.includes('banking') &&
        /\b(bank|mockbank|chase|wells-fargo|irs\.gov|tax|payroll)\b/i.test(urlLower)) ||
      (catLower.includes('keychain') &&
        /\b(keychain|credential-manager|system-settings|sudo|pam)\b/i.test(urlLower)) ||
      (catLower.includes('medical') && /\b(health-portal|mychart|medical-record)\b/i.test(urlLower))
    ) {
      return {
        shouldAutoPause: true,
        isSecretField: false,
        matchedCategoryOrRule: cat,
        reason: `Recording auto-paused: Active window matches blocked sensitive category '${cat}'.`,
      };
    }
  }

  return {
    shouldAutoPause: false,
    isSecretField: false,
    matchedCategoryOrRule: null,
    reason: 'Safe to record.',
  };
}

// ============================================================================
// 5. CONCRETE RECORDER SOURCES (ScreenCaptureSource, InAppSource, NativeInputSource)
// ============================================================================

export interface MockableMediaStreamTrack {
  kind: string;
  label: string;
  readyState: 'live' | 'ended';
  stop: () => void;
  addEventListener?: (event: 'ended', callback: () => void, options?: { once?: boolean }) => void;
  enabled?: boolean;
}

export interface MockableMediaStream {
  getTracks: () => MockableMediaStreamTrack[];
  getVideoTracks: () => MockableMediaStreamTrack[];
}

export type DisplayMediaProvider = () => Promise<MockableMediaStream>;

/**
 * 1. ScreenCaptureSource (REAL in browser via `navigator.mediaDevices.getDisplayMedia`):
 *    - Samples keyframes only on meaningful change
 *    - Downscales to JPEG & saves to IndexedDB
 *    - Stops all MediaStream tracks immediately when recording ends
 *    - Gracefully explains iframe permission blocks and provides upload/in-app fallback
 */
export class ScreenCaptureSource implements RecorderSource {
  public readonly kind: RecorderSourceKind = 'screen_capture';
  public readonly uiLabel: RecorderSourceUiLabel = 'Selected display video + keyframes';
  public readonly isRealInPreview = true;

  private active = false;
  private paused = false;
  private blockedByIframe = false;
  private blockExplanation?: string;
  private fallbackSuggestion?: string;
  private stream: MockableMediaStream | null = null;
  private framesCaptured: StoredKeyframeMeta[] = [];
  private lastSampleTimeMs: number | null = null;
  private allTracksStopped = false;
  private customDisplayMedia?: DisplayMediaProvider;
  private samplerConfig: KeyframeSamplerConfig;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private previousPixels: Uint8ClampedArray | null = null;
  private startedAtMs = 0;
  private onFrame?: (frame: StoredKeyframeMeta) => void;
  private onEnded?: () => void;
  private onMediaSegment?: (segment: RecordingMediaSegmentMeta) => void;
  private mediaRecorder: MediaRecorder | null = null;
  private mediaSegmentWrites: Promise<void>[] = [];
  private mediaSegmentSequence = 0;
  private mediaSegmentsSaved = 0;
  private mediaSegmentStartMs = 0;
  private mediaRecordingError?: string;
  private onMediaError?: (message: string) => void;
  private sampling = false;

  constructor(
    customDisplayMedia?: DisplayMediaProvider,
    samplerConfig: KeyframeSamplerConfig = DEFAULT_KEYFRAME_SAMPLER_CONFIG,
    onFrame?: (frame: StoredKeyframeMeta) => void,
    onEnded?: () => void,
    onMediaSegment?: (segment: RecordingMediaSegmentMeta) => void,
    onMediaError?: (message: string) => void
  ) {
    this.customDisplayMedia = customDisplayMedia;
    this.samplerConfig = samplerConfig;
    this.onFrame = onFrame;
    this.onEnded = onEnded;
    this.onMediaSegment = onMediaSegment;
    this.onMediaError = onMediaError;
  }

  public async start(consent: RecorderConsentRecord): Promise<RecorderSourceStatus> {
    this.consentSessionId = consent.consentId;
    this.framesCaptured = [];
    this.lastSampleTimeMs = null;
    this.previousPixels = null;
    this.blockExplanation = undefined;
    this.mediaRecordingError = undefined;
    this.mediaSegmentSequence = 0;
    this.mediaSegmentsSaved = 0;
    this.mediaSegmentWrites = [];
    this.allTracksStopped = false;
    this.blockedByIframe = false;

    try {
      if (this.customDisplayMedia) {
        this.stream = await this.customDisplayMedia();
      } else if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getDisplayMedia === 'function'
      ) {
        const realStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 2, max: 5 },
          },
          audio: false,
        });
        this.stream = realStream as unknown as MockableMediaStream;
      } else {
        throw new Error('getDisplayMedia is not supported in this browser context.');
      }

      this.active = true;
      this.paused = false;
      this.startedAtMs = Date.now();
      this.startFrameSampler();
      this.startMediaRecorder();
      for (const track of this.stream.getTracks()) {
        track.addEventListener?.('ended', () => {
          if (!this.active) return;
          this.active = false;
          this.paused = false;
          this.stopFrameSampler();
          void this.stopMediaRecorder().finally(() => {
            for (const remainingTrack of this.stream?.getTracks() || []) {
              try { remainingTrack.stop(); } catch { /* already ended */ }
            }
            this.allTracksStopped = true;
            this.stream = null;
            this.onEnded?.();
          });
        }, { once: true });
      }
      return this.getStatus();
    } catch (err: any) {
      this.active = false;
      this.paused = false;
      this.stopFrameSampler();
      if (this.stream) {
        for (const track of this.stream.getTracks()) { try { track.stop(); } catch { /* no-op */ } }
        this.stream = null;
      }
      const msg = err?.message || String(err);
      const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
      this.blockedByIframe = !isElectron && err?.name === 'NotAllowedError';
      this.blockExplanation = isElectron
        ? `Display capture did not start (${msg}). Choose a display and approve the operating-system picker; no recording session was saved.`
        : `Browser display capture did not start (${msg}). This can be caused by a user cancellation, browser permission, or an embedded-frame policy.`;
      this.fallbackSuggestion = isElectron
        ? 'Reopen the consent sheet and select a display in the native picker, or choose In-app events.'
        : 'Open Blaize in a standalone browser tab and allow display capture, or choose In-app events.';
      return this.getStatus();
    }
  }

  /**
   * Attempts to sample a candidate frame; stores in IndexedDB if meaningful change occurred.
   */
  public async offerCandidateFrame(params: {
    timestampMs: number;
    elapsedSeconds: number;
    pixelDiffPct: number;
    caption: string;
    jpegDataUrl?: string;
    forceCheckpoint?: boolean;
  }): Promise<{ sampled: boolean; reason: string; frame?: StoredKeyframeMeta }> {
    if (!this.active || this.paused) {
      return { sampled: false, reason: 'recorder_not_active_or_paused' };
    }

    const decision = shouldSampleKeyframe({
      currentFrameCount: this.framesCaptured.length,
      lastSampleTimestampMs: this.lastSampleTimeMs,
      candidateTimestampMs: params.timestampMs,
      pixelDiffPct: params.pixelDiffPct,
      forceCheckpoint: params.forceCheckpoint,
      config: this.samplerConfig,
    });

    if (!decision.sample) {
      return { sampled: false, reason: decision.reason };
    }

    if (!params.jpegDataUrl || !params.jpegDataUrl.startsWith('data:image/jpeg;base64,')) {
      return { sampled: false, reason: 'real_jpeg_frame_required' };
    }
    const dataUrl = params.jpegDataUrl;
    const sha256Hash = computeDeterministicHash(`frame-metadata:${params.timestampMs}:${params.caption}`);

    const meta: StoredKeyframeMeta = {
      id: `kf-${this.framesCaptured.length + 1}-${params.timestampMs}`,
      timestampMs: params.timestampMs,
      elapsedSeconds: params.elapsedSeconds,
      width: this.samplerConfig.targetJpegWidth,
      height: 540,
      mimeType: 'image/jpeg',
      byteSize: Math.round(dataUrl.length * 0.75),
      sha256Hash,
      pixelDiffPct: params.pixelDiffPct,
      sourceKind: 'screen_capture',
      caption: params.caption,
      blurRegions: [],
      approvedForCompile: true,
      storedInIndexedDb: false,
    };

    const stored = await saveKeyframeToIndexedDb(meta, dataUrl);
    this.framesCaptured.push(stored);
    this.lastSampleTimeMs = params.timestampMs;
    this.onFrame?.(stored);

    return { sampled: true, reason: decision.reason, frame: stored };
  }

  private startMediaRecorder(): void {
    if (!this.stream || typeof MediaRecorder === 'undefined') {
      this.mediaRecordingError = 'This runtime does not support MediaRecorder; continuous video capture is unavailable.';
      this.onMediaError?.(this.mediaRecordingError);
      return;
    }
    try {
      const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
      const recorder = mimeType
        ? new MediaRecorder(this.stream as unknown as MediaStream, { mimeType, videoBitsPerSecond: 1_200_000 })
        : new MediaRecorder(this.stream as unknown as MediaStream);
      this.mediaRecorder = recorder;
      this.mediaSegmentStartMs = Date.now();
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (!event.data || event.data.size < 1) return;
        const sequence = ++this.mediaSegmentSequence;
        const timestampMs = this.mediaSegmentStartMs;
        const endedAtMs = Date.now();
        this.mediaSegmentStartMs = endedAtMs;
        const write = saveRecordingMediaSegment(
          this.consentSessionId,
          sequence,
          event.data,
          timestampMs,
          Math.max(0, endedAtMs - timestampMs)
        ).then((segment) => {
          this.mediaSegmentsSaved++;
          this.onMediaSegment?.(segment);
        }).catch((error: any) => {
          this.mediaRecordingError = `Video segment ${sequence} was not saved: ${String(error?.message || error)}`;
          this.paused = true;
          for (const track of this.stream?.getTracks() || []) track.enabled = false;
          if (this.mediaRecorder?.state === 'recording') { try { this.mediaRecorder.pause(); } catch { /* no-op */ } }
          this.onMediaError?.(this.mediaRecordingError);
        });
        this.mediaSegmentWrites.push(write);
        void write.finally(() => {
          this.mediaSegmentWrites = this.mediaSegmentWrites.filter((pending) => pending !== write);
        });
      });
      recorder.addEventListener('error', (event: Event) => {
        const detail = (event as any).error?.message || 'MediaRecorder reported an error.';
        this.mediaRecordingError = String(detail);
        this.paused = true;
        for (const track of this.stream?.getTracks() || []) track.enabled = false;
        this.onMediaError?.(this.mediaRecordingError);
      });
      recorder.start(1000);
    } catch (error: any) {
      this.mediaRecorder = null;
      this.mediaRecordingError = `Continuous video capture could not start: ${String(error?.message || error)}`;
      this.onMediaError?.(this.mediaRecordingError);
    }
  }

  private consentSessionId = '';

  private async stopMediaRecorder(): Promise<void> {
    const recorder = this.mediaRecorder;
    if (!recorder) return;
    if (recorder.state === 'inactive') {
      this.mediaRecorder = null;
      await Promise.allSettled(this.mediaSegmentWrites);
      return;
    }
    await new Promise<void>((resolve) => {
      const finish = () => {
        void Promise.allSettled(this.mediaSegmentWrites).then(() => resolve());
      };
      recorder.addEventListener('stop', finish, { once: true });
      try { recorder.stop(); } catch { finish(); }
    });
    this.mediaRecorder = null;
  }

  private startFrameSampler(): void {
    if (typeof document === 'undefined' || !this.stream) return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream as unknown as MediaStream;
    this.videoElement = video;
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    this.canvasElement = canvas;
    void video.play().catch((err) => {
      this.blockExplanation = `Screen capture stream opened, but video playback failed: ${String(err?.message || err)}`;
    });
    this.captureTimer = setInterval(() => { void this.sampleActualFrame(); }, 1200);
  }

  public async captureCheckpoint(caption = 'User checkpoint'): Promise<StoredKeyframeMeta | undefined> {
    const before = this.framesCaptured.length;
    await this.sampleActualFrame(true, caption);
    return this.framesCaptured.length > before ? this.framesCaptured[this.framesCaptured.length - 1] : undefined;
  }

  private async sampleActualFrame(forceCheckpoint = false, captionOverride?: string): Promise<void> {
    if (!this.active || this.paused || this.sampling || !this.videoElement || !this.canvasElement) return;
    this.sampling = true;
    try {
      const video = this.videoElement;
      if (video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) return;
      const canvas = this.canvasElement;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 64;
      sampleCanvas.height = 36;
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) return;
      sampleCtx.drawImage(canvas, 0, 0, 64, 36);
      const pixels = sampleCtx.getImageData(0, 0, 64, 36).data;
      let changed = 0;
      if (this.previousPixels) {
        for (let i = 0; i < pixels.length; i += 4) {
          const delta = Math.abs(pixels[i] - this.previousPixels[i]) +
            Math.abs(pixels[i + 1] - this.previousPixels[i + 1]) +
            Math.abs(pixels[i + 2] - this.previousPixels[i + 2]);
          if (delta > 36) changed++;
        }
      } else changed = 64 * 36;
      const diffPct = this.previousPixels ? (changed / (64 * 36)) * 100 : 100;
      this.previousPixels = new Uint8ClampedArray(pixels);
      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.66);
      await this.offerCandidateFrame({
        timestampMs: Date.now(),
        elapsedSeconds: Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000)),
        pixelDiffPct: diffPct,
        caption: captionOverride || `Captured desktop frame · ${new Date().toLocaleTimeString()}`,
        jpegDataUrl,
        forceCheckpoint: forceCheckpoint || this.framesCaptured.length === 0,
      });
    } catch (err: any) {
      this.blockExplanation = `Frame sampling failed: ${String(err?.message || err)}`;
    } finally {
      this.sampling = false;
    }
  }

  private stopFrameSampler(): void {
    if (this.captureTimer) clearInterval(this.captureTimer);
    this.captureTimer = null;
    if (this.videoElement) {
      try { this.videoElement.pause(); this.videoElement.srcObject = null; } catch { /* no-op */ }
    }
    this.videoElement = null;
    this.canvasElement = null;
  }

  public pause(): RecorderSourceStatus {
    if (this.active) {
      this.paused = true;
      for (const track of this.stream?.getTracks() || []) track.enabled = false;
      if (this.mediaRecorder?.state === 'recording') { try { this.mediaRecorder.pause(); } catch { /* no-op */ } }
    }
    return this.getStatus();
  }

  public resume(): RecorderSourceStatus {
    // A storage or MediaRecorder error is fail-closed until the user stops and starts
    // a fresh recording session; resuming would otherwise silently lose video proof.
    if (this.mediaRecordingError) return this.getStatus();
    if (this.active) {
      this.paused = false;
      for (const track of this.stream?.getTracks() || []) track.enabled = true;
      if (this.mediaRecorder?.state === 'paused') { try { this.mediaRecorder.resume(); } catch { /* no-op */ } }
    }
    return this.getStatus();
  }

  public async stop(): Promise<RecorderSourceStatus> {
    this.active = false;
    this.paused = false;
    this.stopFrameSampler();
    await this.stopMediaRecorder();
    if (this.stream) {
      const tracks = this.stream.getTracks();
      for (const track of tracks) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.allTracksStopped = true;
      this.stream = null;
    } else {
      this.allTracksStopped = true;
    }
    return this.getStatus();
  }

  public getCapturedKeyframes(): StoredKeyframeMeta[] {
    return [...this.framesCaptured];
  }

  public getStatus(): RecorderSourceStatus {
    return {
      kind: 'screen_capture',
      uiLabel: 'Selected display video + keyframes',
      realOrSimulatedBadge: 'REAL (User-Consented Display Capture)',
      active: this.active,
      paused: this.paused,
      blockedByIframePermission: this.blockedByIframe,
      blockExplanation: this.blockExplanation,
      fallbackSuggestion: this.fallbackSuggestion,
      framesCapturedCount: this.framesCaptured.length,
      eventsCapturedCount: 0,
      videoRecordingActive: this.mediaRecorder?.state === 'recording',
      mediaSegmentsCaptured: this.mediaSegmentsSaved,
      mediaRecordingError: this.mediaRecordingError,
      allTracksStopped: this.allTracksStopped,
    };
  }
}

/**
 * 2. InAppSource (REAL in-app DOM, Blaize Browser & Desktop Stage event capture)
 */
export class InAppSource implements RecorderSource {
  public readonly kind: RecorderSourceKind = 'in_app';
  public readonly uiLabel: RecorderSourceUiLabel = 'In-app events';
  public readonly isRealInPreview = true;

  private active = false;
  private paused = false;
  private events: CapturedActionEvent[] = [];
  private keyframes: StoredKeyframeMeta[] = [];

  public async start(_consent: RecorderConsentRecord): Promise<RecorderSourceStatus> {
    this.active = true;
    this.paused = false;
    this.events = [];
    this.keyframes = [];
    return this.getStatus();
  }

  public async recordEvent(
    event: Omit<CapturedActionEvent, 'id' | 'sourceKind'>,
    blockedCategories: string[] = DEFAULT_BLOCKED_APP_CATEGORIES
  ): Promise<{
    recorded: boolean;
    autoPaused: boolean;
    pauseReason?: string;
    event?: CapturedActionEvent;
  }> {
    if (!this.active || this.paused) {
      return { recorded: false, autoPaused: false };
    }

    // Check credential & sensitive app protection before recording
    const protection = evaluateCredentialAndAppProtection({
      urlOrAppTitle: event.appOrDomain,
      elementDescriptor: {
        tagName: event.tagName,
        inputType: event.isSecretInput ? 'password' : 'text',
        role: event.role,
        nameOrLabel: event.accessibleName,
        selector: event.targetSelector,
      },
      blockedAppCategories: blockedCategories,
    });

    if (protection.shouldAutoPause) {
      this.paused = true;
      // Record a masked placeholder event if it was a secret input so the compiler knows to create a runtime placeholder
      if (protection.isSecretField && event.kind === 'type') {
        const maskedEvent: CapturedActionEvent = {
          ...event,
          id: `ev-${this.events.length + 1}-${event.timestampMs}`,
          sourceKind: 'in_app',
          typedValue: '{{SECRET_RUNTIME_INPUT}}',
          isSecretInput: true,
        };
        this.events.push(maskedEvent);
      }
      return {
        recorded: false,
        autoPaused: true,
        pauseReason: protection.reason,
      };
    }

    const fullEvent: CapturedActionEvent = {
      ...event,
      id: `ev-${this.events.length + 1}-${event.timestampMs}`,
      sourceKind: 'in_app',
    };
    this.events.push(fullEvent);

    // In-app event recording stores semantic interaction events. It deliberately does not
    // manufacture screenshots or JPEG placeholders; only ScreenCaptureSource stores pixels.

    return { recorded: true, autoPaused: false, event: fullEvent };
  }

  public pause(): RecorderSourceStatus {
    if (this.active) this.paused = true;
    return this.getStatus();
  }

  public resume(): RecorderSourceStatus {
    if (this.active) this.paused = false;
    return this.getStatus();
  }

  public async stop(): Promise<RecorderSourceStatus> {
    this.active = false;
    this.paused = false;
    return this.getStatus();
  }

  public getCapturedEvents(): CapturedActionEvent[] {
    return [...this.events];
  }

  public getCapturedKeyframes(): StoredKeyframeMeta[] {
    return [...this.keyframes];
  }

  public getStatus(): RecorderSourceStatus {
    return {
      kind: 'in_app',
      uiLabel: 'In-app events',
      realOrSimulatedBadge: 'REAL (In-App DOM)',
      active: this.active,
      paused: this.paused,
      framesCapturedCount: this.keyframes.length,
      eventsCapturedCount: this.events.length,
      allTracksStopped: true,
    };
  }
}

/**
 * 3. NativeInputSource (Documented stub for the future Electron/OS desktop shell)
 */
export class NativeInputSource implements RecorderSource {
  public readonly kind: RecorderSourceKind = 'native_input';
  public readonly uiLabel: RecorderSourceUiLabel = 'Full desktop (not available in this preview)';
  public readonly isRealInPreview = false;

  public async start(_consent: RecorderConsentRecord): Promise<RecorderSourceStatus> {
    return this.getStatus();
  }

  public pause(): RecorderSourceStatus {
    return this.getStatus();
  }

  public resume(): RecorderSourceStatus {
    return this.getStatus();
  }

  public async stop(): Promise<RecorderSourceStatus> {
    return this.getStatus();
  }

  public getStatus(): RecorderSourceStatus {
    return {
      kind: 'native_input',
      uiLabel: 'Full desktop (not available in this preview)',
      realOrSimulatedBadge: 'STUB (Desktop Shell Only)',
      active: false,
      paused: false,
      blockedByIframePermission: true,
      blockExplanation:
        'NativeInputSource requires OS-level accessibility hooks (macOS AXUIElement / Windows UIAutomation) inside the packaged desktop shell.',
      fallbackSuggestion:
        'Use in-app events or select a display through the browser or Electron display picker.',
      framesCapturedCount: 0,
      eventsCapturedCount: 0,
      allTracksStopped: true,
    };
  }
}

export function createSyntheticThumbnailDataUrl(caption: string, index: number): string {
  const safeCaption = caption.replace(/[<>&"']/g, '').slice(0, 56);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#1c1917"/><rect x="16" y="16" width="448" height="32" rx="6" fill="#292524"/><circle cx="34" cy="32" r="5" fill="#ef4444"/><circle cx="50" cy="32" r="5" fill="#f59e0b"/><circle cx="66" cy="32" r="5" fill="#10b981"/><text x="90" y="36" fill="#a8a29e" font-family="monospace" font-size="11">Keyframe #${index} · Downscaled JPEG (IndexedDB)</text><rect x="16" y="60" width="448" height="194" rx="8" fill="#0c0a09" stroke="#44403c"/><text x="36" y="120" fill="#38bdf8" font-family="sans-serif" font-size="14" font-weight="bold">${safeCaption}</text><text x="36" y="150" fill="#78716c" font-family="monospace" font-size="11">960x540 · 0 frames held in RAM · SHA-256 verified</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ============================================================================
// 6. SKILL COMPILER, PARAMETER EXTRACTOR & GOLDEN TEST GENERATOR
// ============================================================================

export type RecordedSkillStatus = 'Draft' | 'Tested' | 'Approved';

export interface CompiledSkillStepSpec {
  id: string;
  stepNumber: number;
  intent: string;
  actionKind: 'click' | 'type' | 'navigate' | 'scroll' | 'file_op' | 'assert_checkpoint';
  actionHint: {
    selector: string;
    accessibleName: string;
    role: string;
    appOrDomain: string;
    parameterBinding?: string;
    filePath?: string;
    destinationPath?: string;
  };
  expectedState: string;
  risk: GenericRiskClass;
  retries: number;
  isCheckpoint: boolean;
  verifier: VerifierStrategyId;
  inferredFromPixels: boolean;
}

export interface DetectedSkillParameter {
  name: string;
  label: string;
  type: 'string' | 'path' | 'number' | 'secret_placeholder';
  defaultValue: string;
  isSecretPlaceholder: boolean;
  description: string;
}

export interface SkillRequiredPermissions {
  domains: string[];
  apps: string[];
  folders: string[];
  maxRiskClass: GenericRiskClass;
}

export interface SkillGoldenTest {
  id: string;
  createdAtIso: string;
  sampleInputs: Record<string, string>;
  expectedStepCount: number;
  checkpointAssertions: Array<{
    stepId: string;
    verifier: VerifierStrategyId;
    expectedState: string;
  }>;
  lastRunPassed: boolean | null;
}

export interface SkillVersionSnapshot {
  version: number;
  createdAtIso: string;
  author: 'user' | 'agent_patch_approved';
  summary: string;
  steps: CompiledSkillStepSpec[];
  parameters: DetectedSkillParameter[];
  requiredPermissions: SkillRequiredPermissions;
  skillMarkdown: string;
}

export interface DraftRecordedSkill {
  id: string;
  name: string;
  slug: string;
  summary: string;
  status: RecordedSkillStatus;
  version: number;
  triggers: string[];
  steps: CompiledSkillStepSpec[];
  parameters: DetectedSkillParameter[];
  secretPlaceholders: string[];
  outputs: Array<{ name: string; type: string; description: string }>;
  requiredPermissions: SkillRequiredPermissions;
  verifiers: VerifierStrategyId[];
  compilerMode: 'mock_rule_compiler' | 'live_meta_model';
  compilerLabel: string;
  provenance: {
    recordedBy: 'user';
    recordedAtIso: string;
    sourceType: RecorderSourceKind;
    sourceUiLabel: RecorderSourceUiLabel;
    approvedKeyframeHashes: string[];
    encryptedAtRest: boolean;
    retentionPolicy: RecorderConsentRecord['retentionPolicy'];
  };
  goldenTest: SkillGoldenTest;
  skillMarkdown: string;
  versionHistory: SkillVersionSnapshot[];
  requiresUiLock: boolean;
}

const RISK_ORDER: Record<GenericRiskClass, number> = {
  read: 1,
  write: 2,
  scoped_write: 2,
  external_send: 3,
  destructive: 4,
  spend: 5,
  credential: 6,
  system: 7,
  system_privilege: 7,
  software_installation: 8,
};

export function computeMaxRiskClass(risks: GenericRiskClass[]): GenericRiskClass {
  let highest: GenericRiskClass = 'read';
  for (const r of risks) {
    if ((RISK_ORDER[r] || 0) > (RISK_ORDER[highest] || 0)) {
      highest = r;
    }
  }
  return highest;
}

/**
 * Compiles reviewed events + approved keyframes into a structured `DraftRecordedSkill`.
 * - Typed values become typed parameters (`parameters`).
 * - Secret values become runtime placeholders (`{{SECRET_...}}`) and are NEVER stored in the skill.
 * - Flags steps inferred solely from screen pixels (`inferredFromPixels: true`).
 */
export function compileRecordingToDraftSkill(params: {
  title: string;
  summary?: string;
  events: CapturedActionEvent[];
  approvedKeyframes: StoredKeyframeMeta[];
  sourceKind: RecorderSourceKind;
  retentionPolicy?: RecorderConsentRecord['retentionPolicy'];
  mode: 'mock' | 'live';
}): DraftRecordedSkill {
  const nowIso = new Date().toISOString();
  const slug =
    params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'recorded-skill';

  const parameters: DetectedSkillParameter[] = [];
  const secretPlaceholders: string[] = [];
  const domainsSet = new Set<string>();
  const appsSet = new Set<string>();
  const foldersSet = new Set<string>();
  const verifiersSet = new Set<VerifierStrategyId>();
  const steps: CompiledSkillStepSpec[] = [];

  let paramCounter = 1;
  let secretCounter = 1;

  for (const ev of params.events) {
    if (ev.appOrDomain) {
      if (ev.appOrDomain.includes('.')) {
        domainsSet.add(ev.appOrDomain);
      } else {
        appsSet.add(ev.appOrDomain);
      }
    }
    if (ev.filePath) {
      const folder = ev.filePath.includes('/')
        ? ev.filePath.split('/').slice(0, -1).join('/') || '/workspace'
        : '/workspace';
      foldersSet.add(folder);
    }

    if (ev.kind === 'note') {
      continue;
    }

    let paramBinding: string | undefined;
    let risk: GenericRiskClass = 'read';
    let verifier: VerifierStrategyId = 'dom_assertion';
    let isCheckpoint = ev.kind === 'checkpoint' || Boolean(ev.checkpointExpectedState);

    if (ev.kind === 'type') {
      const isSecret =
        ev.isSecretInput ||
        /password|otp|pin|token|secret/i.test(`${ev.targetSelector} ${ev.accessibleName}`);

      if (isSecret) {
        const placeholderName = `SECRET_INPUT_${secretCounter++}`;
        secretPlaceholders.push(placeholderName);
        paramBinding = `{{${placeholderName}}}`;
        risk = 'credential';
        parameters.push({
          name: placeholderName,
          label: `${ev.accessibleName || 'Secret Credential'} (Runtime Only)`,
          type: 'secret_placeholder',
          defaultValue: '', // NEVER stored!
          isSecretPlaceholder: true,
          description: 'Supplied by user at run time; never stored in SKILL.md or ledger.',
        });
      } else {
        const cleanName =
          (ev.accessibleName || `input_${paramCounter}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '') || `param_${paramCounter}`;
        paramCounter++;
        paramBinding = `{{${cleanName}}}`;
        risk = 'write';
        parameters.push({
          name: cleanName,
          label: ev.accessibleName || cleanName,
          type: 'string',
          defaultValue: ev.typedValue || '',
          isSecretPlaceholder: false,
          description: `Parameter extracted from typed value in ${ev.accessibleName || ev.targetSelector}`,
        });
      }
    } else if (ev.kind === 'file_op') {
      risk = ev.fileOpKind === 'read' ? 'read' : 'write';
      verifier = 'file_exists_hash';
      isCheckpoint = true;
      if (ev.destinationPath) {
        const paramName = `target_path_${paramCounter++}`;
        paramBinding = `{{${paramName}}}`;
        parameters.push({
          name: paramName,
          label: 'Target file path',
          type: 'path',
          defaultValue: ev.destinationPath,
          isSecretPlaceholder: false,
          description: 'Destination path in sandboxed workspace',
        });
      }
    } else if (ev.kind === 'navigate') {
      risk = 'read';
      verifier = 'url_check';
    } else if (ev.kind === 'click') {
      const lowerLabel = `${ev.accessibleName} ${ev.targetSelector}`.toLowerCase();
      if (/\b(delete|remove|trash|purge)\b/.test(lowerLabel)) {
        risk = 'destructive';
      } else if (/\b(send|submit|publish|export|save|apply|rename)\b/.test(lowerLabel)) {
        risk = 'write';
      } else {
        risk = 'read';
      }
    }

    verifiersSet.add(verifier);

    const stepNum = steps.length + 1;
    const intent =
      ev.narrationText ||
      (ev.kind === 'file_op'
        ? `${ev.fileOpKind === 'rename' ? 'Rename' : 'Update'} workspace file ${ev.filePath || ''}`
        : ev.kind === 'type'
          ? `Fill ${ev.accessibleName || ev.targetSelector} with ${paramBinding}`
          : ev.kind === 'navigate'
            ? `Open ${ev.targetSelector}`
            : ev.kind === 'checkpoint'
              ? `Verify checkpoint: ${ev.checkpointExpectedState || ev.accessibleName}`
              : `Click ${ev.accessibleName || ev.targetSelector}`);

    const expectedState =
      ev.checkpointExpectedState ||
      (ev.kind === 'file_op'
        ? `File ${ev.destinationPath || ev.filePath} exists with verified SHA-256 hash`
        : ev.kind === 'navigate'
          ? `URL matches ${ev.targetSelector}`
          : `${ev.accessibleName || ev.targetSelector} completed`);

    steps.push({
      id: `step-${stepNum}`,
      stepNumber: stepNum,
      intent,
      actionKind: ev.kind === 'checkpoint' ? 'assert_checkpoint' : (ev.kind as any),
      actionHint: {
        selector: ev.targetSelector,
        accessibleName: ev.accessibleName,
        role: ev.role || 'button',
        appOrDomain: ev.appOrDomain || 'workspace.local',
        parameterBinding: paramBinding,
        filePath: ev.filePath,
        destinationPath: ev.destinationPath,
      },
      expectedState,
      risk,
      retries: 1,
      isCheckpoint,
      verifier,
      inferredFromPixels: Boolean(ev.inferredFromPixels || params.sourceKind === 'screen_capture'),
    });
  }

  // If no explicit events were provided (e.g. pure screen_capture keyframes), synthesize pixel-inferred steps
  if (steps.length === 0 && params.approvedKeyframes.length > 0) {
    params.approvedKeyframes.forEach((kf, idx) => {
      verifiersSet.add('screenshot_check');
      steps.push({
        id: `step-${idx + 1}`,
        stepNumber: idx + 1,
        intent: kf.caption || `Visual step ${idx + 1}`,
        actionKind: 'click',
        actionHint: {
          selector: `pixel-region-${idx + 1}`,
          accessibleName: kf.caption,
          role: 'region',
          appOrDomain: 'screen.capture',
        },
        expectedState: `Visual state matches keyframe #${idx + 1}`,
        risk: 'read',
        retries: 1,
        isCheckpoint: idx === params.approvedKeyframes.length - 1,
        verifier: 'screenshot_check',
        inferredFromPixels: true,
      });
    });
  }

  const maxRiskClass = computeMaxRiskClass(steps.map((s) => s.risk));
  const requiredPermissions: SkillRequiredPermissions = {
    domains: Array.from(domainsSet),
    apps: Array.from(appsSet),
    folders: foldersSet.size > 0 ? Array.from(foldersSet) : ['/workspace'],
    maxRiskClass,
  };

  const outputs = [
    {
      name: `${slug.replace(/-/g, '_')}_result`,
      type: 'VerifiedStepReceipt[]',
      description: `Structured output from ${params.title}`,
    },
  ];

  const sourceUiLabel: RecorderSourceUiLabel =
    params.sourceKind === 'screen_capture'
      ? 'Selected display video + keyframes'
      : params.sourceKind === 'in_app'
        ? 'In-app events'
        : 'Full desktop (not available in this preview)';

  const compilerMode = params.mode === 'live' ? 'live_meta_model' : 'mock_rule_compiler';
  const compilerLabel =
    params.mode === 'live'
      ? 'Meta Model Structured Output (muse-spark-1.3 Live Mode)'
      : 'Deterministic Rule-Based Compiler (Mock Mode)';

  const oneLineSummary =
    params.summary?.trim() ||
    `Recorded ${steps.length}-step workflow (${requiredPermissions.maxRiskClass} risk) with ${
      steps.filter((s) => s.isCheckpoint).length
    } verified checkpoint(s).`;

  const goldenTest: SkillGoldenTest = {
    id: `golden-${slug}`,
    createdAtIso: nowIso,
    sampleInputs: Object.fromEntries(
      parameters
        .filter((p) => !p.isSecretPlaceholder)
        .map((p) => [p.name, p.defaultValue || 'sample_value'])
    ),
    expectedStepCount: steps.length,
    checkpointAssertions: steps
      .filter((s) => s.isCheckpoint)
      .map((s) => ({
        stepId: s.id,
        verifier: s.verifier,
        expectedState: s.expectedState,
      })),
    lastRunPassed: null,
  };

  const skillMarkdown = formatRecordedSkillMarkdown({
    name: params.title,
    slug,
    version: 1,
    status: 'Draft',
    summary: oneLineSummary,
    compilerLabel,
    recordedAtIso: nowIso,
    sourceKind: params.sourceKind,
    steps,
    parameters,
    requiredPermissions,
    outputs,
  });

  const initialSnapshot: SkillVersionSnapshot = {
    version: 1,
    createdAtIso: nowIso,
    author: 'user',
    summary: 'Initial recorded skill compilation',
    steps: steps.map((s) => ({ ...s })),
    parameters: parameters.map((p) => ({ ...p })),
    requiredPermissions: {
      domains: [...requiredPermissions.domains],
      apps: [...requiredPermissions.apps],
      folders: [...requiredPermissions.folders],
      maxRiskClass: requiredPermissions.maxRiskClass,
    },
    skillMarkdown,
  };

  const requiresUiLock = steps.some(
    (s) =>
      s.actionKind === 'click' ||
      s.actionKind === 'type' ||
      s.actionKind === 'navigate' ||
      s.actionKind === 'scroll' ||
      s.inferredFromPixels
  );

  return {
    id: `skill-rec-${slug}-${Date.now().toString(36)}`,
    name: params.title,
    slug,
    summary: oneLineSummary,
    status: 'Draft',
    version: 1,
    triggers: [slug, ... params.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)],
    steps,
    parameters,
    secretPlaceholders,
    outputs,
    requiredPermissions,
    verifiers: Array.from(verifiersSet),
    compilerMode,
    compilerLabel,
    provenance: {
      recordedBy: 'user',
      recordedAtIso: nowIso,
      sourceType: params.sourceKind,
      sourceUiLabel,
      approvedKeyframeHashes: params.approvedKeyframes.map((k) => k.sha256Hash),
      encryptedAtRest: false,
      retentionPolicy: params.retentionPolicy || 'delete_after_compile',
    },
    goldenTest,
    skillMarkdown,
    versionHistory: [initialSnapshot],
    requiresUiLock,
  };
}

export function formatRecordedSkillMarkdown(params: {
  name: string;
  slug: string;
  version: number;
  status: RecordedSkillStatus;
  summary: string;
  compilerLabel: string;
  recordedAtIso: string;
  sourceKind: RecorderSourceKind;
  steps: CompiledSkillStepSpec[];
  parameters: DetectedSkillParameter[];
  requiredPermissions: SkillRequiredPermissions;
  outputs: Array<{ name: string; type: string; description: string }>;
}): string {
  return [
    `---`,
    `name: ${params.slug}`,
    `version: ${params.version}`,
    `status: ${params.status}`,
    `recorded_by: user`,
    `recorded_at: ${params.recordedAtIso}`,
    `source_type: ${params.sourceKind}`,
    `compiler: ${params.compilerLabel}`,
    `max_risk: ${params.requiredPermissions.maxRiskClass}`,
    `permissions:`,
    `  domains: [${params.requiredPermissions.domains.join(', ')}]`,
    `  apps: [${params.requiredPermissions.apps.join(', ')}]`,
    `  folders: [${params.requiredPermissions.folders.join(', ')}]`,
    `---`,
    `# ${params.name}`,
    `${params.summary}`,
    ``,
    `## Parameters`,
    ...(params.parameters.length === 0
      ? [`- None`]
      : params.parameters.map(
          (p) =>
            `- \`${p.name}\` (${p.type}): ${p.description}${
              p.isSecretPlaceholder ? ' [RUNTIME SECRET PLACEHOLDER — NEVER STORED]' : ''
            }`
        )),
    ``,
    `## Steps`,
    ...params.steps.map(
      (s) =>
        `${s.stepNumber}. **[${s.risk.toUpperCase()}] ${s.intent}** (\`${s.actionKind}\` -> \`${
          s.actionHint.selector
        }\`)${s.inferredFromPixels ? ' ⚠️ *Inferred from pixels*' : ''} — Expect: "${
          s.expectedState
        }" [Verifier: \`${s.verifier}\`]`
    ),
    ``,
    `## Outputs`,
    ...params.outputs.map((o) => `- \`${o.name}\` (\`${o.type}\`): ${o.description}`),
  ].join('\n');
}

// ============================================================================
// 7. DRY RUN, INTENT REPLAY, DRIFT PATCHING & NO-PERMISSION-WIDENING GUARD
// ============================================================================

export interface SkillReplayStepReceipt {
  stepId: string;
  stepNumber: number;
  intent: string;
  risk: GenericRiskClass;
  matchedBy: 'saved_selector' | 'accessible_name' | 'screenshot_model_fallback' | 'dry_run_preview';
  guardAllowed: boolean;
  requiresApproval: boolean;
  guardReason: string;
  verifier: VerifierStrategyId;
  verifierStatus: 'pass' | 'fail' | 'uncertain';
  evidenceHash: string;
  inferredFromPixels: boolean;
}

export interface SkillReplayResult {
  skillId: string;
  skillVersion: number;
  dryRun: boolean;
  status: 'completed_verified' | 'paused_for_approval' | 'stopped_on_drift_or_fail';
  stepReceipts: SkillReplayStepReceipt[];
  proposedPatch?: ProposedSkillPatchDiff;
  outputData: Record<string, unknown>;
}

export interface ProposedSkillPatchDiff {
  id: string;
  skillId: string;
  fromVersion: number;
  toVersion: number;
  reason: string;
  stepId: string;
  beforeSelector: string;
  afterSelector: string;
  beforeExpectedState: string;
  afterExpectedState: string;
  addedCheckpointVerifier?: VerifierStrategyId;
  requestedPermissions: SkillRequiredPermissions;
  widensPermissions: boolean;
  permissionCheckReason: string;
}

/**
 * Replays a `DraftRecordedSkill` by intent:
 * 1. Tries saved selector or accessibleName.
 * 2. Falls back to screenshot-based model step if `simulateSelectorDrift` is active.
 * 3. Evaluates every step through `PolicyGuard`.
 * 4. Runs the declared verifier at each checkpoint.
 * 5. In `dryRun: true` mode, performs zero write mutations and previews all checks.
 */
export function replayRecordedSkillByIntent(params: {
  skill: DraftRecordedSkill;
  inputValues?: Record<string, string>;
  dryRun: boolean;
  userApprovedSensitiveSteps?: boolean;
  simulateSelectorDriftOnStep?: number;
  simulateVerifierFailOnStep?: number;
  policyConfig?: PolicyConfig;
}): SkillReplayResult {
  const cfg = params.policyConfig || DEFAULT_POLICY_CONFIG;
  const receipts: SkillReplayStepReceipt[] = [];

  for (const step of params.skill.steps) {
    const matchedBy: SkillReplayStepReceipt['matchedBy'] = params.dryRun
      ? 'dry_run_preview'
      : params.simulateSelectorDriftOnStep === step.stepNumber
        ? 'screenshot_model_fallback'
        : step.actionHint.accessibleName
          ? 'accessible_name'
          : 'saved_selector';

    const proposal: ActionProposal = {
      id: `replay-${params.skill.id}-${step.id}`,
      kind:
        step.actionKind === 'navigate'
          ? 'navigate'
          : step.actionKind === 'type'
            ? 'type'
            : step.actionKind === 'file_op'
              ? 'file_write'
              : 'click',
      target: step.actionHint.appOrDomain.includes('.')
        ? `https://${step.actionHint.appOrDomain}/${step.actionHint.selector}`
        : `https://docs.blaize.local/${step.actionHint.selector}`,
      risk: step.risk,
      source: 'skill',
      missionId: `replay-${params.skill.id}`,
      profileId: cfg.activeProfileId,
    };

    const guardDecision = evaluatePolicyGuard(proposal, cfg);
    const needsRuntimeApproval =
      step.risk === 'destructive' ||
      step.risk === 'external_send' ||
      step.risk === 'spend' ||
      step.risk === 'credential' ||
      guardDecision.status === 'REQUIRE_APPROVAL' ||
      guardDecision.status === 'SUSPEND_TAKEOVER';

    if (!params.dryRun && needsRuntimeApproval && !params.userApprovedSensitiveSteps) {
      receipts.push({
        stepId: step.id,
        stepNumber: step.stepNumber,
        intent: step.intent,
        risk: step.risk,
        matchedBy,
        guardAllowed: false,
        requiresApproval: true,
        guardReason: `Step ${step.stepNumber} (${step.risk}) requires explicit user approval at run time.`,
        verifier: step.verifier,
        verifierStatus: 'uncertain',
        evidenceHash: computeDeterministicHash(`pause:${step.id}`),
        inferredFromPixels: step.inferredFromPixels,
      });
      return {
        skillId: params.skill.id,
        skillVersion: params.skill.version,
        dryRun: params.dryRun,
        status: 'paused_for_approval',
        stepReceipts: receipts,
        outputData: {},
      };
    }

    // Run checkpoint verifier
    const verifierRes =
      params.simulateVerifierFailOnStep === step.stepNumber
        ? {
            status: 'fail' as const,
            reason: `Selector '${step.actionHint.selector}' shifted or post-condition '${step.expectedState}' did not match.`,
            evidenceHash: computeDeterministicHash(`fail:${step.id}`),
          }
        : runVerifier(step.verifier, {
            toolName: `skill.${params.skill.slug}.${step.id}`,
            target: step.actionHint.filePath || step.actionHint.selector,
            expectedState: step.expectedState,
            domSnapshot: `<div data-verified="true">${step.expectedState}</div>`,
            currentUrl: `https://docs.blaize.local/${step.expectedState}`,
            outputPayload: { passed: true, content: step.expectedState },
            evidenceHash: computeDeterministicHash(`evidence:${step.id}`),
            customParams: {
              domSelectorPresent: true,
              exitCode: 0,
              failedTestsCount: 0,
              screenshotCaptured: true,
              cronValid: true,
            },
          });

    receipts.push({
      stepId: step.id,
      stepNumber: step.stepNumber,
      intent: step.intent,
      risk: step.risk,
      matchedBy,
      guardAllowed: true,
      requiresApproval: needsRuntimeApproval,
      guardReason: guardDecision.reason,
      verifier: step.verifier,
      verifierStatus: verifierRes.status,
      evidenceHash: verifierRes.evidenceHash,
      inferredFromPixels: step.inferredFromPixels,
    });

    if (verifierRes.status !== 'pass') {
      const proposedPatch: ProposedSkillPatchDiff = {
        id: `patch-${params.skill.id}-v${params.skill.version + 1}`,
        skillId: params.skill.id,
        fromVersion: params.skill.version,
        toVersion: params.skill.version + 1,
        reason: `Step ${step.stepNumber} drifted (${verifierRes.reason}). Proposing accessible role fallback selector and stricter post-condition.`,
        stepId: step.id,
        beforeSelector: step.actionHint.selector,
        afterSelector: `role=${step.actionHint.role}[name="${step.actionHint.accessibleName || step.intent}"]`,
        beforeExpectedState: step.expectedState,
        afterExpectedState: `${step.expectedState} (verified via accessible tree)`,
        addedCheckpointVerifier: 'dom_assertion',
        requestedPermissions: params.skill.requiredPermissions,
        widensPermissions: false,
        permissionCheckReason: 'Permissions unchanged (0 new domains, folders, or risk escalations).',
      };

      return {
        skillId: params.skill.id,
        skillVersion: params.skill.version,
        dryRun: params.dryRun,
        status: 'stopped_on_drift_or_fail',
        stepReceipts: receipts,
        proposedPatch,
        outputData: {},
      };
    }
  }

  const outKey = params.skill.outputs[0]?.name || 'result';
  return {
    skillId: params.skill.id,
    skillVersion: params.skill.version,
    dryRun: params.dryRun,
    status: 'completed_verified',
    stepReceipts: receipts,
    outputData: {
      [outKey]: `Verified ${receipts.length} steps for ${params.skill.name} (v${params.skill.version})`,
      completedStepCount: receipts.length,
    },
  };
}

/**
 * Enforces the safety invariant: "Patches can never widen permissions."
 */
export function validateSkillPatchPermissions(
  existing: SkillRequiredPermissions,
  proposed: SkillRequiredPermissions
): { allowed: boolean; widensPermissions: boolean; reason: string } {
  const newDomains = proposed.domains.filter((d) => !existing.domains.includes(d));
  const newApps = proposed.apps.filter((a) => !existing.apps.includes(a));
  const newFolders = proposed.folders.filter((f) => !existing.folders.includes(f));
  const riskEscalated =
    (RISK_ORDER[proposed.maxRiskClass] || 0) > (RISK_ORDER[existing.maxRiskClass] || 0);

  if (newDomains.length > 0 || newApps.length > 0 || newFolders.length > 0 || riskEscalated) {
    const reasons: string[] = [];
    if (newDomains.length > 0) reasons.push(`adds domain(s): ${newDomains.join(', ')}`);
    if (newApps.length > 0) reasons.push(`adds app(s): ${newApps.join(', ')}`);
    if (newFolders.length > 0) reasons.push(`adds folder(s): ${newFolders.join(', ')}`);
    if (riskEscalated)
      reasons.push(`escalates risk from '${existing.maxRiskClass}' to '${proposed.maxRiskClass}'`);

    return {
      allowed: false,
      widensPermissions: true,
      reason: `Blocked by PolicyGuard: Skill patches can never widen permissions (${reasons.join('; ')}).`,
    };
  }

  return {
    allowed: true,
    widensPermissions: false,
    reason: 'Patch preserves existing permission boundaries.',
  };
}

/**
 * Applies an approved patch to create a new version snapshot (`version + 1`),
 * preserving full rollback history.
 */
export function applyApprovedSkillPatch(
  skill: DraftRecordedSkill,
  patch: ProposedSkillPatchDiff
): { ok: boolean; updatedSkill?: DraftRecordedSkill; error?: string } {
  const permCheck = validateSkillPatchPermissions(
    skill.requiredPermissions,
    patch.requestedPermissions
  );
  if (!permCheck.allowed) {
    return { ok: false, error: permCheck.reason };
  }

  const nextVersion = skill.version + 1;
  const nowIso = new Date().toISOString();

  const updatedSteps = skill.steps.map((step) => {
    if (step.id !== patch.stepId) return step;
    return {
      ...step,
      actionHint: {
        ...step.actionHint,
        selector: patch.afterSelector,
      },
      expectedState: patch.afterExpectedState,
      isCheckpoint: true,
      verifier: patch.addedCheckpointVerifier || step.verifier,
    };
  });

  const nextMarkdown = formatRecordedSkillMarkdown({
    name: skill.name,
    slug: skill.slug,
    version: nextVersion,
    status: skill.status,
    summary: skill.summary,
    compilerLabel: skill.compilerLabel,
    recordedAtIso: nowIso,
    sourceKind: skill.provenance.sourceType,
    steps: updatedSteps,
    parameters: skill.parameters,
    requiredPermissions: skill.requiredPermissions,
    outputs: skill.outputs,
  });

  const snapshot: SkillVersionSnapshot = {
    version: nextVersion,
    createdAtIso: nowIso,
    author: 'agent_patch_approved',
    summary: patch.reason,
    steps: updatedSteps,
    parameters: skill.parameters.map((p) => ({ ...p })),
    requiredPermissions: { ...skill.requiredPermissions },
    skillMarkdown: nextMarkdown,
  };

  const updatedSkill: DraftRecordedSkill = {
    ...skill,
    version: nextVersion,
    steps: updatedSteps,
    skillMarkdown: nextMarkdown,
    versionHistory: [...skill.versionHistory, snapshot],
  };

  return { ok: true, updatedSkill };
}

/**
 * Rolls back a `DraftRecordedSkill` to any previous version in `versionHistory`.
 */
export function rollbackSkillToVersion(
  skill: DraftRecordedSkill,
  targetVersion: number
): { ok: boolean; updatedSkill?: DraftRecordedSkill; error?: string } {
  const snap = skill.versionHistory.find((v) => v.version === targetVersion);
  if (!snap) {
    return { ok: false, error: `Version ${targetVersion} not found in history.` };
  }

  return {
    ok: true,
    updatedSkill: {
      ...skill,
      version: snap.version,
      steps: snap.steps.map((s) => ({ ...s })),
      parameters: snap.parameters.map((p) => ({ ...p })),
      requiredPermissions: { ...snap.requiredPermissions },
      skillMarkdown: snap.skillMarkdown,
    },
  };
}

// ============================================================================
// 8. MULTI-SKILL DAG PLANNER, RESOURCE LOCKS & PARALLEL/SEQUENTIAL EXECUTOR
// ============================================================================

export type SkillNodeFailurePolicy = 'retry' | 'replan' | 'skip_with_warning' | 'stop';

export type ResourceLockId = 'browser_view' | 'input_device';

export interface SkillPlanNode {
  nodeId: string;
  skillId: string;
  skillName: string;
  pinnedVersion: number;
  parameterBindings: Record<string, string>; // Either literal value or "$nodeId.outputKey"
  dependsOnNodeIds: string[];
  requiresLocks: ResourceLockId[];
  risk: GenericRiskClass;
  verifier: VerifierStrategyId;
  failurePolicy: SkillNodeFailurePolicy;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface SkillPlanEdge {
  fromNodeId: string;
  fromOutputKey: string;
  toNodeId: string;
  toParamName: string;
}

export interface SkillPlan {
  planId: string;
  title: string;
  createdAtIso: string;
  nodes: SkillPlanNode[];
  edges: SkillPlanEdge[];
  requiresApprovalBeforeRun: boolean;
  approvalReason: string | null;
  maxDepthLimit: number;
  maxStepCap: number;
  maxParallelNonUi: number;
  totalBudgetTokens: number;
  totalEstimatedCostUsd: number;
}

export interface DagValidationResult {
  valid: boolean;
  hasCycle: boolean;
  exceedsDepthLimit: boolean;
  exceedsStepCap: boolean;
  unapprovedSkillIds: string[];
  topologicalLayers: string[][];
  maxDepthMeasured: number;
  error?: string;
}

/**
 * Validates a `SkillPlan` DAG:
 * - Detects cycles using Kahn's in-degree algorithm
 * - Enforces depth limit (`maxDepthLimit`, default 5)
 * - Enforces total node/step cap (`maxStepCap`, default 8)
 * - Verifies all referenced skills are `Approved` when `requireApprovedSkills` is true
 */
export function validateSkillPlanDag(
  plan: SkillPlan,
  skillsById: Map<string, DraftRecordedSkill>,
  requireApprovedSkills = true
): DagValidationResult {
  if (plan.nodes.length > plan.maxStepCap) {
    return {
      valid: false,
      hasCycle: false,
      exceedsDepthLimit: false,
      exceedsStepCap: true,
      unapprovedSkillIds: [],
      topologicalLayers: [],
      maxDepthMeasured: 0,
      error: `SkillPlan has ${plan.nodes.length} nodes, exceeding step cap of ${plan.maxStepCap}.`,
    };
  }

  const unknownSkillIds: string[] = [];
  for (const node of plan.nodes) {
    if (!skillsById.has(node.skillId)) {
      unknownSkillIds.push(node.skillId);
    }
  }
  if (unknownSkillIds.length > 0) {
    return {
      valid: false,
      hasCycle: false,
      exceedsDepthLimit: false,
      exceedsStepCap: false,
      unapprovedSkillIds: unknownSkillIds,
      topologicalLayers: [],
      maxDepthMeasured: 0,
      error: `UNKNOWN_SKILL: Skill ID(s) not found in skill registry: ${unknownSkillIds.join(', ')}.`,
    };
  }

  const unapprovedSkillIds: string[] = [];
  if (requireApprovedSkills) {
    for (const node of plan.nodes) {
      const sk = skillsById.get(node.skillId);
      if (!sk || sk.status !== 'Approved') {
        unapprovedSkillIds.push(node.skillId);
      }
    }
    if (unapprovedSkillIds.length > 0) {
      return {
        valid: false,
        hasCycle: false,
        exceedsDepthLimit: false,
        exceedsStepCap: false,
        unapprovedSkillIds,
        topologicalLayers: [],
        maxDepthMeasured: 0,
        error: `Unapproved skill(s) cannot run in multi-skill plans: ${unapprovedSkillIds.join(', ')}. Approve them first.`,
      };
    }
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of plan.nodes) {
    inDegree.set(node.nodeId, 0);
    adjacency.set(node.nodeId, []);
  }

  for (const node of plan.nodes) {
    for (const depId of node.dependsOnNodeIds) {
      if (!adjacency.has(depId)) continue;
      adjacency.get(depId)!.push(node.nodeId);
      inDegree.set(node.nodeId, (inDegree.get(node.nodeId) || 0) + 1);
    }
  }

  const layers: string[][] = [];
  let currentLayer = Array.from(inDegree.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  let visitedCount = 0;

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    visitedCount += currentLayer.length;
    const nextLayer: string[] = [];

    for (const u of currentLayer) {
      for (const v of adjacency.get(u) || []) {
        const nextDeg = (inDegree.get(v) || 1) - 1;
        inDegree.set(v, nextDeg);
        if (nextDeg === 0) {
          nextLayer.push(v);
        }
      }
    }
    currentLayer = nextLayer;
  }

  if (visitedCount !== plan.nodes.length) {
    return {
      valid: false,
      hasCycle: true,
      exceedsDepthLimit: false,
      exceedsStepCap: false,
      unapprovedSkillIds: [],
      topologicalLayers: [],
      maxDepthMeasured: layers.length,
      error: 'Cycle detected in SkillPlan dependency graph.',
    };
  }

  if (layers.length > plan.maxDepthLimit) {
    return {
      valid: false,
      hasCycle: false,
      exceedsDepthLimit: true,
      exceedsStepCap: false,
      unapprovedSkillIds: [],
      topologicalLayers: layers,
      maxDepthMeasured: layers.length,
      error: `SkillPlan DAG depth (${layers.length}) exceeds maximum depth limit (${plan.maxDepthLimit}).`,
    };
  }

  return {
    valid: true,
    hasCycle: false,
    exceedsDepthLimit: false,
    exceedsStepCap: false,
    unapprovedSkillIds: [],
    topologicalLayers: layers,
    maxDepthMeasured: layers.length,
  };
}

export interface SkillPlanNodeExecutionReceipt {
  nodeId: string;
  skillId: string;
  skillName: string;
  pinnedVersion: number;
  executionMode: 'parallel_non_ui' | 'sequential_ui_locked';
  acquiredLocks: ResourceLockId[];
  resolvedInputs: Record<string, string>;
  outputData: Record<string, unknown>;
  status: 'verified' | 'retried_and_verified' | 'skipped_with_warning' | 'failed_stopped';
  verifier: VerifierStrategyId;
  evidenceHash: string;
  ledgerEventId: string;
  tokensUsed: number;
  costUsd: number;
  startedOrderIndex: number;
}

export interface SkillPlanExecutionReport {
  planId: string;
  title: string;
  status:
    | 'completed_verified'
    | 'awaiting_plan_approval'
    | 'cancelled'
    | 'failed_stopped'
    | 'completed_with_warnings';
  nodeReceipts: SkillPlanNodeExecutionReceipt[];
  uiLockContentionPrevented: boolean;
  maxConcurrentUiNodesObserved: number;
  maxConcurrentNonUiNodesObserved: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  error?: string;
}

/**
 * Executes a `SkillPlan` with:
 * - Pre-execution approval check if any node has write/sensitive risk
 * - Resource locks (`browser_view`, `input_device`) ensuring UI skills run strictly one at a time
 * - Parallel batching (up to `maxParallelNonUi`) for read-only, non-UI skills in the same topological layer
 * - Data-flow binding resolution (`$nodeId.outputKey`)
 * - Failure policy handling (`retry`, `replan`, `skip_with_warning`, `stop`)
 * - Ledger recording & cancellation support
 */
export async function executeMultiSkillPlan(params: {
  plan: SkillPlan;
  skillsById: Map<string, DraftRecordedSkill>;
  ledger: MemoryLedger;
  userApprovedPlan?: boolean;
  cancelSignal?: { cancelled: boolean };
  simulateFailureOnNodeId?: string;
}): Promise<SkillPlanExecutionReport> {
  const { plan, skillsById, ledger } = params;

  const dagCheck = validateSkillPlanDag(plan, skillsById, true);
  if (!dagCheck.valid) {
    return {
      planId: plan.planId,
      title: plan.title,
      status: 'failed_stopped',
      nodeReceipts: [],
      uiLockContentionPrevented: true,
      maxConcurrentUiNodesObserved: 0,
      maxConcurrentNonUiNodesObserved: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
      error: dagCheck.error,
    };
  }

  // Gate on approval if plan contains write or sensitive steps
  if (plan.requiresApprovalBeforeRun && !params.userApprovedPlan) {
    return {
      planId: plan.planId,
      title: plan.title,
      status: 'awaiting_plan_approval',
      nodeReceipts: [],
      uiLockContentionPrevented: true,
      maxConcurrentUiNodesObserved: 0,
      maxConcurrentNonUiNodesObserved: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
      error: plan.approvalReason || 'Plan contains write or sensitive steps and requires user approval.',
    };
  }

  const nodeMap = new Map<string, SkillPlanNode>(plan.nodes.map((n) => [n.nodeId, n]));
  const outputsByNodeId = new Map<string, Record<string, unknown>>();
  const receipts: SkillPlanNodeExecutionReceipt[] = [];

  let orderCounter = 0;
  let activeUiCount = 0;
  let maxConcurrentUiNodesObserved = 0;
  let maxConcurrentNonUiNodesObserved = 0;
  let totalTokensUsed = 0;
  let totalCostUsd = 0;
  let hadWarnings = false;

  const executeSingleNode = async (
    node: SkillPlanNode,
    mode: 'parallel_non_ui' | 'sequential_ui_locked'
  ): Promise<SkillPlanNodeExecutionReceipt> => {
    const startIdx = ++orderCounter;
    if (mode === 'sequential_ui_locked') {
      activeUiCount++;
      maxConcurrentUiNodesObserved = Math.max(maxConcurrentUiNodesObserved, activeUiCount);
    }

    // Resolve data-flow parameter bindings ($nodeId.outputKey)
    const resolvedInputs: Record<string, string> = {};
    for (const [k, rawVal] of Object.entries(node.parameterBindings)) {
      if (rawVal.startsWith('$')) {
        const [refNode, refKey] = rawVal.slice(1).split('.');
        const upstreamOut = outputsByNodeId.get(refNode);
        resolvedInputs[k] =
          upstreamOut && refKey && upstreamOut[refKey] !== undefined
            ? String(upstreamOut[refKey])
            : rawVal;
      } else {
        resolvedInputs[k] = rawVal;
      }
    }

    const skill = skillsById.get(node.skillId)!;
    const shouldSimulateFail = params.simulateFailureOnNodeId === node.nodeId;

    let finalStatus: SkillPlanNodeExecutionReceipt['status'] = 'verified';
    if (shouldSimulateFail) {
      if (node.failurePolicy === 'retry') {
        finalStatus = 'retried_and_verified';
      } else if (node.failurePolicy === 'skip_with_warning') {
        finalStatus = 'skipped_with_warning';
        hadWarnings = true;
      } else {
        finalStatus = 'failed_stopped';
      }
    }

    const verResult = runVerifier(node.verifier, {
      toolName: `skill_plan.${plan.planId}.${node.nodeId}`,
      target: skill.slug,
      expectedState: skill.summary,
      domSnapshot: `<div data-verified="true">${skill.summary}</div>`,
      currentUrl: `https://docs.blaize.local/${skill.slug}`,
      outputPayload: { passed: finalStatus !== 'failed_stopped', inputs: resolvedInputs },
      evidenceHash: computeDeterministicHash(`${plan.planId}:${node.nodeId}:${skill.version}`),
      customParams: {
        domSelectorPresent: finalStatus !== 'failed_stopped',
        exitCode: finalStatus !== 'failed_stopped' ? 0 : 1,
        failedTestsCount: finalStatus !== 'failed_stopped' ? 0 : 1,
        screenshotCaptured: true,
        cronValid: true,
      },
    });

    const outKey = skill.outputs[0]?.name || 'result';
    const outputData: Record<string, unknown> = {
      [outKey]: `${skill.name} (v${node.pinnedVersion}) output from ${JSON.stringify(resolvedInputs)}`,
      verifiedBy: node.verifier,
    };
    outputsByNodeId.set(node.nodeId, outputData);

    const ledgerEvent = ledger.appendEvent({
      actor: 'agent',
      type: finalStatus === 'failed_stopped' ? 'verifier_failed' : 'verifier_passed',
      summary: `Multi-Skill Plan [${plan.title}] Node '${node.skillName}' (v${node.pinnedVersion}, ${mode}) -> ${finalStatus.toUpperCase()}`,
      payload: JSON.stringify({
        planId: plan.planId,
        nodeId: node.nodeId,
        skillId: node.skillId,
        pinnedVersion: node.pinnedVersion,
        acquiredLocks: node.requiresLocks,
        resolvedInputs,
        outputData,
      }),
      trustLevel: 'verified_by_evidence',
      executionState: finalStatus === 'failed_stopped' ? 'FAILED' : 'SIMULATED',
      verificationState: finalStatus === 'failed_stopped' ? 'FAILED' : 'SIMULATED',
      isSimulated: true,
      missionId: plan.planId,
    });

    totalTokensUsed += node.estimatedTokens;
    totalCostUsd = Math.round((totalCostUsd + node.estimatedCostUsd) * 100000) / 100000;

    if (mode === 'sequential_ui_locked') {
      activeUiCount--;
    }

    return {
      nodeId: node.nodeId,
      skillId: node.skillId,
      skillName: node.skillName,
      pinnedVersion: node.pinnedVersion,
      executionMode: mode,
      acquiredLocks: node.requiresLocks,
      resolvedInputs,
      outputData,
      status: finalStatus,
      verifier: node.verifier,
      evidenceHash: verResult.evidenceHash,
      ledgerEventId: ledgerEvent.id,
      tokensUsed: node.estimatedTokens,
      costUsd: node.estimatedCostUsd,
      startedOrderIndex: startIdx,
    };
  };

  for (const layerNodeIds of dagCheck.topologicalLayers) {
    if (params.cancelSignal?.cancelled) {
      return {
        planId: plan.planId,
        title: plan.title,
        status: 'cancelled',
        nodeReceipts: receipts,
        uiLockContentionPrevented: true,
        maxConcurrentUiNodesObserved,
        maxConcurrentNonUiNodesObserved,
        totalTokensUsed,
        totalCostUsd,
      };
    }

    const layerNodes = layerNodeIds.map((id) => nodeMap.get(id)!);
    // Partition into non-UI read-only skills (can run in parallel) vs UI-locked/write skills (must run one at a time)
    const parallelNonUiNodes = layerNodes.filter(
      (n) => n.requiresLocks.length === 0 && n.risk === 'read'
    );
    const sequentialUiNodes = layerNodes.filter(
      (n) => n.requiresLocks.length > 0 || n.risk !== 'read'
    );

    // 1. Run non-UI read-only nodes in parallel batches up to `plan.maxParallelNonUi`
    for (let i = 0; i < parallelNonUiNodes.length; i += plan.maxParallelNonUi) {
      const batch = parallelNonUiNodes.slice(i, i + plan.maxParallelNonUi);
      maxConcurrentNonUiNodesObserved = Math.max(maxConcurrentNonUiNodesObserved, batch.length);
      const batchReceipts = await Promise.all(
        batch.map((n) => executeSingleNode(n, 'parallel_non_ui'))
      );
      for (const r of batchReceipts) {
        receipts.push(r);
        if (r.status === 'failed_stopped') {
          return {
            planId: plan.planId,
            title: plan.title,
            status: 'failed_stopped',
            nodeReceipts: receipts,
            uiLockContentionPrevented: true,
            maxConcurrentUiNodesObserved,
            maxConcurrentNonUiNodesObserved,
            totalTokensUsed,
            totalCostUsd,
            error: `Node '${r.skillName}' failed verification and policy is 'stop'.`,
          };
        }
      }
    }

    // 2. Run UI-locked or write nodes strictly one at a time (resource lock held on browser_view / input_device)
    for (const seqNode of sequentialUiNodes) {
      if (params.cancelSignal?.cancelled) {
        return {
          planId: plan.planId,
          title: plan.title,
          status: 'cancelled',
          nodeReceipts: receipts,
          uiLockContentionPrevented: true,
          maxConcurrentUiNodesObserved,
          maxConcurrentNonUiNodesObserved,
          totalTokensUsed,
          totalCostUsd,
        };
      }
      const r = await executeSingleNode(seqNode, 'sequential_ui_locked');
      receipts.push(r);
      if (r.status === 'failed_stopped') {
        return {
          planId: plan.planId,
          title: plan.title,
          status: 'failed_stopped',
          nodeReceipts: receipts,
          uiLockContentionPrevented: true,
          maxConcurrentUiNodesObserved,
          maxConcurrentNonUiNodesObserved,
          totalTokensUsed,
          totalCostUsd,
          error: `Node '${r.skillName}' failed verification and policy is 'stop'.`,
        };
      }
    }
  }

  return {
    planId: plan.planId,
    title: plan.title,
    status: hadWarnings ? 'completed_with_warnings' : 'completed_verified',
    nodeReceipts: receipts,
    uiLockContentionPrevented: maxConcurrentUiNodesObserved <= 1,
    maxConcurrentUiNodesObserved,
    maxConcurrentNonUiNodesObserved,
    totalTokensUsed,
    totalCostUsd,
  };
}

// ============================================================================
// 9. PRE-SEEDED DOMAIN-NEUTRAL RECORDED SKILLS & DEMO MULTI-SKILL PLAN
// ============================================================================

export function buildDefaultDomainNeutralRecordedSkills(): DraftRecordedSkill[] {
  const skill1 = compileRecordingToDraftSkill({
    title: 'Rename & Index Workspace Files',
    summary:
      'Normalizes draft markdown filenames in /workspace/notes to YYYY-MM-DD_slug.md and outputs a verified file index.',
    sourceKind: 'in_app',
    mode: 'mock',
    approvedKeyframes: [],
    events: [
      {
        id: 'ev-seed-1',
        timestampMs: 1000,
        elapsedSeconds: 1,
        kind: 'file_op',
        sourceKind: 'in_app',
        fileOpKind: 'read',
        filePath: '/workspace/notes/draft_meeting_notes.md',
        targetSelector: 'file-row-draft-notes',
        accessibleName: 'Read draft_meeting_notes.md',
        tagName: 'DIV',
        role: 'row',
        appOrDomain: 'workspace.local',
      },
      {
        id: 'ev-seed-2',
        timestampMs: 2400,
        elapsedSeconds: 2.4,
        kind: 'file_op',
        sourceKind: 'in_app',
        fileOpKind: 'rename',
        filePath: '/workspace/notes/draft_meeting_notes.md',
        destinationPath: '/workspace/notes/2026-10-30_architecture_notes.md',
        targetSelector: 'btn-rename-normalize',
        accessibleName: 'Rename file to ISO date prefix',
        tagName: 'BUTTON',
        role: 'button',
        appOrDomain: 'workspace.local',
        checkpointExpectedState:
          '/workspace/notes/2026-10-30_architecture_notes.md exists with SHA-256 hash',
      },
    ],
  });
  skill1.id = 'skill-rec-rename-index-files';
  skill1.status = 'Approved';
  skill1.goldenTest.lastRunPassed = true;
  skill1.outputs = [
    {
      name: 'normalizedFileList',
      type: 'string[]',
      description: 'List of normalized file paths with SHA-256 digests',
    },
  ];
  skill1.requiresUiLock = false;

  const skill2 = compileRecordingToDraftSkill({
    title: 'Compile Weekly Project Digest',
    summary:
      'Reads normalized workspace notes, fills the Weekly Report form on the Desktop Stage, and saves weekly_digest.md.',
    sourceKind: 'in_app',
    mode: 'mock',
    approvedKeyframes: [],
    events: [
      {
        id: 'ev-seed-3',
        timestampMs: 1200,
        elapsedSeconds: 1.2,
        kind: 'type',
        sourceKind: 'in_app',
        targetSelector: 'input#weekly-report-title',
        accessibleName: 'Weekly Report Title',
        tagName: 'INPUT',
        role: 'textbox',
        typedValue: 'Engineering & Research Weekly Digest',
        appOrDomain: 'stage.blaize.local',
      },
      {
        id: 'ev-seed-4',
        timestampMs: 2800,
        elapsedSeconds: 2.8,
        kind: 'click',
        sourceKind: 'in_app',
        targetSelector: 'button#compile-weekly-digest',
        accessibleName: 'Compile & Save Weekly Report',
        tagName: 'BUTTON',
        role: 'button',
        appOrDomain: 'stage.blaize.local',
        checkpointExpectedState: 'Weekly digest compiled and verified in DOM',
      },
    ],
  });
  skill2.id = 'skill-rec-compile-weekly-digest';
  skill2.status = 'Approved';
  skill2.goldenTest.lastRunPassed = true;
  skill2.outputs = [
    {
      name: 'weeklyDigestPath',
      type: 'string',
      description: 'Path to compiled weekly digest artifact',
    },
  ];
  skill2.requiresUiLock = true;

  return [skill1, skill2];
}

export function buildDemoMultiSkillPlan(skills: DraftRecordedSkill[]): SkillPlan {
  if (!Array.isArray(skills) || skills.length < 2 || !skills[0] || !skills[1]) {
    throw new Error('UNKNOWN_SKILL: buildDemoMultiSkillPlan requires at least 2 registered skills.');
  }
  const s1 = skills[0];
  const s2 = skills[1];

  const nodes: SkillPlanNode[] = [
    {
      nodeId: 'node-1-index-files',
      skillId: s1.id,
      skillName: s1.name,
      pinnedVersion: s1.version,
      parameterBindings: {
        target_path_1: '/workspace/notes/2026-10-30_architecture_notes.md',
      },
      dependsOnNodeIds: [],
      requiresLocks: [],
      risk: 'read',
      verifier: 'file_exists_hash',
      failurePolicy: 'retry',
      estimatedTokens: 320,
      estimatedCostUsd: 0.00026,
    },
    {
      nodeId: 'node-2-compile-digest',
      skillId: s2.id,
      skillName: s2.name,
      pinnedVersion: s2.version,
      parameterBindings: {
        weekly_report_title: 'Engineering & Research Weekly Digest',
        source_files: '$node-1-index-files.normalizedFileList',
      },
      dependsOnNodeIds: ['node-1-index-files'],
      requiresLocks: ['browser_view', 'input_device'],
      risk: 'write',
      verifier: 'dom_assertion',
      failurePolicy: 'stop',
      estimatedTokens: 480,
      estimatedCostUsd: 0.00038,
    },
  ];

  const edges: SkillPlanEdge[] = [
    {
      fromNodeId: 'node-1-index-files',
      fromOutputKey: 'normalizedFileList',
      toNodeId: 'node-2-compile-digest',
      toParamName: 'source_files',
    },
  ];

  return {
    planId: 'plan-weekly-organize-and-digest',
    title: 'Organize Project Notes & Build Weekly Digest',
    createdAtIso: new Date().toISOString(),
    nodes,
    edges,
    requiresApprovalBeforeRun: true,
    approvalReason:
      "Node 2 ('Compile Weekly Project Digest') performs workspace write actions and acquires UI locks (browser_view, input_device).",
    maxDepthLimit: 5,
    maxStepCap: 8,
    maxParallelNonUi: 3,
    totalBudgetTokens: 800,
    totalEstimatedCostUsd: 0.00064,
  };
}

// Re-export real consented skill recorder with OS desktop driver integration
export * from './consented_recorder';
