import type { RecordingPrivacyState } from '../../../electron/ipc-contracts.js';

export interface PixelPrivacyRegion { x: number; y: number; width: number; height: number; label: string; }

/** Fail closed when native privacy evidence is absent or more than 1 second old. */
export function effectiveRecordingPrivacyMode(
  state: RecordingPrivacyState | null | undefined,
  nowMs = Date.now(),
  staleAfterMs = 1000
): RecordingPrivacyState['mode'] {
  if (!state || !state.available || !Number.isFinite(state.capturedAtMs) || nowMs - state.capturedAtMs > staleAfterMs) {
    return 'blur_all';
  }
  return state.mode;
}

/** Return true when a partial blur cannot be proven complete; caller must cover the whole frame. */
export function shouldUseFullFramePrivacyFallback(
  mode: RecordingPrivacyState['mode'],
  expectedRegionCount: number,
  mappedRegionCount: number,
  blurFilterAvailable: boolean
): boolean {
  if (mode === 'blur_all') return true;
  if (mode === 'clear') return false;
  return !blurFilterAvailable || expectedRegionCount < 1 || mappedRegionCount !== expectedRegionCount;
}

/** Converts native desktop logical bounds into the selected display's output-canvas pixels. */
export function mapRecordingPrivacyRegionsToPixels(
  state: RecordingPrivacyState,
  frameWidth: number,
  frameHeight: number
): PixelPrivacyRegion[] {
  const display = state.displayBounds;
  if (!display || display.width <= 0 || display.height <= 0 || frameWidth <= 0 || frameHeight <= 0) return [];
  const result: PixelPrivacyRegion[] = [];
  for (const region of state.regions || []) {
    const left = Math.max(display.x, region.x);
    const top = Math.max(display.y, region.y);
    const right = Math.min(display.x + display.width, region.x + region.width);
    const bottom = Math.min(display.y + display.height, region.y + region.height);
    if (right <= left || bottom <= top) continue;
    result.push({
      x: Math.max(0, Math.floor(((left - display.x) / display.width) * frameWidth)),
      y: Math.max(0, Math.floor(((top - display.y) / display.height) * frameHeight)),
      width: Math.min(frameWidth, Math.ceil(((right - left) / display.width) * frameWidth)),
      height: Math.min(frameHeight, Math.ceil(((bottom - top) / display.height) * frameHeight)),
      label: region.label,
    });
  }
  return result;
}

