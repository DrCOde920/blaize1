/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Security Tests for PROMPT: FILE MAP ('My Places'), Library > Places
 * (`src/packages/places/index.test.ts`)
 *
 * Covers:
 * 1. Path-escape canonicalization (.., symlinks/junctions, case differences, UNC paths, Windows 8.3 short names, drive roots)
 * 2. Deny-over-allow & default Never list + outside chosen roots = Never + unknown inside root = Ask first + re-auth to change Never -> Allowed
 * 3. Never-go enforcement across file tools, workspace tools, skills, scheduled chores, shell commands, subagents, and connectors
 * 4. Strict content privacy: no content read from a Never place or place without allowContentIndexing; zero Never leaks in model snippets
 * 5. Teach It Three Ways (Describe -> Zod PlaceRule, Record -> keyframe blur, Snap -> sketch extractor, Corrections -> rule proposal & Review escalation)
 * 6. places.find(intent) and places.suggest_destination(file) accuracy on fixture trees + reversible PlacesUndoJournal (move, never delete)
 * 7. Map freshness after a folder rename (detected by folderFileId/hash)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_FILE_SYSTEM_BRIDGE,
  DEFAULT_CHOSEN_ROOTS,
  INITIAL_INDEXED_FILES,
  INITIAL_USER_PLACES,
  PlaceRule,
  PlacesGuardCaller,
  PlacesUndoJournal,
  applyUserPlaceCorrection,
  buildSafeModelPlacesSnippet,
  canonicalizePlacePath,
  changePlaceStatusWithReauth,
  compileDescribeToPlaceProposals,
  compileRecordedExplorerSessionToProposals,
  compileSnapSketchToPlaceProposals,
  evaluateMapHealthAndHealRenames,
  evaluatePlacesGuard,
  placesFind,
  placesSuggestDestination,
} from './index';

test('1. Path-escape canonicalization: resolves .., symlinks/junctions, case differences, UNC paths, Windows 8.3 short names, and drive roots', () => {
  // '..' traversal trying to escape Allowed Downloads into ~/.ssh
  const dotDotEscape = canonicalizePlacePath('/Users/alex/Downloads/../../alex/.ssh/id_ed25519');
  assert.equal(dotDotEscape, '/users/alex/.ssh/id_ed25519');

  // Symlink / junction resolution trying to alias an Allowed folder to a Never folder
  const symlinkEscape = canonicalizePlacePath('/Users/alex/Documents/SafeLink/secret_key.pem', {
    symlinksAndJunctions: {
      '/Users/alex/Documents/SafeLink': '/Users/alex/.ssh',
    },
  });
  assert.equal(symlinkEscape, '/users/alex/.ssh/secret_key.pem');

  // Case differences (mixed case on macOS/Windows)
  const mixedCase = canonicalizePlacePath('/USERS/ALEX/Pictures/FAMILY PHOTOS/IMG_001.JPG');
  assert.equal(mixedCase, '/users/alex/pictures/family photos/img_001.jpg');

  // Windows UNC path and extended-length prefix
  const uncPath = canonicalizePlacePath('\\\\?\\UNC\\FileServer01\\PrivateShare\\Vault\\keys.kdbx');
  assert.equal(uncPath, '//fileserver01/privateshare/vault/keys.kdbx');

  // Windows 8.3 short names (PROGRA~1 -> program files) and drive root
  const winShortName = canonicalizePlacePath('C:\\PROGRA~1\\App\\config.ini');
  assert.equal(winShortName, 'c:/program files/app/config.ini');

  const winDriveRoot = canonicalizePlacePath('C:\\Windows\\System32\\drivers\\etc\\hosts');
  assert.equal(winDriveRoot, 'c:/windows/system32/drivers/etc/hosts');
});

