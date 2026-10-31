/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit Tests for Prompt 1/4 (src/packages/hub/index.test.ts):
 * - Popover navigation, tile constraints (1-word title, <=6-word hint), 'Group > Page' breadcrumb, and keyboard use (Esc, arrows)
 * - Morrow Voice toggle (on/off, aria-pressed, tooltip 'Voice on/off', never triggers dancing, suppresses speech when off)
 * - Unified Single Memory Store (auto-save ordinary facts, ask-first sensitive items -> Review, hard-block secrets/passwords/financial IDs, edit, delete with separate ledger content, pause saving, forget chat, export MEMORY.md & USER.md)
 * - Scoped Rule Book enforcement against non-finance plugins (Everywhere, Project, Plugin, Connector scopes; manifest can only tighten, never loosen)
 * - Unified Review inbox for every proposal type (skill, plugin, rule, personality, memory, schedule, connector_write, extension)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_REVIEW_PROPOSAL_TYPES,
  DEFAULT_SOUL_PROFILE_CONFIG,
  INITIAL_INSTALLED_PLUGINS,
  INITIAL_REVIEW_PROPOSALS,
  INITIAL_SCOPED_RULES,
  INITIAL_UNIFIED_MEMORY_ITEMS,
  INITIAL_UNIFIED_SKILLS,
  InstalledPluginRecord,
  PopoverUiState,
  ReviewProposalItem,
  SIDEBAR_NAVIGATION_GROUPS,
  UnifiedMemoryStore,
  UnifiedReviewInbox,
  VoiceToggleController,
  evaluatePluginActionWithScopedRules,
  exportSoulTemplateJson,
  filterUnifiedSkills,
  formatTopBarBreadcrumb,
  getActiveGroupForPage,
  importSoulTemplateJson,
  reducePopoverNavigation,
  validateSidebarNavigationConstraints,
} from './index';
import { MemoryLedger } from '../trust';

test('1. Sidebar & Popover Navigation: enforces top-level buttons, 1-word tile titles, <=6-word hints, Group > Page breadcrumb, and keyboard Esc/Arrows', () => {
  // Top-level buttons check
  const topIds = SIDEBAR_NAVIGATION_GROUPS.map((g) => g.id);
  assert.deepEqual(topIds, [
    'chat',
    'projects',
    'library',
    'workbench',
    'automations',
    'proof',
    'settings',
  ]);

  // Every tile has a 1-word title and <= 6-word hint
  const constraintCheck = validateSidebarNavigationConstraints();
  assert.equal(constraintCheck.valid, true, constraintCheck.violations.join('; '));

  // Verify exact group tile membership
  const libraryPages = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === 'library')!.tiles.map(
    (t) => t.pageId
  );
  assert.deepEqual(libraryPages, [
    'skills',
    'plugins',
    'connectors',
    'soul',
    'rules',
    'memory',
  ]);

  const workbenchPages = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === 'workbench')!.tiles.map(
    (t) => t.pageId
  );
  assert.deepEqual(workbenchPages, ['browser', 'ide']);

  const automationPages = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === 'automations')!.tiles.map(
    (t) => t.pageId
  );
  assert.deepEqual(automationPages, ['scheduler']);

  const proofPages = SIDEBAR_NAVIGATION_GROUPS.find((g) => g.id === 'proof')!.tiles.map(
    (t) => t.pageId
  );
  assert.deepEqual(proofPages, ['review', 'evaluations', 'activity']);

  // Breadcrumb formatting ('Group > Page')
  assert.equal(formatTopBarBreadcrumb('skills'), 'Library > Skills');
  assert.equal(formatTopBarBreadcrumb('memory'), 'Library > Memory');
  assert.equal(formatTopBarBreadcrumb('browser'), 'Workbench > AI Browser');
  assert.equal(formatTopBarBreadcrumb('ide'), 'Workbench > Code Editor');
  assert.equal(formatTopBarBreadcrumb('scheduler'), 'Automations > Scheduler');
  assert.equal(formatTopBarBreadcrumb('review'), 'Proof > Review');
  assert.equal(formatTopBarBreadcrumb('activity'), 'Proof > Activity');
  assert.equal(formatTopBarBreadcrumb('chat'), 'Chat');
  assert.equal(formatTopBarBreadcrumb('projects'), 'Projects');

  // Active group highlight mapping
  assert.equal(getActiveGroupForPage('memory'), 'library');
  assert.equal(getActiveGroupForPage('ide'), 'workbench');
  assert.equal(getActiveGroupForPage('scheduler'), 'automations');
  assert.equal(getActiveGroupForPage('review'), 'proof');

  // Keyboard & Popover state machine
  let state: PopoverUiState = {
    openGroupId: null,
    activePageId: 'chat',
    focusedTileIndex: 0,
  };

  // Open Library popover
  state = reducePopoverNavigation(state, { type: 'CLICK_GROUP_BUTTON', groupId: 'library' });
  assert.equal(state.openGroupId, 'library');
  assert.equal(state.focusedTileIndex, 0);

  // Navigate tiles with keyboard arrows
  state = reducePopoverNavigation(state, { type: 'ARROW_NEXT' });
  assert.equal(state.focusedTileIndex, 1);
  state = reducePopoverNavigation(state, { type: 'ARROW_PREV' });
  assert.equal(state.focusedTileIndex, 0);

  // Press Escape closes the popover without changing active page
  state = reducePopoverNavigation(state, { type: 'PRESS_ESCAPE' });
  assert.equal(state.openGroupId, null);
  assert.equal(state.activePageId, 'chat');

  // Re-open Library and select Memory tile -> opens page and closes popover
  state = reducePopoverNavigation(state, { type: 'CLICK_GROUP_BUTTON', groupId: 'library' });
  state = reducePopoverNavigation(state, { type: 'SELECT_TILE', pageId: 'memory' });
  assert.equal(state.openGroupId, null);
  assert.equal(state.activePageId, 'memory');

  // Outside click also closes open popover
  state = reducePopoverNavigation(state, { type: 'CLICK_GROUP_BUTTON', groupId: 'proof' });
  assert.equal(state.openGroupId, 'proof');
  state = reducePopoverNavigation(state, { type: 'OUTSIDE_CLICK' });
  assert.equal(state.openGroupId, null);
});

