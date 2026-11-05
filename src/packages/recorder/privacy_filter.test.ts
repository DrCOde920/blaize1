import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveRecordingPrivacyMode,
  mapRecordingPrivacyRegionsToPixels,
  shouldUseFullFramePrivacyFallback,
} from './privacy_filter';
import type { RecordingPrivacyState } from '../../../electron/ipc-contracts.js';

const baseState: RecordingPrivacyState = {
  available: true,
  mode: 'blur_regions',
  capturedAtMs: 10_000,
  displayBounds: { x: 100, y: 50, width: 1000, height: 500 },
  regions: [
    { x: 200, y: 100, width: 100, height: 40, label: 'Password field' },
    { x: 950, y: 500, width: 300, height: 200, label: 'Partially outside selected monitor' },
    { x: -500, y: -500, width: 100, height: 100, label: 'Other monitor' },
  ],
  reason: 'test',
};

test('privacy detector fails closed when native evidence is missing, stale, or unavailable', () => {
  assert.equal(effectiveRecordingPrivacyMode(null, 10_000), 'blur_all');
  assert.equal(effectiveRecordingPrivacyMode({ ...baseState, available: false }, 10_000), 'blur_all');
  assert.equal(effectiveRecordingPrivacyMode(baseState, 11_001), 'blur_all');
  assert.equal(effectiveRecordingPrivacyMode(baseState, 10_900), 'blur_regions');
});

test('native logical regions map to output canvas pixels and are clipped to the selected display', () => {
  const mapped = mapRecordingPrivacyRegionsToPixels(baseState, 2000, 1000);
  assert.deepEqual(mapped, [
    { x: 200, y: 100, width: 200, height: 80, label: 'Password field' },
    { x: 1700, y: 900, width: 300, height: 100, label: 'Partially outside selected monitor' },
  ]);
});

test('clear is only a valid output mode with recent, positive native evidence', () => {
  assert.equal(effectiveRecordingPrivacyMode({ ...baseState, mode: 'clear', regions: [] }, 10_100), 'clear');
});

test('uncertain or incomplete partial masks escalate to full-frame redaction', () => {
  assert.equal(shouldUseFullFramePrivacyFallback('blur_regions', 2, 1, true), true);
  assert.equal(shouldUseFullFramePrivacyFallback('blur_window', 0, 0, true), true);
  assert.equal(shouldUseFullFramePrivacyFallback('blur_regions', 2, 2, false), true);
  assert.equal(shouldUseFullFramePrivacyFallback('blur_regions', 2, 2, true), false);
  assert.equal(shouldUseFullFramePrivacyFallback('blur_all', 0, 0, false), true);
  assert.equal(shouldUseFullFramePrivacyFallback('clear', 0, 0, true), false);
});
