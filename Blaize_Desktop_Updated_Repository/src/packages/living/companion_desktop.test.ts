import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFreeCompanionPosition,
  computeDesktopCompanionLifecycle,
} from './index';

test('clampFreeCompanionPosition preserves arbitrary screen coordinates inside viewport', () => {
  const pos = clampFreeCompanionPosition({
    x: 420,
    y: 310,
    viewportWidth: 1440,
    viewportHeight: 900,
    companionWidth: 80,
    companionHeight: 96,
  });
  assert.deepEqual(pos, { x: 420, y: 310 });
});

test('clampFreeCompanionPosition clamps out-of-bounds coordinates to keep figure visible on screen', () => {
  const topLeft = clampFreeCompanionPosition({
    x: -100,
    y: -50,
    viewportWidth: 1440,
    viewportHeight: 900,
    companionWidth: 80,
    companionHeight: 96,
  });
  assert.deepEqual(topLeft, { x: 8, y: 24 });

  const bottomRight = clampFreeCompanionPosition({
    x: 2000,
    y: 1200,
    viewportWidth: 1440,
    viewportHeight: 900,
    companionWidth: 80,
    companionHeight: 96,
  });
  assert.deepEqual(bottomRight, { x: 1440 - 80 - 8, y: 900 - 96 - 8 });
});

test('computeDesktopCompanionLifecycle keeps 2D companion alive when Blaize is closed until companion exits', () => {
  const bothOpen = computeDesktopCompanionLifecycle({
    isBlaizeWindowClosed: false,
    isCompanionExited: false,
  });
  assert.equal(bothOpen.blaizeWindowOpen, true);
  assert.equal(bothOpen.companionAliveOnDesktop, true);
  assert.equal(bothOpen.allDesktopSurfacesClosed, false);

  const blaizeClosedCompanionAlive = computeDesktopCompanionLifecycle({
    isBlaizeWindowClosed: true,
    isCompanionExited: false,
  });
  assert.equal(blaizeClosedCompanionAlive.blaizeWindowOpen, false);
  assert.equal(blaizeClosedCompanionAlive.companionAliveOnDesktop, true);
  assert.equal(blaizeClosedCompanionAlive.allDesktopSurfacesClosed, false);

  const bothExited = computeDesktopCompanionLifecycle({
    isBlaizeWindowClosed: true,
    isCompanionExited: true,
  });
  assert.equal(bothExited.blaizeWindowOpen, false);
  assert.equal(bothExited.companionAliveOnDesktop, false);
  assert.equal(bothExited.allDesktopSurfacesClosed, true);
});