test('2. Voice Toggle on Morrow: toggles spoken replies, updates aria-pressed & icon, never triggers dancing, and blocks audio when off', () => {
  const voice = new VoiceToggleController(false);

  // Initial state: Voice off (muted speaker)
  const initialSnap = voice.getSnapshot();
  assert.equal(initialSnap.voiceEnabled, false);
  assert.equal(initialSnap.iconVariant, 'speaker_muted');
  assert.equal(initialSnap.ariaPressed, false);
  assert.equal(initialSnap.tooltip, 'Voice on/off');
  assert.equal(initialSnap.triggersDancing, false);

  // When voice is off, speakReply does NOT play audio
  const mutedAttempt = voice.speakReply('Hello from Morrow');
  assert.equal(mutedAttempt.played, false);
  assert.equal(voice.getSpokenHistory().length, 0);

  // Toggle Voice on -> speaker with waves, ariaPressed = true, triggersDancing = false
  const enabledSnap = voice.toggle();
  assert.equal(enabledSnap.voiceEnabled, true);
  assert.equal(enabledSnap.iconVariant, 'speaker_waves');
  assert.equal(enabledSnap.ariaPressed, true);
  assert.equal(enabledSnap.triggersDancing, false);

  // When voice is on, speakReply plays and records utterance
  const spokenAttempt = voice.speakReply('**Verified** task complete.');
  assert.equal(spokenAttempt.played, true);
  assert.equal(spokenAttempt.cleanText, 'Verified task complete.');
  assert.equal(voice.getSpokenHistory().length, 1);
});

