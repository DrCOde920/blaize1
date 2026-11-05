/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Prompt 2/4:
 * 1. Creating projects of any kind (trip, wedding, shop, homework, idea, app) with neutral starters
 *    and never defaulting to a developer project.
 * 2. Artifact preview per type, versioning, rollback, delete with Undo, agent tools
 *    (artifact.create, artifact.update, artifact.read, artifact.list), and honest refusal for unsupported video gen.
 * 3. General Evaluations running against two different non-finance plugins + custom plugin evals,
 *    dynamic runId/time/mode, trends, export, and zero L3xi items.
 * 4. Automatic pre-enable evaluation for new/agent-created plugins with results appearing in Proof > Review.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_CATEGORY_LABELS,
  GeneralEvaluationRunner,
  INITIAL_GENERAL_PROJECTS,
  INITIAL_UNIVERSAL_ARTIFACTS,
  PROJECT_NEUTRAL_STARTERS,
  UniversalArtifactStore,
  createGeneralProject,
  evaluateNewPluginBeforeEnable,
  pluginToEvaluableManifest,
  requestAgentArtifactGeneration,
  resolveArtifactPreviewDescriptor,
} from './index';
import {
  INITIAL_INSTALLED_PLUGINS,
  InstalledPluginItem,
  UnifiedReviewInbox,
} from '../hub';

test('1. Projects: creates projects of any kind (trip, wedding, shop, homework, idea, app), offers 6 neutral starters, and never defaults to a developer project', () => {
  // Verify neutral starters match specification
  const starterLabels = PROJECT_NEUTRAL_STARTERS.map((s) => s.label);
  assert.deepEqual(starterLabels, [
    'Plan something',
    'Research',
    'Write',
    'Create media',
    'Organize files',
    'Code',
  ]);

  // Verify initial default project is a general everyday project, NOT a developer project
  const defaultProject = INITIAL_GENERAL_PROJECTS[0];
  assert.notEqual(defaultProject.starterId, 'code');
  assert.equal(defaultProject.name, 'Autumn Trip to Kyoto');
  assert.ok(defaultProject.memoryScope.isolateFromOtherProjects);
  assert.ok(defaultProject.aboutInstructions.length > 10);

  // Create projects of diverse everyday kinds
  const weddingProj = createGeneralProject({
    name: 'June Garden Wedding',
    icon: 'Heart',
    color: 'rose',
    description: 'Guest list, florist quotes, seating chart, and music playlist.',
    starterId: 'plan_something',
  });
  assert.equal(weddingProj.name, 'June Garden Wedding');
  assert.equal(weddingProj.icon, 'Heart');
  assert.equal(weddingProj.color, 'rose');
  assert.equal(weddingProj.memoryScope.label, 'June Garden Wedding memory');

  const homeworkProj = createGeneralProject({
    name: 'Biology Cell Lab Homework',
    icon: 'GraduationCap',
    color: 'emerald',
    starterId: 'research',
  });
  assert.equal(homeworkProj.icon, 'GraduationCap');
  assert.ok(homeworkProj.aboutInstructions.includes('reliable sources'));

  const ideaProj = createGeneralProject({
    name: 'Weekend Podcast Idea',
  });
  // Without starterId, never defaults to Code2 or developer template
  assert.notEqual(ideaProj.icon, 'Code2');
  assert.notEqual(ideaProj.starterId, 'code');
});