test('2. Deny-over-allow, outside roots = Never, unknown = Ask first, and re-authentication required to change Never -> Allowed', () => {
  // Even if an Allowed rule is added on /Users/alex/Pictures, the Never rule on /Users/alex/Pictures/Family Photos MUST win (Deny beats Allow)
  const placesWithParentAllowed: PlaceRule[] = [
    ...INITIAL_USER_PLACES,
    {
      id: 'place-pictures-parent',
      path: '/Users/alex/Pictures',
      canonicalPath: canonicalizePlacePath('/Users/alex/Pictures'),
      label: 'Pictures Root',
      purpose: 'General images',
      belongsHere: { fileTypes: ['jpg', 'png'], namePatterns: ['*'], keywords: ['picture'] },
      allowedActions: ['read', 'add', 'move'],
      status: 'allowed',
      allowContentIndexing: false,
      isDefaultNever: false,
      folderFileId: 'fid-pictures-root',
      lastScannedAtIso: '2026-10-31T20:00:00Z',
      itemCount: 5,
      correctionCount: 0,
    },
  ];

  const denyOverAllow = evaluatePlacesGuard({
    caller: 'files_plugin',
    operation: 'read',
    targetPath: '/Users/alex/Pictures/Family Photos/summer_2025.jpg',
    places: placesWithParentAllowed,
    chosenRoots: DEFAULT_CHOSEN_ROOTS,
  });
  assert.equal(denyOverAllow.allowed, false);
  assert.equal(denyOverAllow.status, 'never');
  assert.equal(denyOverAllow.blockedMessage, 'That folder is off limits');
  assert.equal(denyOverAllow.offerChangeRuleAction, true);

  // Anything outside chosen roots is Never
  const outsideRoots = evaluatePlacesGuard({
    caller: 'workspace_tool',
    operation: 'read',
    targetPath: '/var/log/syslog',
    places: INITIAL_USER_PLACES,
    chosenRoots: DEFAULT_CHOSEN_ROOTS,
  });
  assert.equal(outsideRoots.allowed, false);
  assert.equal(outsideRoots.status, 'never');
  assert.equal(outsideRoots.blockedMessage, 'That folder is off limits');

  // Unknown folder inside chosen roots defaults to Ask first
  const unknownInsideRoot = evaluatePlacesGuard({
    caller: 'files_plugin',
    operation: 'read',
    targetPath: '/Users/alex/Documents/UnmappedSubfolder/draft.pdf',
    places: INITIAL_USER_PLACES,
    chosenRoots: DEFAULT_CHOSEN_ROOTS,
  });
  assert.equal(unknownInsideRoot.allowed, false);
  assert.equal(unknownInsideRoot.status, 'ask_first');

  // Changing Never -> Allowed without re-auth fails; with re-auth succeeds and emits warning for default Never items
  const failedReauth = changePlaceStatusWithReauth({
    placeId: 'place-never-ssh',
    nextStatus: 'allowed',
    places: INITIAL_USER_PLACES,
    reauthPinOrBiometricPassed: false,
  });
  assert.equal(failedReauth.ok, false);

  const passedReauth = changePlaceStatusWithReauth({
    placeId: 'place-never-ssh',
    nextStatus: 'allowed',
    places: INITIAL_USER_PLACES,
    reauthPinOrBiometricPassed: true,
  });
  assert.equal(passedReauth.ok, true);
  assert.ok(passedReauth.warningMessage?.includes('Default Never list'));
});

test('3. Never-go enforcement across all callers: files_plugin, workspace_tool, skill, scheduled_chore, shell_command, subagent, and connector', () => {
  const allCallers: PlacesGuardCaller[] = [
    'files_plugin',
    'workspace_tool',
    'skill',
    'scheduled_chore',
    'shell_command',
    'subagent',
    'connector',
  ];

  for (const caller of allCallers) {
    const target =
      caller === 'shell_command'
        ? 'cat /Users/alex/Downloads/../.ssh/id_ed25519'
        : '/Users/alex/Downloads/../.ssh/id_ed25519';

    const decision = evaluatePlacesGuard({
      caller,
      operation: 'read',
      targetPath: target,
      places: INITIAL_USER_PLACES,
      chosenRoots: DEFAULT_CHOSEN_ROOTS,
    });

    assert.equal(decision.allowed, false, `Caller ${caller} should be blocked`);
    assert.equal(decision.status, 'never', `Caller ${caller} should have status 'never'`);
    assert.equal(decision.blockedMessage, 'That folder is off limits');
  }

  // Also test Windows short-name shell command blocked
  const winCmdDecision = evaluatePlacesGuard({
    caller: 'shell_command',
    operation: 'read',
    targetPath: 'type C:\\PROGRA~1\\App\\secret.dll',
    places: INITIAL_USER_PLACES,
    chosenRoots: DEFAULT_CHOSEN_ROOTS,
  });
  assert.equal(winCmdDecision.allowed, false);
  assert.equal(winCmdDecision.status, 'never');
  assert.equal(winCmdDecision.blockedMessage, 'That folder is off limits');
});