test('3. Unified Single Memory Store: auto-saves ordinary facts, routes sensitive items to Review, blocks secrets/passwords/financial IDs, edits, deletes with separate ledger content, and exports MEMORY.md & USER.md', () => {
  const ledger = new MemoryLedger(false);
  const queuedProposals: ReviewProposalItem[] = [];
  const store = new UnifiedMemoryStore(
    INITIAL_UNIFIED_MEMORY_ITEMS,
    ledger,
    (prop) => queuedProposals.push(prop)
  );

  const initialCount = store.getItems().length;

  // A) Auto-save ordinary preference without asking -> returns quiet 'Saved' toast
  const saveRes = store.proposeOrSave({
    text: 'Prefers 2-space indentation in TypeScript files.',
    category: 'Preferences',
    savedFrom: 'Chat: Code Review',
    chatId: 'chat-ts-1',
  });
  assert.equal(saveRes.status, 'saved_automatically');
  assert.equal(saveRes.toast?.message, 'Saved');
  assert.ok(saveRes.item);
  assert.equal(store.getItems().length, initialCount + 1);

  // Verify ledger recorded memory_created WITHOUT raw memory text inside immutable payload
  const createEvents = ledger.getEvents().filter((e) => e.type === 'memory_created');
  assert.equal(createEvents.length, 1);
  const explainedEvent = JSON.stringify(ledger.explain(createEvents[0].id));
  assert.equal(
    JSON.stringify(createEvents[0]).includes('Prefers 2-space indentation') ||
      explainedEvent.includes('Prefers 2-space indentation'),
    false,
    'Raw memory text must be kept separate from immutable ledger payload'
  );
  assert.equal(
    store.getExternalContent(saveRes.item!.ledgerContentRef),
    'Prefers 2-space indentation in TypeScript files.'
  );

  // B) Hard-block secrets, passwords, API keys, and financial identifiers
  const blockedPassword = store.proposeOrSave({
    text: 'My staging password is super-secret-password-99',
    category: 'Facts',
    savedFrom: 'Chat',
  });
  assert.equal(blockedPassword.status, 'blocked_secret');

  const blockedFinancial = store.proposeOrSave({
    text: 'Primary bank account number is 00918273645123',
    category: 'Facts',
    savedFrom: 'Chat',
  });
  assert.equal(blockedFinancial.status, 'blocked_secret');

  // C) Sensitive category asks first -> routes to Review inbox instead of auto-saving
  const sensitiveRes = store.proposeOrSave({
    text: 'Has a peanut allergy and carries an inhaler.',
    category: 'About you',
    savedFrom: 'Chat',
  });
  assert.equal(sensitiveRes.status, 'needs_review');
  assert.equal(queuedProposals.length, 1);
  assert.equal(queuedProposals[0].type, 'memory');

  // D) Edit existing memory item -> updates content & records ledger event
  const editRes = store.edit(saveRes.item!.id, {
    text: 'Prefers 2-space indentation and strict null checks in TypeScript.',
    pinned: true,
    expiresAt: '2027-01-15',
  });
  assert.equal(editRes.ok, true);
  assert.equal(editRes.item?.pinned, true);
  assert.equal(editRes.item?.expiresAt, '2027-01-15');
  assert.equal(
    store.getExternalContent(saveRes.item!.ledgerContentRef),
    'Prefers 2-space indentation and strict null checks in TypeScript.'
  );

  // E) Delete memory item -> removes item AND purges external ledger content so deletion works
  const deletedOk = store.delete(saveRes.item!.id);
  assert.equal(deletedOk, true);
  assert.equal(store.getExternalContent(saveRes.item!.ledgerContentRef), undefined);
  const deleteEvents = ledger.getEvents().filter((e) => e.type === 'memory_deleted');
  assert.equal(deleteEvents.length, 1);

  // F) Pause saving switch prevents automatic saving
  store.setPauseSaving(true);
  assert.equal(store.isPaused(), true);
  const pausedRes = store.proposeOrSave({
    text: 'Uses dark theme at night.',
    category: 'Habits',
    savedFrom: 'Chat',
  });
  assert.equal(pausedRes.status, 'paused');
  store.setPauseSaving(false);

  // G) Forget this chat removes all memories from that chatId
  store.proposeOrSave({
    text: 'Temp fact from session 42',
    category: 'Facts',
    savedFrom: 'Chat 42',
    chatId: 'session-42',
  });
  const forgotten = store.forgetChat('session-42');
  assert.equal(forgotten, 1);

  // H) Export MEMORY.md and USER.md from the single store
  const memoryMd = store.exportMarkdown('MEMORY.md');
  const userMd = store.exportMarkdown('USER.md');
  assert.ok(memoryMd.includes('# MEMORY.md — Exported from Unified Memory Store'));
  assert.ok(userMd.includes('# USER.md — Exported from Unified Memory Store'));
});

