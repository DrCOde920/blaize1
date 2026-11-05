/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser Session & Isolation Tests (`src/packages/browser_ide/browser_session.test.ts`)
 * Verifies Chromium tab lifecycle, profile isolation, credential shield auto-pause,
 * header/cookie sanitization, and honest offline handling without Kyoto fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserSessionManager,
  sanitizeHeadersAndSecrets,
} from './browser_session';
import { ReaderEngine } from './index';

test('BrowserSessionManager: partitions profiles into persistent isolated stores', () => {
  const manager = new BrowserSessionManager();

  const tabPersonal = manager.createTab('personal', 'https://example.com/personal');
  const tabWork = manager.createTab('work', 'https://example.com/work');
  const tabTesting = manager.createTab('testing', 'https://example.com/test');

  assert.equal(tabPersonal.profileId, 'personal');
  assert.equal(tabPersonal.partition, 'persist:blaize-profile-personal');

  assert.equal(tabWork.profileId, 'work');
  assert.equal(tabWork.partition, 'persist:blaize-profile-work');

  assert.equal(tabTesting.profileId, 'testing');
  assert.equal(tabTesting.partition, 'persist:blaize-profile-testing');

  // Verify profiles do not share partitions
  assert.notEqual(tabPersonal.partition, tabWork.partition);
  assert.notEqual(tabWork.partition, tabTesting.partition);

  // Tab switching and retrieval
  manager.setActiveTab(tabWork.id);
  assert.equal(manager.getActiveTab()?.id, tabWork.id);
  assert.equal(manager.getActiveTab()?.profileId, 'work');
});

test('BrowserSessionManager: never exposes raw cookies, auth tokens, or passwords', () => {
  const rawHeaders: Record<string, string> = {
    'content-type': 'text/html',
    'cookie': 'session_id=SECRET123; user=alice',
    'authorization': 'Bearer token_xyz987',
    'x-api-key': 'live_key_9999',
    'user-agent': 'Blaize-Browser/1.0',
  };

  const sanitized = sanitizeHeadersAndSecrets(rawHeaders);

  assert.equal(sanitized['content-type'], 'text/html');
  assert.equal(sanitized['user-agent'], 'Blaize-Browser/1.0');
  assert.equal(sanitized['cookie'], '[REDACTED_COOKIE]');
  assert.equal(sanitized['authorization'], '[REDACTED_AUTH]');
  assert.equal(sanitized['x-api-key'], '[REDACTED_SECRET]');
  assert.equal(Object.keys(sanitized).includes('session_id'), false);
});

test('BrowserSessionManager: credential entry shield suspends automated interaction', async () => {
  const manager = new BrowserSessionManager();
  const tab = manager.createTab('personal');

  // Simulate visiting a login / password entry page
  const pageResult = await manager.navigate(tab.id, 'https://docs.blaize.local/login', {
    simulatedHtml: `<html><body><form><input type="text" name="user"><input type="password" name="pwd"><button type="submit">Sign in</button></form></body></html>`,
    title: 'Sign in to Your Account',
  });

  assert.equal(pageResult.credentialShieldActive, true);
  assert.equal(tab.credentialShieldActive, true);
  assert.equal(tab.executionState, 'WAITING_FOR_APPROVAL');
  assert.equal(tab.unsupportedReason, 'CREDENTIAL_ENTRY_SHIELD_SUSPEND');

  // Manual takeover unlocks shield
  const manualTab = manager.enableManualTakeover(tab.id);
  assert.equal(manualTab.manualTakeoverActive, true);
});

test('BrowserSessionManager: validates downloads through PolicyEngine', async () => {
  const manager = new BrowserSessionManager();
  const tab = manager.createTab('testing', 'https://docs.blaize.local');

  // Allowed file extension
  const safeDownload = await manager.requestDownload(tab.id, {
    url: 'https://docs.blaize.local/document.pdf',
    fileName: 'document.pdf',
    sizeBytes: 1024,
  });
  assert.equal(safeDownload.allowed, true);
  assert.equal(safeDownload.status, 'completed');

  // Forbidden executable extension
  const dangerousDownload = await manager.requestDownload(tab.id, {
    url: 'https://docs.blaize.local/installer.exe',
    fileName: 'installer.exe',
    sizeBytes: 1024,
  });
  assert.equal(dangerousDownload.allowed, false);
  assert.equal(dangerousDownload.status, 'blocked');
  assert.match(dangerousDownload.reason || '', /Executable download extension/i);
});

test('ReaderEngine: does not return hardcoded Kyoto on network failure without explicit fixture', async () => {
  // Calling navigate with a non-routable URL without useOfflineFixture
  const res = await ReaderEngine.navigate('https://nonexistent-domain-offline-test.org/article');

  // Must NOT claim 200 or return Kyoto text
  assert.notEqual(res.title, 'Kyoto — Cultural Capital of Japan');
  assert.equal(res.statusCode, 0);
  assert.equal(res.isSimulated, false);
  assert.match(res.error || '', /network error/i);

  // When explicit offline fixture is passed, labeled isSimulated: true
  const fixtureRes = await ReaderEngine.navigate('https://en.wikipedia.org/wiki/Kyoto', {
    useOfflineFixture: true,
  } as any);

  assert.equal(fixtureRes.title, 'Wikipedia — Kyoto');
  assert.equal(fixtureRes.isSimulated, true);
  assert.match(fixtureRes.readableText, /cultural capital/i);
});

test('BrowserSessionManager: serializes and restores tab sessions across restarts', () => {
  const manager = new BrowserSessionManager();
  const tab1 = manager.createTab('personal', 'https://example.com/one');
  const tab2 = manager.createTab('work', 'https://example.com/two');

  const serialized = manager.exportSession();
  assert.equal(serialized.tabs.length, 2);

  const newManager = new BrowserSessionManager();
  newManager.restoreSession(serialized);

  assert.equal(newManager.getAllTabs().length, 2);
  const restored1 = newManager.getTab(tab1.id);
  const restored2 = newManager.getTab(tab2.id);

  assert.equal(restored1?.url, 'https://example.com/one');
  assert.equal(restored1?.partition, 'persist:blaize-profile-personal');
  assert.equal(restored2?.url, 'https://example.com/two');
  assert.equal(restored2?.partition, 'persist:blaize-profile-work');
});