test('4. No content read from a Never place or non-content-indexed place, and Never places never appear in model snippets', () => {
  const fixtureEntries = [
    {
      name: 'id_ed25519',
      path: '/Users/alex/.ssh/id_ed25519',
      kind: 'file' as const,
      sizeBytes: 3200,
      rawDiskContent: 'PRIVATE_KEY_MATERIAL_NEVER_READ',
    },
    {
      name: 'family_reunion.jpg',
      path: '/Users/alex/Pictures/Family Photos/family_reunion.jpg',
      kind: 'file' as const,
      sizeBytes: 4200000,
      rawDiskContent: 'EXIF_PRIVATE_FAMILY_PHOTO',
    },
    {
      name: 'tax_return_2025.pdf',
      path: '/Users/alex/Documents/Taxes/tax_return_2025.pdf',
      kind: 'file' as const,
      sizeBytes: 512000,
      // place-taxes has allowContentIndexing: false -> must NOT read rawDiskContent!
      rawDiskContent: 'SSN_AND_TAX_RETURN_BODY_DO_NOT_INDEX',
    },
    {
      name: 'receipt_october_dinner.pdf',
      path: '/Users/alex/Documents/Finance/2026/receipt_october_dinner.pdf',
      kind: 'file' as const,
      sizeBytes: 120000,
      // place-finance-2026 has allowContentIndexing: true -> allowed snippet read
      rawDiskContent: 'Receipt Total: $42.50 - Business Dinner October 2026',
    },
  ];

  const scanRes = BROWSER_FILE_SYSTEM_BRIDGE.scanMetadataOnly(
    fixtureEntries,
    INITIAL_USER_PLACES,
    DEFAULT_CHOSEN_ROOTS
  );

  // 2 Never files skipped completely
  assert.equal(scanRes.skippedNeverCount, 2);
  assert.equal(scanRes.indexedFiles.length, 2);
  // Only 1 file had content read (where allowContentIndexing === true)
  assert.equal(scanRes.contentReadsPerformed, 1);

  const taxIndexed = scanRes.indexedFiles.find((f) => f.name === 'tax_return_2025.pdf');
  assert.ok(taxIndexed);
  assert.equal(taxIndexed.allowedContentSnippet, undefined);

  const receiptIndexed = scanRes.indexedFiles.find((f) => f.name === 'receipt_october_dinner.pdf');
  assert.ok(receiptIndexed);
  assert.ok(receiptIndexed.allowedContentSnippet?.includes('Receipt Total: $42.50'));

  // Model prompt snippet never mentions .ssh or Family Photos
  const promptSnippet = buildSafeModelPlacesSnippet(INITIAL_USER_PLACES, scanRes.indexedFiles);
  assert.equal(promptSnippet.includes('.ssh'), false);
  assert.equal(promptSnippet.includes('Family Photos'), false);
  assert.equal(promptSnippet.includes('PRIVATE_KEY_MATERIAL'), false);
});

test('5. Teach It Three Ways (Describe, Record, Snap) and natural-language Corrections', () => {
  // 1. Describe
  const descProposals = compileDescribeToPlaceProposals(
    'My tax papers live in Documents/Taxes. Never touch Family Photos.'
  );
  assert.equal(descProposals.length, 2);
  assert.equal(descProposals[0].zodValidated, true);
  assert.equal(descProposals[0].proposedRule.status, 'allowed');
  assert.equal(descProposals[0].proposedRule.path, '/Users/alex/Documents/Taxes');
  assert.equal(descProposals[1].proposedRule.status, 'never');
  assert.ok(descProposals[1].proposedRule.label.includes('Family Photos'));

  // 2. Record (only selected keyframes sent to model, with privacy blur flag)
  const recRes = compileRecordedExplorerSessionToProposals([
    {
      keyframeId: 'kf-1',
      folderPath: '/Users/alex/Documents/Contracts',
      narrationText: 'My client contracts live in Documents/Contracts.',
      selectedForModel: true,
      blurredPrivateRegions: true,
    },
    {
      keyframeId: 'kf-2-private',
      folderPath: '/Users/alex/Documents/PrivateMedical',
      narrationText: 'Unselected frame that should not be sent.',
      selectedForModel: false,
      blurredPrivateRegions: true,
    },
  ]);
  assert.deepEqual(recRes.sentKeyframeIds, ['kf-1']);
  assert.deepEqual(recRes.excludedKeyframeIds, ['kf-2-private']);
  assert.equal(recRes.proposals.length, 1);
  assert.equal(recRes.proposals[0].proposedRule.label, 'Contracts');

  // 3. Snap (sketch/screenshot extraction)
  const snapProposals = compileSnapSketchToPlaceProposals({
    sourceKind: 'hand_drawn_sketch',
    extractedLines: [
      {
        folderPathOrName: 'DesignAssets/Logos',
        handwrittenNote: 'Where brand logos and SVG icons go',
        statusHint: 'allowed',
      },
    ],
  });
  assert.equal(snapProposals.length, 1);
  assert.equal(snapProposals[0].proposedRule.label, 'Logos');
  assert.equal(snapProposals[0].zodValidated, true);

  // 4. Corrections: 'No, receipts go in Finance/2026' -> updates rule and promotes to Review after repeated correction
  const corrRes = applyUserPlaceCorrection('No, receipts go in Finance/2026', INITIAL_USER_PLACES);
  assert.equal(corrRes.recognized, true);
  assert.equal(corrRes.isChangingExistingRule, true);
  assert.equal(corrRes.promoteToReviewInbox, true); // existing place-finance-2026 had correctionCount 1 -> now 2
  assert.equal(corrRes.proposal?.proposedRule.path, '/Users/alex/Documents/Finance/2026');
});