test('4. Scoped Rule Book & Non-Finance Plugin Enforcement: enforces scopes and guarantees plugin manifests can only tighten rules, never loosen them', () => {
  // User-created non-finance plugin that attempts to loosen 'destructive' to 'allow'
  // while tightening 'read' to 'ask_first'
  const userCreatedPlugin: InstalledPluginRecord = {
    id: 'plugin-user-diagram-sync',
    name: 'Diagram Sync Utility',
    version: '1.0.0',
    enabled: true,
    permissionsSummary: 'Reads and exports architecture diagrams in project folders.',
    permissions: ['diagrams:read', 'diagrams:write'],
    origin: 'created_with_morrow',
    manifestConstraints: [
      {
        actionClass: 'destructive',
        mode: 'allow', // Attempts to loosen the Everywhere 'ask_first' rule!
        reason: 'Plugin tries to allow deleting old diagrams without asking.',
      },
      {
        actionClass: 'read',
        mode: 'ask_first', // Tightens default 'allow' to 'ask_first'
        reason: 'Plugin asks before reading diagram files.',
      },
    ],
  };

  // 1) Destructive action: Rule Book says 'ask_first' (Everywhere). Manifest says 'allow'.
  // Result MUST be 'ask_first' and manifestAttemptedLoosenIgnored === true.
  const destructiveEval = evaluatePluginActionWithScopedRules({
    plugin: userCreatedPlugin,
    actionClass: 'destructive',
    actionSummary: 'Delete diagram archive folder',
    projectName: 'Work',
    rules: INITIAL_SCOPED_RULES,
  });
  assert.equal(destructiveEval.effectiveEnforcement, 'ask_first');
  assert.equal(destructiveEval.manifestAttemptedLoosenIgnored, true);

  // 2) Read action: Rule Book allows 'read' by default, but plugin manifest tightens it to 'ask_first'.
  const readEval = evaluatePluginActionWithScopedRules({
    plugin: userCreatedPlugin,
    actionClass: 'read',
    actionSummary: 'Read architecture diagram',
    projectName: 'Work',
    rules: INITIAL_SCOPED_RULES,
  });
  assert.equal(readEval.effectiveEnforcement, 'ask_first');
  assert.equal(readEval.manifestTightened, true);

  // 3) Credential action: Rule Book blocks 'credential' Everywhere.
  const credEval = evaluatePluginActionWithScopedRules({
    plugin: userCreatedPlugin,
    actionClass: 'credential',
    actionSummary: 'Read SSH key file',
    projectName: 'Work',
    rules: INITIAL_SCOPED_RULES,
  });
  assert.equal(credEval.effectiveEnforcement, 'block');
});

test('5. Unified Review Inbox (Proof > Review): supports all 8 proposal types with plain-language diff, Approve, Reject, and badge count', () => {
  const inbox = new UnifiedReviewInbox(INITIAL_REVIEW_PROPOSALS);

  // Check that all 8 required proposal types are present in the inbox
  const presentTypes = new Set(inbox.getAll().map((p) => p.type));
  for (const requiredType of ALL_REVIEW_PROPOSAL_TYPES) {
    assert.equal(
      presentTypes.has(requiredType),
      true,
      `Missing proposal type "${requiredType}" in Review inbox`
    );
  }

  // Every item has a plain-language before & after diff
  for (const item of inbox.getAll()) {
    assert.ok(item.plainDiff.before.length > 0);
    assert.ok(item.plainDiff.after.length > 0);
  }

  const startPending = inbox.getPendingCount();
  assert.equal(startPending, 8);

  // Approve a skill proposal -> status becomes 'approved' and pending badge decrements
  const approveRes = inbox.decide('rev-skill-1', 'approved');
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.item?.status, 'approved');
  assert.equal(inbox.getPendingCount(), startPending - 1);

  // Reject a connector_write proposal -> status becomes 'rejected' and pending badge decrements
  const rejectRes = inbox.decide('rev-connector-1', 'rejected');
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.item?.status, 'rejected');
  assert.equal(inbox.getPendingCount(), startPending - 2);
});

test('6. Soul template round-trip, Skills filtering, and Zero Finance/L3xi mentions across all defaults', () => {
  const exported = exportSoulTemplateJson(DEFAULT_SOUL_PROFILE_CONFIG);
  const imported = importSoulTemplateJson(exported);
  assert.equal(imported.ok, true);
  assert.equal(imported.profile?.identity.name, 'Morrow');

  assert.equal(filterUnifiedSkills(INITIAL_UNIFIED_SKILLS, 'recorded').length, 1);
  assert.equal(filterUnifiedSkills(INITIAL_UNIFIED_SKILLS, 'from_chat').length, 1);
  assert.equal(filterUnifiedSkills(INITIAL_UNIFIED_SKILLS, 'mine').length, 2);

  // Verify zero mentions of L3xi or finance across all default items
  const serializedBundle = JSON.stringify({
    groups: SIDEBAR_NAVIGATION_GROUPS,
    memories: INITIAL_UNIFIED_MEMORY_ITEMS,
    soul: DEFAULT_SOUL_PROFILE_CONFIG,
    skills: INITIAL_UNIFIED_SKILLS,
    plugins: INITIAL_INSTALLED_PLUGINS,
    rules: INITIAL_SCOPED_RULES,
    reviews: INITIAL_REVIEW_PROPOSALS,
  }).toLowerCase();

  assert.equal(serializedBundle.includes('l3xi'), false, 'Must not mention l3xi');
  assert.equal(serializedBundle.includes('finance'), false, 'Must not mention finance');
  assert.equal(serializedBundle.includes('mockbank'), false, 'Must not mention mockbank');
});