test('2. Universal Artifacts: preview per type, versioning & rollback, delete with Undo, agent tools, and honest video refusal', () => {
  const store = new UniversalArtifactStore(INITIAL_UNIVERSAL_ARTIFACTS);

  // Verify zero developer-centric category labels like 'react_widget' or 'code_module'
  const categoryValues = Object.values(ARTIFACT_CATEGORY_LABELS).join(' ');
  assert.equal(/react_widget|code_module|react_component|json_schema/i.test(categoryValues), false);

  // Check preview descriptors across all supported types
  // a) Document (Markdown)
  const docArt = store.read('uart-kyoto-itinerary')!;
  const docPreview = resolveArtifactPreviewDescriptor(docArt);
  assert.equal(docPreview.viewerMode, 'document_reader');
  assert.ok((docPreview.documentSections?.length || 0) >= 2);

  // b) PDF Document
  const pdfArt = store.read('uart-kyoto-guide-pdf')!;
  const pdfPreview = resolveArtifactPreviewDescriptor(pdfArt);
  assert.equal(pdfPreview.viewerMode, 'pdf_viewer');

  // c) Spreadsheet / CSV Table
  const csvArt = store.read('uart-kyoto-packing-csv')!;
  const csvPreview = resolveArtifactPreviewDescriptor(csvArt);
  assert.equal(csvPreview.viewerMode, 'csv_table');
  assert.deepEqual(csvPreview.csvTable?.headers, [
    'Item',
    'Category',
    'Quantity',
    'Status',
    'Notes',
  ]);
  assert.equal(csvPreview.csvTable?.rows.length, 5);

  // d) Slides
  const slidesArt = store.read('uart-kyoto-slides')!;
  const slidesPreview = resolveArtifactPreviewDescriptor(slidesArt);
  assert.equal(slidesPreview.viewerMode, 'slides_viewer');
  assert.equal(slidesPreview.slidesDeck?.length, 3);

  // e) Image
  const imgArt = store.read('uart-kyoto-map-svg')!;
  assert.equal(resolveArtifactPreviewDescriptor(imgArt).viewerMode, 'image_viewer');

  // f) Audio
  const audioArt = store.read('uart-kyoto-phrases-audio')!;
  assert.equal(resolveArtifactPreviewDescriptor(audioArt).viewerMode, 'audio_player');

  // g) Web page (Sandboxed HTML)
  const webArt = store.read('uart-bakery-menu-webpage')!;
  assert.equal(resolveArtifactPreviewDescriptor(webArt).viewerMode, 'html_sandbox');

  // h) Video (create via artifact.create tool)
  const videoArt = store.create({
    projectId: 'proj-kyoto-trip',
    title: 'Station Walk Clip',
    fileName: 'kyoto-station.mp4',
    category: 'video',
    mimeType: 'video/mp4',
    content: 'data:video/mp4;base64,AAAA',
    creator: 'user',
    originChatOrMission: 'Imported by you',
    tags: ['video', 'station'],
  });
  assert.equal(resolveArtifactPreviewDescriptor(videoArt).viewerMode, 'video_player');

  // i) Code & data (create via artifact.create tool)
  const dataArt = store.create({
    projectId: 'proj-kyoto-trip',
    title: 'Train Schedule Data',
    fileName: 'trains.json',
    category: 'code_data',
    mimeType: 'application/json',
    content: '{"line":"Haruka","minutes":75}',
    creator: 'agent',
    originChatOrMission: 'Chat: Train Schedule',
    tags: ['json', 'transit'],
  });
  assert.equal(resolveArtifactPreviewDescriptor(dataArt).viewerMode, 'code_viewer');

  // Test artifact.update + version history + rollbackToVersion
  const updatedData = store.update(dataArt.id, {
    content: '{"line":"Haruka Express","minutes":73}',
    summary: 'Updated travel duration to 73 min',
    creator: 'agent',
  })!;
  assert.equal(updatedData.currentVersion, 2);
  assert.equal(updatedData.versions.length, 2);

  const rolledBack = store.rollbackToVersion(dataArt.id, 1)!;
  assert.equal(rolledBack.currentVersion, 1);
  assert.equal(rolledBack.content, '{"line":"Haruka","minutes":75}');

  // Test rename
  const renamed = store.rename(dataArt.id, 'Express Train Timings')!;
  assert.equal(renamed.title, 'Express Train Timings');

  // Test deleteWithUndo and undoDelete
  const countBeforeDelete = store.list({ projectId: 'proj-kyoto-trip' }).length;
  const undoTicket = store.deleteWithUndo(dataArt.id)!;
  assert.ok(undoTicket.undoId);
  assert.equal(store.read(dataArt.id), null);
  assert.equal(store.list({ projectId: 'proj-kyoto-trip' }).length, countBeforeDelete - 1);

  const restored = store.undoDelete(undoTicket.undoId)!;
  assert.equal(restored.id, dataArt.id);
  assert.equal(store.list({ projectId: 'proj-kyoto-trip' }).length, countBeforeDelete);

  // Test honest media generation: refuses to fake video when no video model/plugin is installed
  const videoGenAttempt = requestAgentArtifactGeneration({
    projectId: 'proj-kyoto-trip',
    requestedCategory: 'video',
    prompt: 'Flyover video of Kyoto temples',
    mode: 'live',
    installedPluginIds: ['plugin-local-notes-sync'],
    store,
  });
  assert.equal(videoGenAttempt.status, 'unsupported_capability');
  assert.equal(videoGenAttempt.artifact, undefined);
  assert.ok(videoGenAttempt.honestMessage.includes("can't generate video files directly"));

  // Test live mode image generation uses Muse Image
  const imageGenAttempt = requestAgentArtifactGeneration({
    projectId: 'proj-kyoto-trip',
    requestedCategory: 'image',
    prompt: 'Torii gate illustration at sunset',
    mode: 'live',
    store,
  });
  assert.equal(imageGenAttempt.status, 'created');
  assert.equal(imageGenAttempt.modelOrPluginUsed, 'muse-image-1.0');
  assert.equal(imageGenAttempt.simulated, false);
});

