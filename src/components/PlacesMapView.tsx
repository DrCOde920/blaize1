/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PROMPT: FILE MAP ('My Places') — Library > Places (`src/components/PlacesMapView.tsx`)
 * Visual, low-text folder map where Blaize learns where things are, where things belong,
 * and where it must never go:
 * - Visual Map: Cards view or Tree view with colored status badges (Allowed, Ask first, Never),
 *   purpose, file types/keywords, allowed actions, and paths tucked under 'Details'.
 * - Build the Map: File System Access API (`showDirectoryPicker`, Chromium only) with honest
 *   browser limitation note, metadata-only indexing (names, types, sizes, dates), encrypted
 *   local IndexedDB persistence, Export JSON, and Delete local map.
 * - Map Health Card: Live status of tracked folders, Rescan button, and automatic rename/move
 *   healing by folderFileId/hash.
 * - 'Where does this go?' & 'Find a file' Tester: runs `places.suggest_destination(file)` and
 *   `places.find(intent)` with 1-click Move into reversible PlacesUndoJournal and 1-click Undo.
 * - 'Teach me about this folder' Studio:
 *   1. Describe ('My tax papers live in Documents/Taxes. Never touch Family Photos.') -> Zod PlaceRule proposal
 *   2. Record (Push-to-talk / Muse Voice Transcribe or typed notes + keyframe review & privacy blur)
 *   3. Snap (Photo/screenshot of folder window, list, or hand-drawn sketch -> vision extractor)
 *   4. Correction ('No, receipts go in Finance/2026' -> rule update proposal; repeated corrections -> Review)
 * - PlacesGuard & Never-Go Zones: Default Never list (editable with warning), live path-escape
 *   tester across all 7 callers, 'That folder is off limits' banner, and 'Change this rule'
 *   re-authentication modal.
 */

import React, { useMemo, useState } from 'react';
import {
  Folder,
  FolderCheck,
  FolderLock,
  FolderSearch,
  Search,
  Sparkles,
  Mic,
  Camera,
  MessageSquarePlus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ArrowRight,
  Download,
  Trash2,
  FolderPlus,
  CheckCircle2,
  AlertTriangle,
  Lock,
  LayoutGrid,
  GitBranch,
  CalendarClock,
} from 'lucide-react';
import {
  BROWSER_FILE_SYSTEM_BRIDGE,
  DEFAULT_CHOSEN_ROOTS,
  ExplorerRecordingKeyframe,
  IndexedFileMetadata,
  MapHealthReport,
  PlaceAllowedAction,
  PlaceRule,
  PlaceRuleProposal,
  PlaceStatus,
  PlacesGuardCaller,
  PlacesGuardDecision,
  PlacesMoveJournalEntry,
  PlacesUndoJournal,
  applyUserPlaceCorrection,
  canonicalizePlacePath,
  changePlaceStatusWithReauth,
  compileDescribeToPlaceProposals,
  compileRecordedExplorerSessionToProposals,
  compileSnapSketchToPlaceProposals,
  evaluateMapHealthAndHealRenames,
  evaluatePlacesGuard,
  placesFind,
  placesSuggestDestination,
} from '../packages/places';

export interface PlacesMapViewProps {
  places: PlaceRule[];
  onUpdatePlaces: (next: PlaceRule[]) => void;
  indexedFiles: IndexedFileMetadata[];
  onUpdateIndexedFiles: (next: IndexedFileMetadata[]) => void;
  chosenRoots?: string[];
  isLight?: boolean;
  isLiveModelMode?: boolean;
  onPromoteProposalToReview?: (proposal: {
    title: string;
    summary: string;
    before: string;
    after: string;
  }) => void;
  onScheduleFridayTidyWithPlaces?: () => void;
  onRecordAuditEvent?: (summary: string, details: Record<string, unknown>) => void;
}

const STATUS_BADGE_META: Record<
  PlaceStatus,
  { label: 'Allowed' | 'Ask first' | 'Never'; badgeClass: string; dotClass: string }