test('6. GET and PUT: places.find(intent) and places.suggest_destination(file) accuracy + reversible PlacesUndoJournal', () => {
  // places.find('find my passport scan')
  const findRes = placesFind('find my passport scan', INITIAL_INDEXED_FILES, INITIAL_USER_PLACES);
  assert.ok(findRes.candidates.length >= 1);
  assert.equal(findRes.candidates[0].file.name, 'alex_passport_scan_2026.pdf');
  assert.equal(findRes.candidates[0].place.id, 'place-travel-docs');
  assert.ok(findRes.candidates[0].confidence >= 0.8);

  // places.suggest_destination for a receipt file
  const suggestReceipt = placesSuggestDestination(
    { name: 'receipt_october_airline_baggage.pdf', sizeBytes: 180_000 },
    INITIAL_USER_PLACES
  );
  assert.ok(suggestReceipt.topSuggestion);
  assert.equal(suggestReceipt.topSuggestion.place.id, 'place-finance-2026');
  assert.equal(suggestReceipt.topSuggestion.canAutoMoveInChore, true);

  // places.suggest_destination for a passport / visa file -> place is 'ask_first', so requiresAsk MUST be true
  const suggestVisa = placesSuggestDestination(
    { name: 'japan_tourist_visa_scan.pdf', sizeBytes: 420_000 },
    INITIAL_USER_PLACES
  );
  assert.ok(suggestVisa.topSuggestion);
  assert.equal(suggestVisa.topSuggestion.place.id, 'place-travel-docs');
  assert.equal(suggestVisa.topSuggestion.canAutoMoveInChore, false);
  assert.equal(suggestVisa.topSuggestion.requiresAsk, true);

  // Reversible Undo Journal (move, never delete)
  const journal = new PlacesUndoJournal();
  const moveEntry = journal.recordMove({
    fileName: 'receipt_october_airline_baggage.pdf',
    fromFolder: '/Users/alex/Downloads',
    destinationPlace: suggestReceipt.topSuggestion.place,
  });
  assert.equal(moveEntry.operation, 'move_never_delete');
  assert.equal(moveEntry.undone, false);

  const undoRes = journal.undoMove(moveEntry.entryId);
  assert.equal(undoRes.ok, true);
  assert.equal(undoRes.entry?.undone, true);
  assert.ok(undoRes.summary.includes('Restored "receipt_october_airline_baggage.pdf"'));
});

test('7. Map freshness after a folder rename: detects renamed folder by folderFileId and heals path', () => {
  // Simulate user renaming '/Users/alex/Documents/Taxes' -> '/Users/alex/Documents/Tax_Archive_2026' on disk
  // while keeping the same stable `folderFileId: 'fid-folder-taxes-2026'`
  const diskSnapshot = [
    {
      path: '/Users/alex/Documents/Tax_Archive_2026',
      folderFileId: 'fid-folder-taxes-2026',
      exists: true,
      itemCount: 16,
    },
    {
      path: '/Users/alex/Documents/Finance/2026',
      folderFileId: 'fid-folder-finance-2026',
      exists: true,
      itemCount: 28,
    },
    {
      path: '/Users/alex/Documents/Travel & IDs',
      folderFileId: 'fid-folder-travel-ids',
      exists: true,
      itemCount: 9,
    },
    {
      path: '/Users/alex/Downloads',
      folderFileId: 'fid-folder-downloads',
      exists: true,
      itemCount: 19,
    },
    {
      path: '/Users/alex/Projects/WorkspaceNotes',
      folderFileId: 'fid-folder-project-notes',
      exists: true,
      itemCount: 22,
    },
  ];

  const report = evaluateMapHealthAndHealRenames(INITIAL_USER_PLACES, diskSnapshot);
  const renameIssue = report.issues.find((i) => i.kind === 'renamed_or_moved');
  assert.ok(renameIssue);
  assert.equal(renameIssue.oldPath, '/Users/alex/Documents/Taxes');
  assert.equal(renameIssue.detectedNewPath, '/Users/alex/Documents/Tax_Archive_2026');

  const healedTaxPlace = report.healedPlaces.find((p) => p.id === 'place-taxes');
  assert.ok(healedTaxPlace);
  assert.equal(healedTaxPlace.path, '/Users/alex/Documents/Tax_Archive_2026');
  assert.equal(healedTaxPlace.itemCount, 16);
});