test('3. General Evaluations: runs against two different non-finance plugins with generic manifest checks + custom evals, dynamic runId/time/mode, trends, and export', () => {
  const runner = new GeneralEvaluationRunner();

  // Select two different non-finance plugins
  const plugin1 = INITIAL_INSTALLED_PLUGINS.find((p) => p.id === 'plugin-workspace-files')!;
  const plugin2 = INITIAL_INSTALLED_PLUGINS.find((p) => p.id === 'plugin-web-research')!;
  assert.ok(plugin1);
  assert.ok(plugin2);

  const manifest1 = pluginToEvaluableManifest(plugin1);
  const manifest2 = pluginToEvaluableManifest(plugin2);

  // Run checks on Plugin 1 in mock mode
  const run1 = runner.runChecks({
    targets: [manifest1, manifest2],
    selectedTargetId: plugin1.id,
    mode: 'mock',
  });
  assert.ok(run1.runId.startsWith('eval_run_'));
  assert.equal(run1.mode, 'mock');
  assert.equal(run1.overallVerdict, 'Passed');
  assert.equal(run1.targetReports.length, 1);
  // 7 generic manifest checks + 1 plugin custom eval = 8 checks
  assert.equal(run1.targetReports[0].checks.length, 8);

  // Run checks on Plugin 2 in live mode
  const run2 = runner.runChecks({
    targets: [manifest1, manifest2],
    selectedTargetId: plugin2.id,
    mode: 'live',
  });
  assert.notEqual(run2.runId, run1.runId);
  assert.equal(run2.mode, 'live');
  assert.equal(run2.overallVerdict, 'Passed');
  assert.equal(run2.targetReports[0].targetId, 'plugin-web-research');
  assert.equal(run2.targetReports[0].checks.length, 8);

  // Run checks on All
  const runAll = runner.runChecks({
    targets: [manifest1, manifest2],
    selectedTargetId: 'all',
    mode: 'mock',
  });
  assert.equal(runAll.targetReports.length, 2);
  assert.equal(runAll.totalChecksRun, 16);

  // Verify history, trends, and markdown export
  const history = runner.getHistory();
  assert.equal(history.length, 3);
  const trends = runner.computeTrends();
  assert.equal(trends.totalRuns, 3);
  assert.equal(trends.latestPassRatePct, 100);

  const exportedMd = runner.exportLatestMarkdown();
  assert.ok(exportedMd.includes(runAll.runId));
  assert.ok(exportedMd.includes('Workspace Files & Checksums'));
  assert.ok(exportedMd.includes('Web Research & Citations'));
  assert.equal(/l3xi/i.test(exportedMd), false);
});

test('4. Pre-Enable Plugin Evaluation: automatically evaluates a new or agent-created plugin before enabling and posts result to Proof > Review', () => {
  const runner = new GeneralEvaluationRunner();
  const reviewInbox = new UnifiedReviewInbox([]);

  const newAgentPlugin = {
    id: 'plugin-recipe-organizer',
    name: 'Recipe & Grocery Organizer',
    version: '1.0.0',
    enabled: true, // Even if requested enabled, pre-enable gate keeps it disabled until reviewed
    permissionsSummary: 'Read/write in ~/Notes/Recipes; no network or credential access.',
    permissions: ['notes:read', 'notes:write'],
    origin: 'created_with_morrow' as const,
    manifestConstraints: [
      {
        actionClass: 'write' as const,
        mode: 'ask_first' as const,
        reason: 'Recipe edits ask before saving.',
      },
    ],
  };

  const preEnableRes = evaluateNewPluginBeforeEnable({
    plugin: newAgentPlugin,
    runner,
    reviewInbox,
    mode: 'mock',
  });

  // 1. Plugin is held in disabled state until approved in Review
  assert.equal(preEnableRes.pluginWithDisabledState.enabled, false);
  assert.equal(preEnableRes.evalRun.overallVerdict, 'Passed');
  assert.equal(preEnableRes.canEnableImmediately, true);

  // 2. Review inbox received the plugin proposal with evaluation run ID and verdict
  assert.equal(reviewInbox.getPendingCount(), 1);
  const proposal = reviewInbox.getAll()[0];
  assert.equal(proposal.type, 'plugin');
  assert.ok(proposal.title.includes('Recipe & Grocery Organizer'));
  assert.ok(proposal.title.includes('Passed'));
  assert.ok(proposal.plainDiff.after.includes(preEnableRes.evalRun.runId));

  // 3. Test a faulty plugin that fails secret leak check during pre-enable evaluation
  const faultyPlugin = {
    ...newAgentPlugin,
    id: 'plugin-faulty-exporter',
    name: 'Faulty Note Exporter',
  };
  const failedPreEnable = evaluateNewPluginBeforeEnable({
    plugin: faultyPlugin,
    runner,
    reviewInbox,
    mode: 'mock',
    faultOverrides: { leakSecretCanary: true },
  });
  assert.equal(failedPreEnable.evalRun.overallVerdict, 'Failed');
  assert.equal(failedPreEnable.canEnableImmediately, false);
  assert.equal(reviewInbox.getPendingCount(), 2);
});