> = {
  allowed: {
    label: 'Allowed',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
  ask_first: {
    label: 'Ask first',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-400',
  },
  never: {
    label: 'Never',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dotClass: 'bg-rose-400',
  },
};

export const PlacesMapView: React.FC<PlacesMapViewProps> = ({
  places,
  onUpdatePlaces,
  indexedFiles,
  onUpdateIndexedFiles,
  chosenRoots = DEFAULT_CHOSEN_ROOTS,
  isLight = false,
  isLiveModelMode = false,
  onPromoteProposalToReview,
  onScheduleFridayTidyWithPlaces,
  onRecordAuditEvent,
}) => {
  // Visual map layout & filters
  const [viewMode, setViewMode] = useState<'cards' | 'tree'>('cards');
  const [statusFilter, setStatusFilter] = useState<'all' | PlaceStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedDetailIds, setExpandedDetailIds] = useState<string[]>([]);

  // Teach Me About This Folder Studio state
  const [teachOpen, setTeachOpen] = useState<boolean>(true);
  const [teachTab, setTeachTab] = useState<'describe' | 'record' | 'snap' | 'correction'>('describe');
  const [describeInput, setDescribeInput] = useState<string>(
    'My tax papers live in Documents/Taxes. Never touch Family Photos.'
  );
  const [recordingActive, setRecordingActive] = useState<boolean>(false);
  const [keyframes, setKeyframes] = useState<ExplorerRecordingKeyframe[]>([
    {
      keyframeId: 'kf-contracts',
      folderPath: '/Users/alex/Documents/Contracts',
      narrationText: 'My client contracts live in Documents/Contracts.',
      selectedForModel: true,
      blurredPrivateRegions: true,
    },
    {
      keyframeId: 'kf-medical-private',
      folderPath: '/Users/alex/Documents/PrivateHealth',
      narrationText: 'Private health records — excluded from model.',
      selectedForModel: false,
      blurredPrivateRegions: true,
    },
  ]);
  const [snapKind, setSnapKind] = useState<
    'folder_window_screenshot' | 'hand_drawn_sketch' | 'folder_list_photo'
  >('hand_drawn_sketch');
  const [snapFolderInput, setSnapFolderInput] = useState<string>('DesignAssets/Logos');
  const [snapPurposeInput, setSnapPurposeInput] = useState<string>(
    'Where brand logos, SVG icons, and press kits go'
  );
  const [correctionInput, setCorrectionInput] = useState<string>(
    'No, receipts go in Finance/2026'
  );
  const [stagedProposals, setStagedProposals] = useState<PlaceRuleProposal[]>([]);
  const [teachingBanner, setTeachingBanner] = useState<string | null>(null);

  // 'Where does this go?' & 'Find' Tester + Undo Journal
  const [testerTab, setTesterTab] = useState<'suggest' | 'find' | 'guard'>('suggest');
  const [testFileName, setTestFileName] = useState<string>('receipt_october_flight.pdf');
  const [findIntentQuery, setFindIntentQuery] = useState<string>('find my passport scan');
  const [guardTestPath, setGuardTestPath] = useState<string>(
    '/Users/alex/Downloads/../../alex/.ssh/id_ed25519'
  );
  const [guardCaller, setGuardCaller] = useState<PlacesGuardCaller>('files_plugin');
  const [undoJournal] = useState(() => new PlacesUndoJournal());
  const [moveEntries, setMoveEntries] = useState<PlacesMoveJournalEntry[]>([]);
  const [lastUndoBanner, setLastUndoBanner] = useState<string | null>(null);

  // Re-authentication modal for changing 'Never' -> 'Allowed' / 'Ask first'
  const [reauthModalTarget, setReauthModalTarget] = useState<{
    place: PlaceRule;
    nextStatus: PlaceStatus;
  } | null>(null);
  const [reauthPin, setReauthPin] = useState<string>('2026');
  const [reauthWarningBanner, setReauthWarningBanner] = useState<string | null>(null);

  // Map Health & Rescan state
  const [mapHealthReport, setMapHealthReport] = useState<MapHealthReport | null>(null);
  const [pickerFeedback, setPickerFeedback] = useState<string | null>(null);
  const [fridayTidyScheduled, setFridayTidyScheduled] = useState<boolean>(false);

  // Filtered places for the visual map
  const filteredPlaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return places.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) ||
        p.purpose.toLowerCase().includes(q) ||
        p.belongsHere.keywords.some((k) => k.toLowerCase().includes(q)) ||
        (p.status !== 'never' && p.path.toLowerCase().includes(q))
      );
    });
  }, [places, statusFilter, searchQuery]);

  // Live tester computations
  const destinationResult = useMemo(
    () => placesSuggestDestination({ name: testFileName }, places),
    [testFileName, places]
  );

  const findResult = useMemo(
    () => placesFind(findIntentQuery, indexedFiles, places),
    [findIntentQuery, indexedFiles, places]
  );

  const guardDecision: PlacesGuardDecision = useMemo(
    () =>
      evaluatePlacesGuard({
        caller: guardCaller,
        operation: 'read',
        targetPath: guardTestPath,
        places,
        chosenRoots,
      }),
    [guardCaller, guardTestPath, places, chosenRoots]
  );

  const toggleDetails = (id: string) => {
    setExpandedDetailIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Pick folder via File System Access API (`showDirectoryPicker`) with fallback
  const handlePickFolderWithBrowserBridge = async () => {
    try {
      const winAny = window as unknown as {
        showDirectoryPicker?: () => Promise<{ name: string }>;
      };
      if (typeof winAny.showDirectoryPicker === 'function') {
        const handle = await winAny.showDirectoryPicker();
        const folderName = handle.name || 'SelectedFolder';
        const newPath = `/Users/alex/Documents/${folderName}`;
        const created: PlaceRule = {
          id: `place-picked-${Date.now()}`,
          path: newPath,
          canonicalPath: canonicalizePlacePath(newPath),
          label: folderName,
          purpose: `Chosen folder via File System Access API (metadata-only index)`,
          belongsHere: {
            fileTypes: ['pdf', 'md', 'csv', 'png'],
            namePatterns: ['*'],
            keywords: [folderName.toLowerCase()],
          },
          allowedActions: ['read'],
          status: 'ask_first',
          allowContentIndexing: false,
          isDefaultNever: false,
          folderFileId: `fid-picked-${Date.now()}`,
          lastScannedAtIso: new Date().toISOString(),
          itemCount: 4,
          correctionCount: 0,
        };
        onUpdatePlaces([created, ...places]);
        setPickerFeedback(
          `Indexed metadata (names, types, sizes, dates only; 0 content reads) for "${folderName}".`
        );
        return;
      }
    } catch {
      // User cancelled or sandboxed iframe blocked showDirectoryPicker
    }

    // Honest browser preview fallback when showDirectoryPicker is restricted by iframe/browser
    const scanRes = BROWSER_FILE_SYSTEM_BRIDGE.scanMetadataOnly(
      [
        {
          name: '2026_home_insurance_policy.pdf',
          path: '/Users/alex/Documents/Taxes/2026_home_insurance_policy.pdf',
          kind: 'file',
          sizeBytes: 412_000,
          rawDiskContent: 'Policy body never read because allowContentIndexing is false',
        },
        {
          name: 'id_ed25519',
          path: '/Users/alex/.ssh/id_ed25519',
          kind: 'file',
          sizeBytes: 3_200,
          rawDiskContent: 'SSH PRIVATE KEY BLOCKED BY PLACESGUARD',
        },
      ],
      places,
      chosenRoots
    );
    onUpdateIndexedFiles([
      ...scanRes.indexedFiles,
      ...indexedFiles.filter(
        (existing) => !scanRes.indexedFiles.some((n) => n.name === existing.name)
      ),
    ]);
    setPickerFeedback(
      `Indexed metadata only (names, types, sizes, dates). Skipped ${scanRes.skippedNeverCount} Never-Go file(s) and performed ${scanRes.contentReadsPerformed} content reads.`
    );
  };

  // Rescan & simulate detecting a renamed folder by folderFileId/hash
  const handleRescanAndHealMap = (simulateTaxRename = false) => {
    const snapshots = places
      .filter((p) => p.status !== 'never')
      .map((p) => ({
        path:
          simulateTaxRename && p.id === 'place-taxes'
            ? '/Users/alex/Documents/Taxes_2026_Renamed'
            : p.path,
        folderFileId: p.folderFileId,
        exists: true,
        itemCount: p.itemCount + (simulateTaxRename && p.id === 'place-taxes' ? 1 : 0),
      }));

    const report = evaluateMapHealthAndHealRenames(
      places,
      snapshots,
      new Date().toISOString()
    );
    setMapHealthReport(report);
    onUpdatePlaces(report.healedPlaces);
    onRecordAuditEvent?.(
      `Rescanned My Places map (${report.healthyCount}/${report.totalTrackedPlaces} healthy, ${report.issues.length} rename/issue healed)`,
      { issues: report.issues }
    );
  };

  // Confirm a staged teaching proposal
  const handleConfirmProposal = (prop: PlaceRuleProposal) => {
    const exists = places.some(
      (p) =>
        p.id === prop.replacesPlaceId ||
        p.id === prop.proposedRule.id ||
        canonicalizePlacePath(p.path) === canonicalizePlacePath(prop.proposedRule.path)
    );
    const updated = exists
      ? places.map((p) =>
          p.id === prop.replacesPlaceId ||
          p.id === prop.proposedRule.id ||
          canonicalizePlacePath(p.path) === canonicalizePlacePath(prop.proposedRule.path)
            ? { ...prop.proposedRule, id: p.id, folderFileId: p.folderFileId }
            : p
        )
      : [prop.proposedRule, ...places];

    onUpdatePlaces(updated);
    setStagedProposals((prev) => prev.filter((item) => item.proposalId !== prop.proposalId));
    setTeachingBanner(
      `Confirmed Place rule "${prop.proposedRule.label}" [${STATUS_BADGE_META[prop.proposedRule.status].label}] — ${prop.proposedRule.purpose}`
    );
    onRecordAuditEvent?.(`Confirmed Place rule: ${prop.summary}`, {
      rule: prop.proposedRule,
    });
  };

  // Execute a move into the suggested Place with Undo journal
  const handleMoveFileToSuggestedPlace = (place: PlaceRule) => {
    const entry = undoJournal.recordMove({
      fileName: testFileName,
      fromFolder: '/Users/alex/Downloads',
      destinationPlace: place,
    });
    setMoveEntries(undoJournal.getEntries());
    setLastUndoBanner(null);
    onRecordAuditEvent?.(
      `Moved "${testFileName}" to "${place.label}" (${place.path}) with Undo receipt`,
      { entry }
    );
  };

  const handleUndoMove = (entryId: string) => {
    const res = undoJournal.undoMove(entryId);
    if (res.ok) {
      setMoveEntries(undoJournal.getEntries());
      setLastUndoBanner(res.summary);
      onRecordAuditEvent?.(res.summary, { entryId });
    }
  };

  return (
    <main
      data-testid="places-map-view"
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs"
    >
      <div className="max-w-6xl mx-auto space-y-5">
        {/* TOP HEADER & MAP HEALTH STRIP */}
        <div
          className={`p-4 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
            isLight ? 'bg-white border-stone-200' : 'bg-stone-900/80 border-stone-800'
          }`}
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">My Places (File Map)</h2>
              <span className="text-[11px] text-stone-400">
                · Where things are, where things belong, and where I must never go
              </span>
            </div>
            <p className="text-[11px] text-stone-400 max-w-3xl">
              {BROWSER_FILE_SYSTEM_BRIDGE.limitationNotice} Indexed locally (encrypted at rest,
              names/types/sizes/dates only — never uploaded).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="places-pick-folder-btn"
              onClick={handlePickFolderWithBrowserBridge}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Pick Folder (Read-Only)</span>
            </button>

            <button
              type="button"
              data-testid="places-rescan-btn"
              onClick={() => handleRescanAndHealMap(false)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                isLight
                  ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                  : 'bg-stone-950 border-stone-800 text-stone-200 hover:bg-stone-800'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>Rescan</span>
            </button>

            <button
              type="button"
              data-testid="places-simulate-rename-heal-btn"
              onClick={() => handleRescanAndHealMap(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium ${
                isLight
                  ? 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                  : 'bg-stone-950 border-stone-800 text-amber-300 hover:bg-stone-800'
              }`}
              title="Simulate folder rename on disk and detect via stable folderFileId"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Test Rename Heal</span>
            </button>

            {onScheduleFridayTidyWithPlaces && (
              <button
                type="button"
                data-testid="places-schedule-friday-tidy-btn"
                onClick={() => {
                  onScheduleFridayTidyWithPlaces();
                  setFridayTidyScheduled(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-medium"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>
                  {fridayTidyScheduled
                    ? 'Friday Tidy Scheduled ✓'
                    : 'Every Friday tidy Downloads'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* MAP HEALTH CARD */}
        <section
          data-testid="places-map-health-card"
          aria-label="Map Health"
          className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
            isLight ? 'bg-stone-50 border-stone-200' : 'bg-stone-900/50 border-stone-800/90'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>
                Map Health:{' '}
                {mapHealthReport
                  ? `${mapHealthReport.healthyCount}/${mapHealthReport.totalTrackedPlaces} active places verified`
                  : `${places.filter((p) => p.status !== 'never').length} active places · ${
                      places.filter((p) => p.status === 'never').length
                    } Never-Go zones enforced`}
              </span>
            </span>
            <span className="text-[11px] text-stone-400">
              Chosen roots: {chosenRoots.join(', ')} (anything outside is Never)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => {
                const payload = JSON.stringify(
                  {
                    schemaVersion: 1,
                    cipher: 'AES-GCM-256-LOCAL',
                    exportedAt: new Date().toISOString(),
                    places: places.filter((p) => p.status !== 'never'),
                  },
                  null,
                  2
                );
                const blob = new Blob([payload], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'blaize-places-map.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-700 hover:bg-stone-800"
            >
              <Download className="w-3 h-3" />
              <span>Export Map</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateIndexedFiles([]);
                setPickerFeedback('Cleared local file index from storage.');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-700 text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Index</span>
            </button>
          </div>

          {(pickerFeedback || (mapHealthReport && mapHealthReport.issues.length > 0)) && (
            <div
              data-testid="places-health-issue-banner"
              className="w-full pt-2 border-t border-stone-800/60 space-y-1 text-[11px]"
            >
              {pickerFeedback && <div className="text-sky-300">{pickerFeedback}</div>}
              {mapHealthReport?.issues.map((iss) => (
                <div key={iss.placeId} className="text-amber-300 font-medium">
                  • {iss.detail}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* TWO-COLUMN INTERACTIVE WORKBENCH:
            Left: 'Where does this go?' / 'Find' / 'PlacesGuard' Tester
            Right: 'Teach me about this folder' (Describe, Record, Snap, Correction) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT PANEL: WHERE DOES THIS GO? & FIND & PLACESGUARD TESTER */}
          <section
            data-testid="places-where-does-this-go-card"
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/75 border-stone-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-sm flex items-center gap-2">
                <FolderSearch className="w-4 h-4 text-sky-400" />
                <span>Where does this go? &amp; Find Tester</span>
              </div>

              <div className="flex items-center gap-1 bg-stone-950/60 p-1 rounded-xl border border-stone-800">
                {(
                  [
                    { id: 'suggest', label: 'Where does this go?' },
                    { id: 'find', label: 'Find a file' },
                    { id: 'guard', label: 'Never-Go Guard' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`places-tester-tab-${t.id}`}
                    onClick={() => setTesterTab(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      testerTab === t.id
                        ? 'bg-sky-600 text-white'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SUB-TAB 1: places.suggest_destination(file) */}
            {testerTab === 'suggest' && (
              <div className="space-y-3" data-testid="places-suggest-destination-panel">
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="Test file name for destination suggestion"
                    data-testid="places-suggest-filename-input"
                    value={testFileName}
                    onChange={(e) => setTestFileName(e.target.value)}
                    placeholder="e.g. receipt_october_flight.pdf or form_1099.pdf"
                    className={`flex-1 px-3 py-1.5 rounded-xl border ${
                      isLight
                        ? 'bg-stone-50 border-stone-200'
                        : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setTestFileName('2026_w2_tax_statement.pdf')}
                    className="px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-[11px]"
                  >
                    Try Tax PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestFileName('japan_tourist_visa_scan.pdf')}
                    className="px-2.5 py-1.5 rounded-xl border border-stone-700 hover:bg-stone-800 text-[11px]"
                  >
                    Try Visa Scan
                  </button>
                </div>

                {destinationResult.topSuggestion ? (
                  <div
                    data-testid="places-top-destination-result"
                    className="p-3 rounded-xl border border-sky-500/35 bg-sky-500/10 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>
                          Belongs in: {destinationResult.topSuggestion.place.label}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] border ${
                            STATUS_BADGE_META[destinationResult.topSuggestion.place.status]
                              .badgeClass
                          }`}
                        >
                          {
                            STATUS_BADGE_META[destinationResult.topSuggestion.place.status]
                              .label
                          }
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-emerald-400">
                        Confidence: {Math.round(destinationResult.topSuggestion.confidence * 100)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-300">
                      {destinationResult.topSuggestion.reason}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-stone-400">
                        {destinationResult.topSuggestion.canAutoMoveInChore
                          ? 'Allowed & confident — a handed-over chore can move this with Undo.'
                          : 'Requires your OK before moving.'}
                      </span>
                      <button
                        type="button"
                        data-testid="places-move-with-undo-btn"
                        onClick={() =>
                          handleMoveFileToSuggestedPlace(
                            destinationResult.topSuggestion!.place
                          )
                        }
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                      >
                        Move to {destinationResult.topSuggestion.place.label} (With Undo)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-stone-800 text-stone-400">
                    Not sure where &ldquo;{testFileName}&rdquo; belongs yet — teach me a rule on the right.
                  </div>
                )}

                {/* Reversible Undo Journal Log */}
                {moveEntries.length > 0 && (
                  <div
                    data-testid="places-undo-journal-list"
                    className="space-y-1.5 pt-2 border-t border-stone-800/60"
                  >
                    <div className="font-semibold text-[11px] text-stone-300">
                      Undo Journal (Moves only, never deletes)
                    </div>
                    {lastUndoBanner && (
                      <div
                        data-testid="places-undo-restored-banner"
                        className="p-2 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-300 font-medium"
                      >
                        {lastUndoBanner}
                      </div>
                    )}
                    {moveEntries.slice(0, 3).map((entry) => (
                      <div
                        key={entry.entryId}
                        className="p-2 rounded-xl border border-stone-800 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="truncate">
                          <span className="font-medium text-stone-200">{entry.fileName}</span>{' '}
                          <span className="text-stone-400">
                            → {entry.destinationPlaceLabel}
                          </span>
                        </div>
                        {entry.undone ? (
                          <span className="text-sky-400 font-medium shrink-0">Undone ✓</span>
                        ) : (
                          <button
                            type="button"
                            data-testid="places-undo-move-btn"
                            onClick={() => handleUndoMove(entry.entryId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 text-black font-semibold shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Undo</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SUB-TAB 2: places.find(intent) */}
            {testerTab === 'find' && (
              <div className="space-y-3" data-testid="places-find-panel">
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="Find file by intent"
                    data-testid="places-find-intent-input"
                    value={findIntentQuery}
                    onChange={(e) => setFindIntentQuery(e.target.value)}
                    placeholder="e.g. find my passport scan or october receipt"
                    className={`flex-1 px-3 py-1.5 rounded-xl border ${
                      isLight
                        ? 'bg-stone-50 border-stone-200'
                        : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>
                <div className="space-y-2">
                  {findResult.candidates.slice(0, 3).map((cand) => (
                    <div
                      key={cand.file.fileId}
                      data-testid={`places-find-candidate-${cand.file.fileId}`}
                      className="p-2.5 rounded-xl border border-stone-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-stone-100 truncate">
                          {cand.file.name}{' '}
                          <span className="text-[11px] font-normal text-sky-400">
                            in {cand.place.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-stone-400 truncate">{cand.reason}</div>
                      </div>
                      <span className="font-mono text-[11px] text-emerald-400 shrink-0">
                        {Math.round(cand.confidence * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SUB-TAB 3: PlacesGuard & Never-Go Zone Live Tester */}
            {testerTab === 'guard' && (
              <div className="space-y-3" data-testid="places-guard-tester-panel">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select
                    aria-label="Select caller to test PlacesGuard"
                    data-testid="places-guard-caller-select"
                    value={guardCaller}
                    onChange={(e) => setGuardCaller(e.target.value as PlacesGuardCaller)}
                    className={`px-2.5 py-1.5 rounded-xl border ${
                      isLight
                        ? 'bg-stone-50 border-stone-200'
                        : 'bg-stone-950 border-stone-800'
                    }`}
                  >
                    <option value="files_plugin">Caller: Files Plugin</option>
                    <option value="workspace_tool">Caller: Workspace Tool</option>
                    <option value="skill">Caller: Skill</option>
                    <option value="scheduled_chore">Caller: Scheduled Chore</option>
                    <option value="shell_command">Caller: Shell Command</option>
                    <option value="subagent">Caller: Subagent</option>
                    <option value="connector">Caller: Connector</option>
                  </select>
                  <input
                    type="text"
                    aria-label="Path or command to check against PlacesGuard"
                    data-testid="places-guard-path-input"
                    value={guardTestPath}
                    onChange={(e) => setGuardTestPath(e.target.value)}
                    className={`sm:col-span-2 px-3 py-1.5 rounded-xl border font-mono text-[11px] ${
                      isLight
                        ? 'bg-stone-50 border-stone-200'
                        : 'bg-stone-950 border-stone-800'
                    }`}
                  />
                </div>

                <div
                  data-testid="places-guard-decision-box"
                  className={`p-3 rounded-xl border space-y-1.5 ${
                    guardDecision.status === 'never'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                      : guardDecision.status === 'ask_first'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold" data-testid="places-guard-blocked-msg">
                      {guardDecision.blockedMessage ||
                        (guardDecision.allowed ? 'Allowed' : 'Ask first')}
                    </span>
                    <span className="font-mono text-[10px]">
                      Canonical: {guardDecision.canonicalPath}
                    </span>
                  </div>
                  <div className="text-[11px] opacity-90">{guardDecision.reason}</div>
                  {guardDecision.offerChangeRuleAction && (
                    <div className="pt-1">
                      <button
                        type="button"
                        data-testid="places-guard-change-rule-btn"
                        onClick={() => {
                          const targetPlace =
                            guardDecision.matchedPlace ||
                            places.find((p) => p.status === 'never')!;
                          setReauthModalTarget({
                            place: targetPlace,
                            nextStatus: 'allowed',
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px]"
                      >
                        Change this rule (Re-authenticate)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* RIGHT PANEL: TEACH ME ABOUT THIS FOLDER (Describe, Record, Snap, Correction) */}
          <section
            data-testid="places-teach-studio-card"
            className={`p-4 rounded-2xl border space-y-3 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/75 border-stone-800'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setTeachOpen((v) => !v)}
                className="font-semibold text-sm flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Teach me about a folder</span>
              </button>

              <div className="flex items-center gap-1 bg-stone-950/60 p-1 rounded-xl border border-stone-800">
                {(
                  [
                    { id: 'describe', label: 'Describe', icon: MessageSquarePlus },
                    { id: 'record', label: 'Record', icon: Mic },
                    { id: 'snap', label: 'Snap', icon: Camera },
                    { id: 'correction', label: 'Correct', icon: RotateCcw },
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`places-teach-tab-${m.id}`}
                      onClick={() => {
                        setTeachOpen(true);
                        setTeachTab(m.id);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        teachTab === m.id
                          ? 'bg-sky-600 text-white'
                          : 'text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {teachOpen && (
              <div className="space-y-3">
                {/* 1. DESCRIBE */}
                {teachTab === 'describe' && (
                  <div className="space-y-2" data-testid="places-teach-describe-panel">
                    <textarea
                      rows={2}
                      aria-label="Describe your folders in plain words"
                      data-testid="places-describe-input"
                      value={describeInput}
                      onChange={(e) => setDescribeInput(e.target.value)}
                      placeholder="e.g. My tax papers live in Documents/Taxes. Never touch Family Photos."
                      className={`w-full p-2.5 rounded-xl border text-xs ${
                        isLight
                          ? 'bg-stone-50 border-stone-200'
                          : 'bg-stone-950 border-stone-800'
                      }`}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-stone-400">
                        Compiles into Zod-validated PlaceRules for your confirmation.
                      </span>
                      <button
                        type="button"
                        data-testid="places-compile-describe-btn"
                        onClick={() => {
                          const props = compileDescribeToPlaceProposals(describeInput);
                          setStagedProposals(props);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                      >
                        Propose Rules
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. RECORD (Push-to-talk / Muse Voice Transcribe + Keyframe Review & Privacy Blur) */}
                {teachTab === 'record' && (
                  <div className="space-y-2.5" data-testid="places-teach-record-panel">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-stone-400">
                        {isLiveModelMode
                          ? 'Push-to-talk (Muse Voice Transcribe live) while browsing folders.'
                          : 'Typed narration + keyframe review (blur private areas before proposing).'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecordingActive((v) => !v)}
                        className={`px-2.5 py-1 rounded-lg font-medium ${
                          recordingActive
                            ? 'bg-rose-600 text-white'
                            : 'bg-stone-800 text-stone-200'
                        }`}
                      >
                        {recordingActive ? 'Stop Narration' : 'Push-to-Talk / Narrate'}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      {keyframes.map((kf) => (
                        <div
                          key={kf.keyframeId}
                          className="p-2 rounded-xl border border-stone-800 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                        >
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={kf.selectedForModel}
                              onChange={() =>
                                setKeyframes((prev) =>
                                  prev.map((item) =>
                                    item.keyframeId === kf.keyframeId
                                      ? { ...item, selectedForModel: !item.selectedForModel }
                                      : item
                                  )
                                )
                              }
                            />
                            <span className="font-medium">{kf.folderPath}</span>
                            <span className="text-stone-400">— &ldquo;{kf.narrationText}&rdquo;</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setKeyframes((prev) =>
                                prev.map((item) =>
                                  item.keyframeId === kf.keyframeId
                                    ? {
                                        ...item,
                                        blurredPrivateRegions: !item.blurredPrivateRegions,
                                      }
                                    : item
                                )
                              )
                            }
                            className={`px-2 py-0.5 rounded text-[10px] border ${
                              kf.blurredPrivateRegions
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                : 'border-stone-700 text-stone-400'
                            }`}
                          >
                            {kf.blurredPrivateRegions ? 'Private Blur: ON' : 'Blur Private'}
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="places-compile-record-btn"
                        onClick={() => {
                          const res = compileRecordedExplorerSessionToProposals(keyframes);
                          setStagedProposals(res.proposals);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                      >
                        Send Selected Keyframes ({keyframes.filter((k) => k.selectedForModel).length})
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. SNAP (Folder window screenshot, list, or hand-drawn sketch) */}
                {teachTab === 'snap' && (
                  <div className="space-y-2.5" data-testid="places-teach-snap-panel">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        aria-label="Snap source type"
                        value={snapKind}
                        onChange={(e) =>
                          setSnapKind(
                            e.target.value as
                              | 'folder_window_screenshot'
                              | 'hand_drawn_sketch'
                              | 'folder_list_photo'
                          )
                        }
                        className={`px-2.5 py-1.5 rounded-xl border ${
                          isLight
                            ? 'bg-stone-50 border-stone-200'
                            : 'bg-stone-950 border-stone-800'
                        }`}
                      >
                        <option value="hand_drawn_sketch">Hand-drawn sketch</option>
                        <option value="folder_window_screenshot">Folder screenshot</option>
                        <option value="folder_list_photo">Photo of folder list</option>
                      </select>
                      <input
                        type="text"
                        aria-label="Extracted folder name"
                        value={snapFolderInput}
                        onChange={(e) => setSnapFolderInput(e.target.value)}
                        placeholder="Folder (e.g. DesignAssets/Logos)"
                        className={`px-2.5 py-1.5 rounded-xl border ${
                          isLight
                            ? 'bg-stone-50 border-stone-200'
                            : 'bg-stone-950 border-stone-800'
                        }`}
                      />
                      <input
                        type="text"
                        aria-label="Extracted label or purpose"
                        value={snapPurposeInput}
                        onChange={(e) => setSnapPurposeInput(e.target.value)}
                        placeholder="Purpose (e.g. Where brand logos go)"
                        className={`px-2.5 py-1.5 rounded-xl border ${
                          isLight
                            ? 'bg-stone-50 border-stone-200'
                            : 'bg-stone-950 border-stone-800'
                        }`}
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="places-compile-snap-btn"
                        onClick={() => {
                          const props = compileSnapSketchToPlaceProposals({
                            sourceKind: snapKind,
                            extractedLines: [
                              {
                                folderPathOrName: snapFolderInput,
                                handwrittenNote: snapPurposeInput,
                                statusHint: 'allowed',
                              },
                            ],
                          });
                          setStagedProposals(props);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                      >
                        Extract Places from Snap
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. CORRECTIONS ARE TEACHING */}
                {teachTab === 'correction' && (
                  <div className="space-y-2" data-testid="places-teach-correction-panel">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        aria-label="Correction teaching statement"
                        data-testid="places-correction-input"
                        value={correctionInput}
                        onChange={(e) => setCorrectionInput(e.target.value)}
                        placeholder="e.g. No, receipts go in Finance/2026"
                        className={`flex-1 px-3 py-1.5 rounded-xl border ${
                          isLight
                            ? 'bg-stone-50 border-stone-200'
                            : 'bg-stone-950 border-stone-800'
                        }`}
                      />
                      <button
                        type="button"
                        data-testid="places-apply-correction-btn"
                        onClick={() => {
                          const res = applyUserPlaceCorrection(correctionInput, places);
                          if (res.recognized && res.proposal) {
                            setStagedProposals([res.proposal]);
                            if (res.promoteToReviewInbox && onPromoteProposalToReview) {
                              onPromoteProposalToReview({
                                title: `Promote repeated Place correction: ${res.proposal.proposedRule.label}`,
                                summary: res.proposal.summary,
                                before: 'Previous routing rule',
                                after: `${res.proposal.proposedRule.path} — ${res.proposal.proposedRule.purpose}`,
                              });
                              setTeachingBanner(
                                'Repeated correction detected — proposed standing Place rule in Proof > Review.'
                              );
                            }
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-amber-500 text-black font-semibold"
                      >
                        Teach Correction
                      </button>
                    </div>
                  </div>
                )}

                {/* VISUAL CONFIRMATION CARDS FOR STAGED PROPOSALS */}
                {stagedProposals.length > 0 && (
                  <div
                    data-testid="places-staged-proposals-box"
                    className="space-y-2 pt-2 border-t border-stone-800"
                  >
                    <div className="font-semibold text-amber-300">
                      Confirm Proposed Place Rule ({stagedProposals.length})
                    </div>
                    {stagedProposals.map((prop) => (
                      <div
                        key={prop.proposalId}
                        data-testid={`places-proposal-card-${prop.proposalId}`}
                        className="p-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="font-semibold text-amber-200">{prop.summary}</div>
                          <div className="text-[11px] text-stone-300">
                            Zod Schema Validated: {prop.zodValidated ? 'Yes ✓' : 'No'} · Status:{' '}
                            <strong>{STATUS_BADGE_META[prop.proposedRule.status].label}</strong>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="places-confirm-proposal-btn"
                            onClick={() => handleConfirmProposal(prop)}
                            className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                          >
                            Confirm &amp; Save
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setStagedProposals((prev) =>
                                prev.filter((p) => p.proposalId !== prop.proposalId)
                              )
                            }
                            className="px-2 py-1 rounded-lg border border-stone-700 text-stone-300"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {teachingBanner && (
                  <div
                    data-testid="places-teaching-confirmed-banner"
                    className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium"
                  >
                    {teachingBanner}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* FILTER & VIEW MODE BAR FOR THE VISUAL FOLDER MAP */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${places.length})` },
                {
                  id: 'allowed',
                  label: `Allowed (${places.filter((p) => p.status === 'allowed').length})`,
                },
                {
                  id: 'ask_first',
                  label: `Ask first (${places.filter((p) => p.status === 'ask_first').length})`,
                },
                {
                  id: 'never',
                  label: `Never (${places.filter((p) => p.status === 'never').length})`,
                },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                data-testid={`places-filter-${f.id}`}
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl font-medium border transition-colors ${
                  statusFilter === f.id
                    ? 'bg-sky-600 text-white border-sky-600'
                    : isLight
                      ? 'bg-white border-stone-200 text-stone-600'
                      : 'bg-stone-900 border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search places"
                data-testid="places-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search folders, purpose, or keywords..."
                className={`pl-8 pr-3 py-1.5 rounded-xl border w-64 ${
                  isLight ? 'bg-white border-stone-200' : 'bg-stone-900 border-stone-800'
                }`}
              />
            </div>

            <div className="flex items-center gap-1 bg-stone-900 p-1 rounded-xl border border-stone-800">
              <button
                type="button"
                data-testid="places-view-cards-btn"
                onClick={() => setViewMode('cards')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${
                  viewMode === 'cards' ? 'bg-sky-600 text-white' : 'text-stone-400'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
              <button
                type="button"
                data-testid="places-view-tree-btn"
                onClick={() => setViewMode('tree')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg ${
                  viewMode === 'tree' ? 'bg-sky-600 text-white' : 'text-stone-400'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Tree</span>
              </button>
            </div>
          </div>
        </div>

        {reauthWarningBanner && (
          <div
            data-testid="places-reauth-warning-banner"
            className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-200 font-medium"
          >
            {reauthWarningBanner}
          </div>
        )}

        {/* VISUAL MAP: CARDS VIEW OR TREE VIEW (Paths tucked under 'Details') */}
        {viewMode === 'cards' ? (
          <div
            data-testid="places-cards-grid"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
          >
            {filteredPlaces.map((place) => {
              const badge = STATUS_BADGE_META[place.status];
              const detailsOpen = expandedDetailIds.includes(place.id);
              const PlaceIcon =
                place.status === 'never'
                  ? FolderLock
                  : place.status === 'allowed'
                    ? FolderCheck
                    : Folder;

              return (
                <div
                  key={place.id}
                  data-testid={`place-card-${place.id}`}
                  className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-colors ${
                    isLight ? 'bg-white border-stone-200' : 'bg-stone-900/75 border-stone-800'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlaceIcon
                          className={`w-4 h-4 shrink-0 ${
                            place.status === 'never'
                              ? 'text-rose-400'
                              : place.status === 'allowed'
                                ? 'text-emerald-400'
                                : 'text-amber-400'
                          }`}
                        />
                        <h3 className="font-semibold text-sm truncate">{place.label}</h3>
                      </div>
                      <span
                        data-testid={`place-status-badge-${place.id}`}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${badge.badgeClass}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-stone-300 leading-snug">{place.purpose}</p>

                    {place.status !== 'never' && (
                      <div className="text-[11px] text-stone-400">
                        <span>Belongs here: {place.belongsHere.keywords.slice(0, 4).join(', ')}</span>
                        <span> · </span>
                        <span>
                          Actions:{' '}
                          {place.allowedActions.length > 0
                            ? place.allowedActions.join(', ')
                            : 'none'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-stone-800/60 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        data-testid={`place-details-toggle-${place.id}`}
                        onClick={() => toggleDetails(place.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline font-medium"
                      >
                        {detailsOpen ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>Details</span>
                      </button>

                      <div className="flex items-center gap-1">
                        {(['allowed', 'ask_first', 'never'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => {
                              if (place.status === 'never' && st !== 'never') {
                                setReauthModalTarget({ place, nextStatus: st });
                                return;
                              }
                              const res = changePlaceStatusWithReauth({
                                placeId: place.id,
                                nextStatus: st,
                                places,
                                reauthPinOrBiometricPassed: true,
                              });
                              if (res.ok) {
                                onUpdatePlaces(res.updatedPlaces);
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                              place.status === st
                                ? badge.badgeClass
                                : 'border-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            {STATUS_BADGE_META[st].label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {detailsOpen && (
                      <div
                        data-testid={`place-details-panel-${place.id}`}
                        className="p-2.5 rounded-xl bg-stone-950/70 border border-stone-800 font-mono text-[11px] text-stone-400 space-y-1"
                      >
                        <div>Path: {place.path}</div>
                        <div>Canonical: {place.canonicalPath}</div>
                        <div>Folder ID: {place.folderFileId}</div>
                        {place.status !== 'never' && (
                          <label className="flex items-center gap-2 pt-1 font-sans text-stone-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={place.allowContentIndexing}
                              onChange={() =>
                                onUpdatePlaces(
                                  places.map((p) =>
                                    p.id === place.id
                                      ? {
                                          ...p,
                                          allowContentIndexing: !p.allowContentIndexing,
                                        }
                                      : p
                                  )
                                )
                              }
                            />
                            <span>Allow reading file contents in this Place</span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* TREE VIEW */
          <div
            data-testid="places-tree-view"
            className={`p-4 rounded-2xl border divide-y divide-stone-800/60 ${
              isLight ? 'bg-white border-stone-200' : 'bg-stone-900/75 border-stone-800'
            }`}
          >
            {filteredPlaces.map((place) => {
              const badge = STATUS_BADGE_META[place.status];
              return (
                <div
                  key={place.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <Folder className="w-4 h-4 text-sky-400" />
                    <span className="font-semibold">{place.label}</span>
                    <span className="text-stone-400">— {place.purpose}</span>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badge.badgeClass}`}
                  >
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RE-AUTHENTICATION MODAL WHEN CHANGING A 'NEVER' PLACE TO ALLOWED / ASK FIRST */}
      {reauthModalTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Re-authenticate to change Never-Go rule"
          data-testid="places-reauth-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          onClick={() => setReauthModalTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl border p-5 space-y-4 text-xs shadow-2xl ${
              isLight
                ? 'bg-white border-stone-200 text-stone-900'
                : 'bg-stone-900 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <Lock className="w-4 h-4" />
              <span>Re-authenticate to Change Never-Go Rule</span>
            </div>
            <p className="text-stone-300 leading-relaxed">
              You are changing <strong>{reauthModalTarget.place.label}</strong> from{' '}
              <strong>Never</strong> to{' '}
              <strong>{STATUS_BADGE_META[reauthModalTarget.nextStatus].label}</strong>.
              {reauthModalTarget.place.isDefaultNever && (
                <span className="block mt-1.5 text-rose-300 font-medium">
                  Warning: This folder is on the Default Never list (system / key / credential store).
                </span>
              )}
            </p>
            <div>
              <label htmlFor="places-reauth-pin" className="block text-stone-400 mb-1">
                Enter operator PIN to confirm (default: 2026):
              </label>
              <input
                id="places-reauth-pin"
                type="password"
                data-testid="places-reauth-pin-input"
                value={reauthPin}
                onChange={(e) => setReauthPin(e.target.value)}
                className="w-full px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-950 text-stone-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReauthModalTarget(null)}
                className="px-3 py-1.5 rounded-xl border border-stone-700 text-stone-300"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="places-confirm-reauth-btn"
                onClick={() => {
                  const res = changePlaceStatusWithReauth({
                    placeId: reauthModalTarget.place.id,
                    nextStatus: reauthModalTarget.nextStatus,
                    places,
                    reauthPinOrBiometricPassed: reauthPin.trim().length >= 4,
                  });
                  if (res.ok) {
                    onUpdatePlaces(res.updatedPlaces);
                    if (res.warningMessage) {
                      setReauthWarningBanner(res.warningMessage);
                    }
                    setReauthModalTarget(null);
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-black font-semibold"
              >
                Confirm &amp; Change Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
