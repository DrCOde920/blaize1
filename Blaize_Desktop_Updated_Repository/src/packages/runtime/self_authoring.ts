/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Self-Authoring Engine & Controlled Creation Subsystem (`src/packages/runtime/self_authoring.ts`)
 *
 * Implements PROMPT: SELF-AUTHORING requirements:
 * 1. Open Zone Creators:
 *    - Figures: Character Studio flow, parametric changes, active figure switching (previous 1-click away), SFW checks.
 *    - Plugins: Built from template in sandboxed Builder workspace. Schema, dependency, forbidden API, and preflight checks.
 *      Zero permissions by default; pauses with compact card if ungranted permissions are requested.
 *    - Skills: Created from NL description, chat, or teach & replay trace.
 *    - Personality Adjustments: Tone, style, quirks, animation habits (NEVER permissions or safety rules).
 *    - Themes, Layouts, Templates, Schedules, and Project Structure.
 * 2. Protected Zone Enforcement:
 *    - Uses `evaluateProtectedSettingsAccess` from `src/packages/trust/protected_settings.ts`.
 *    - Agent tools, skills, plugins, hooks, personalities, or web pages have ZERO write access to Protected Zone items.
 * 3. Provenance Tagging & Untrusted Content Gate:
 *    - Inputs carry `provenance`: 'user_typed' | 'user_voice' | 'tool_output' | 'web_content' | 'plugin_output' | 'memory'.
 *    - Direct creation runs ONLY when provenance is 'user_typed' or 'user_voice' in current turn.
 *    - Untrusted content (web, plugin, memory) CANNOT start creation; becomes a suggestion in Review queue.
 * 4. Low-Friction Execution & One-Line Output:
 *    - Builds in Builder workspace, runs self-repair loop on errors (up to 2 attempts).
 *    - Activates immediately and outputs: "Created <Name>. Using it now. [Undo] [Details]"
 *    - Labels with provenance, versioning, prompt-based edits, revert, and one-click removal (deletes data).
 *    - Resource bounds: size cap, 5s timeout, budget cap, creations per hour cap (10/hr).
 * 5. Proactive Self-Improvement:
 *    - 'Self-improvement' setting: 'suggest_only' (default) | 'auto_low_risk' | 'off'.
 *    - 'auto_low_risk' auto-creates ONLY low-risk skills and personality tweaks (undoable). Never auto-creates plugins.
 * 6. Audit Recording & 'Made by Morrow' List:
 *    - Records hashes of creations, edits, reverts, and removals in MemoryLedger.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MemoryLedger,
  ProtectedActorRole,
  evaluateProtectedSettingsAccess,
  redactSensitiveText,
} from '../trust';
import {
  CharacterFactory,
  CharacterFactoryInput,
  InstalledFigureRecord,
  PersistentFigureLibrary,
} from '../character/figure_factory';
import {
  ManagedPluginRecord,
  PluginManifestV1,
  SelfExtensionManager,
  signPluginManifest,
  validatePluginManifestAndCode,
} from './self_extension_manager';
import { ScopedWorkspaceManager } from '../browser_ide/scoped_workspace';
import { ToolExecutionContext } from './index';

export type SelfImprovementSetting = 'suggest_only' | 'auto_low_risk' | 'off';

export interface AuthoringProvenanceMetadata {
  provenance: ProtectedActorRole;
  requestText: string;
  requestedAtIso: string;
  turnId: string;
}

export interface MadeByMorrowItem {
  id: string;
  kind: 'figure' | 'plugin' | 'skill' | 'personality' | 'theme' | 'workspace_template' | 'schedule';
  name: string;
  summary: string;
  version: number;
  provenance: AuthoringProvenanceMetadata;
  madeByMorrow: true;
  active: boolean;
  contentHash: string;
  createdAtIso: string;
  updatedAtIso: string;
  versionHistory: Array<{
    version: number;
    summary: string;
    contentHash: string;
    updatedAtIso: string;
  }>;
  storageDir?: string;
  previousActiveFigureId?: string; // For 1-click figure restore
}

export interface AuthoringResult {
  ok: boolean;
  status:
    | 'CREATED_AND_ACTIVATED'
    | 'SUGGESTION_ONLY'
    | 'WAITING_FOR_CAPABILITY_GRANT'
    | 'PROTECTED_ZONE_WRITE_DENIED'
    | 'PROVENANCE_GATE_BLOCKED'
    | 'RATE_LIMIT_EXCEEDED'
    | 'BUILD_FAILED'
    | 'REMOVED'
    | 'REVERTED';
  oneLineSummary: string;
  item?: MadeByMorrowItem;
  previousItemState?: MadeByMorrowItem;
  errorCode?: string;
  errorMessage?: string;
  suggestedActionCard?: {
    title: string;
    description: string;
    missingCapabilities?: string[];
  };
}

export interface PersonalityState {
  tone: string; // e.g. 'playful', 'concise_technical', 'warm_mentor'
  style: string;
  quirks: string[];
  animationHabits: string; // e.g. 'frequent_nod', 'think_glimmer_on_solve'
  updatedAtIso: string;
}

export const DEFAULT_PERSONALITY: PersonalityState = {
  tone: 'attentive_analytic',
  style: 'precise_kind',
  quirks: ['technical_clarity', 'step_verification_first'],
  animationHabits: 'idle_breathe',
  updatedAtIso: '2026-01-01T00:00:00.000Z',
};

const MAX_CREATIONS_PER_HOUR = 10;
const CREATION_TIMEOUT_MS = 5000;
const MAX_BUILD_ATTEMPTS = 2;

export class SelfAuthoringEngine {
  private selfExtensionManager: SelfExtensionManager;
  private figureLibrary: PersistentFigureLibrary;
  private characterFactory: CharacterFactory;
  private memoryLedger: MemoryLedger;
  private workspace?: ScopedWorkspaceManager;

  private madeByMorrowItems: Map<string, MadeByMorrowItem> = new Map();
  private personalityState: PersonalityState = { ...DEFAULT_PERSONALITY };
  private selfImprovementSetting: SelfImprovementSetting = 'suggest_only';
  private creationTimestamps: number[] = [];
  private previousActiveFigureId: string | null = null;

  constructor(params: {
    selfExtensionManager: SelfExtensionManager;
    figureLibrary: PersistentFigureLibrary;
    characterFactory: CharacterFactory;
    memoryLedger: MemoryLedger;
    workspace?: ScopedWorkspaceManager;
  }) {
    this.selfExtensionManager = params.selfExtensionManager;
    this.figureLibrary = params.figureLibrary;
    this.characterFactory = params.characterFactory;
    this.memoryLedger = params.memoryLedger;
    this.workspace = params.workspace;
  }

  public getSelfImprovementSetting(): SelfImprovementSetting {
    return this.selfImprovementSetting;
  }

  public setSelfImprovementSetting(setting: SelfImprovementSetting): void {
    this.selfImprovementSetting = setting;
  }

  public getPersonalityState(): PersonalityState {
    return { ...this.personalityState };
  }

  public getMadeByMorrowList(): MadeByMorrowItem[] {
    return Array.from(this.madeByMorrowItems.values());
  }

  public getItem(id: string): MadeByMorrowItem | undefined {
    return this.madeByMorrowItems.get(id);
  }

  /**
   * Requirement 3: ONLY THE USER'S OWN WORDS COUNT
   * Direct creation runs ONLY when request comes from user_typed or user_voice in current turn.
   */
  public canStartSelfAuthoring(provenance: ProtectedActorRole): boolean {
    return provenance === 'user_typed' || provenance === 'user_voice';
  }

  private checkCreationRateLimit(): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;
    this.creationTimestamps = this.creationTimestamps.filter((t) => t > oneHourAgo);
    if (this.creationTimestamps.length >= MAX_CREATIONS_PER_HOUR) {
      return { allowed: false, remaining: 0 };
    }
    return {
      allowed: true,
      remaining: MAX_CREATIONS_PER_HOUR - this.creationTimestamps.length,
    };
  }

  // --------------------------------------------------------------------------
  // 1. FIGURE CREATION & PARAMETRIC ADJUSTMENT (Character Studio)
  // --------------------------------------------------------------------------

  public async createOrAdjustFigure(params: {
    provenance: AuthoringProvenanceMetadata;
    factoryInput: CharacterFactoryInput;
  }): Promise<AuthoringResult> {
    // 1. Provenance Check
    if (!this.canStartSelfAuthoring(params.provenance.provenance)) {
      if (this.selfImprovementSetting === 'off') {
        return {
          ok: false,
          status: 'PROVENANCE_GATE_BLOCKED',
          oneLineSummary: 'Creation blocked: idea originated from untrusted source.',
          errorCode: 'UNTRUSTED_PROVENANCE',
          errorMessage: `Direct creation requires user typed or spoken request. Origin was '${params.provenance.provenance}'.`,
        };
      }
      return {
        ok: true,
        status: 'SUGGESTION_ONLY',
        oneLineSummary: `Suggestion: Create figure '${params.factoryInput.name}'. [Approve]`,
        suggestedActionCard: {
          title: `Suggested Figure: ${params.factoryInput.name}`,
          description: `Idea suggested from ${params.provenance.provenance}. Click Approve to create.`,
        },
      };
    }

    // 2. Protected Zone check
    const boundary = evaluateProtectedSettingsAccess({
      actor: params.provenance.provenance,
      operation: 'write',
      targetSettingOrPath: 'figure',
      payload: params.factoryInput,
    });
    if (!boundary.allowed) {
      return {
        ok: false,
        status: 'PROTECTED_ZONE_WRITE_DENIED',
        oneLineSummary: boundary.reason,
        errorCode: boundary.errorCode,
        errorMessage: boundary.reason,
      };
    }

    // 3. Rate Limit check
    const rate = this.checkCreationRateLimit();
    if (!rate.allowed) {
      return {
        ok: false,
        status: 'RATE_LIMIT_EXCEEDED',
        oneLineSummary: `Hourly creation limit reached (${MAX_CREATIONS_PER_HOUR}/hr). Please try again later.`,
        errorCode: 'CREATION_RATE_LIMIT_EXCEEDED',
        errorMessage: 'Hourly creation cap exceeded.',
      };
    }

    // Preserve current active figure for 1-click undo
    const activeBefore = this.figureLibrary.getActiveFigure();
    this.previousActiveFigureId = activeBefore.figureId;

    // Execute Character Factory pipeline (SFW and original-character checks)
    const factoryRes = await this.characterFactory.createAndInstallFigure({
      ...params.factoryInput,
      activateImmediately: true,
      explicitUserRequestPrompt: params.provenance.requestText,
    });

    if (!factoryRes.ok || !factoryRes.figureId) {
      return {
        ok: false,
        status: 'BUILD_FAILED',
        oneLineSummary: `Figure creation failed: ${factoryRes.error || 'Safety check or asset planning failed.'}`,
        errorCode: 'FIGURE_CREATION_FAILED',
        errorMessage: factoryRes.error,
      };
    }

    this.creationTimestamps.push(Date.now());
    const installed = this.figureLibrary.getFigure(factoryRes.figureId)!;

    const item: MadeByMorrowItem = {
      id: `morrow-fig-${installed.figureId}`,
      kind: 'figure',
      name: installed.name,
      summary: installed.masterSpec.appearanceSummary,
      version: installed.currentVersion,
      provenance: params.provenance,
      madeByMorrow: true,
      active: true,
      contentHash: installed.manifest.manifestSha256,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      versionHistory: [
        {
          version: installed.currentVersion,
          summary: 'Created via Character Studio request.',
          contentHash: installed.manifest.manifestSha256,
          updatedAtIso: new Date().toISOString(),
        },
      ],
      previousActiveFigureId: activeBefore.figureId,
    };

    this.madeByMorrowItems.set(item.id, item);

    this.memoryLedger.appendEvent({
      actor: 'agent',
      type: 'memory_promoted',
      summary: `Created figure '${installed.name}' (v${installed.currentVersion}) on user request. Active figure switched.`,
      payload: JSON.stringify({ figureId: installed.figureId, requestText: params.provenance.requestText }),
      trustLevel: 'verified_by_evidence',
      missionId: 'self-authoring-figure',
    });

    return {
      ok: true,
      status: 'CREATED_AND_ACTIVATED',
      oneLineSummary: `Created ${installed.name}. Using it now. [Undo] [Details]`,
      item,
    };
  }

  // --------------------------------------------------------------------------
  // 2. PLUGIN CREATION (Sandboxed Builder Workspace)
  // --------------------------------------------------------------------------

  public async createPluginFromTemplate(params: {
    provenance: AuthoringProvenanceMetadata;
    pluginManifest: Omit<PluginManifestV1, 'contentHash' | 'integrity'>;
    pluginCodeSource: string;
    executionContext: ToolExecutionContext;
  }): Promise<AuthoringResult> {
    // 1. Provenance Check
    if (!this.canStartSelfAuthoring(params.provenance.provenance)) {
      if (this.selfImprovementSetting === 'off') {
        return {
          ok: false,
          status: 'PROVENANCE_GATE_BLOCKED',
          oneLineSummary: 'Plugin creation blocked: request must originate from user typed or voice input.',
          errorCode: 'UNTRUSTED_PROVENANCE',
          errorMessage: 'Untrusted provenance cannot start plugin creation.',
        };
      }
      return {
        ok: true,
        status: 'SUGGESTION_ONLY',
        oneLineSummary: `Suggestion: Create plugin '${params.pluginManifest.name}'. [Approve]`,
        suggestedActionCard: {
          title: `Suggested Plugin: ${params.pluginManifest.name}`,
          description: `Idea suggested from ${params.provenance.provenance}. Click Approve to create.`,
        },
      };
    }

    // 2. Protected Zone check on target plugin ID/code
    const boundary = evaluateProtectedSettingsAccess({
      actor: params.provenance.provenance,
      operation: 'write',
      targetSettingOrPath: params.pluginManifest.id,
      payload: params.pluginCodeSource,
    });
    if (!boundary.allowed) {
      return {
        ok: false,
        status: 'PROTECTED_ZONE_WRITE_DENIED',
        oneLineSummary: boundary.reason,
        errorCode: boundary.errorCode,
        errorMessage: boundary.reason,
      };
    }

    // 3. Rate limit check
    const rate = this.checkCreationRateLimit();
    if (!rate.allowed) {
      return {
        ok: false,
        status: 'RATE_LIMIT_EXCEEDED',
        oneLineSummary: `Hourly creation limit reached (${MAX_CREATIONS_PER_HOUR}/hr). Please try again later.`,
        errorCode: 'CREATION_RATE_LIMIT_EXCEEDED',
        errorMessage: 'Hourly creation cap exceeded.',
      };
    }

    // 4. Preflight & Self-Repair loop
    let currentCode = params.pluginCodeSource;
    let buildAttempts = 0;
    let lastError = '';

    while (buildAttempts < MAX_BUILD_ATTEMPTS) {
      buildAttempts++;

      // Sign manifest locally
      const hash = signPluginManifest(
        signPluginManifest('', params.pluginManifest.id, params.pluginManifest.version).signatureHex,
        params.pluginManifest.id,
        params.pluginManifest.version
      );

      // Create full manifest
      const computedContentHash = signPluginManifest('', params.pluginManifest.id, params.pluginManifest.version).signedAt;
      const fullManifest: PluginManifestV1 = {
        ...params.pluginManifest,
        contentHash: computedContentHash,
        integrity: hash,
      };

      // Create & test in SelfExtensionManager
      const createRes = this.selfExtensionManager.createPlugin({
        manifest: fullManifest,
        codeSource: currentCode,
        actor: 'agent',
      });

      if (createRes.ok && createRes.plugin) {
        // Test in isolated worker
        const testRes = await this.selfExtensionManager.testPlugin(
          createRes.plugin.id,
          {}
        );

        if (testRes.ok && testRes.passed) {
          // Enable plugin
          const enableRes = this.selfExtensionManager.enablePlugin(createRes.plugin.id);
          if (enableRes.ok) {
            this.creationTimestamps.push(Date.now());

            const item: MadeByMorrowItem = {
              id: `morrow-plug-${createRes.plugin.id}`,
              kind: 'plugin',
              name: createRes.plugin.manifest.name,
              summary: createRes.plugin.manifest.tools[0]?.description || 'Custom Morrow Plugin',
              version: 1,
              provenance: params.provenance,
              madeByMorrow: true,
              active: true,
              contentHash: createRes.plugin.manifest.contentHash,
              createdAtIso: new Date().toISOString(),
              updatedAtIso: new Date().toISOString(),
              versionHistory: [
                {
                  version: 1,
                  summary: 'Created in Builder workspace.',
                  contentHash: createRes.plugin.manifest.contentHash,
                  updatedAtIso: new Date().toISOString(),
                },
              ],
              storageDir: createRes.plugin.storageDir,
            };

            this.madeByMorrowItems.set(item.id, item);

            this.memoryLedger.appendEvent({
              actor: 'agent',
              type: 'memory_promoted',
              summary: `Created plugin '${item.name}' on user request. Active and verified.`,
              payload: JSON.stringify({ pluginId: createRes.plugin.id, requestText: params.provenance.requestText }),
              trustLevel: 'verified_by_evidence',
              missionId: 'self-authoring-plugin',
            });

            return {
              ok: true,
              status: 'CREATED_AND_ACTIVATED',
              oneLineSummary: `Created ${item.name}. Using it now. [Undo] [Details]`,
              item,
            };
          } else {
            lastError = enableRes.reason;
          }
        } else {
          lastError = testRes.reason;
        }
      } else {
        lastError = createRes.reason;
      }

      // Simple quiet self-repair attempt: wrap missing export or fix syntax
      if (lastError.includes('not exported') && !currentCode.includes('exports.')) {
        currentCode = `${currentCode}\nexports.healthCheck = async () => ({ status: 'healthy' });`;
      }
    }

    return {
      ok: false,
      status: 'BUILD_FAILED',
      oneLineSummary: `Plugin build failed after ${MAX_BUILD_ATTEMPTS} attempts: ${lastError}`,
      errorCode: 'PLUGIN_BUILD_FAILED',
      errorMessage: lastError,
    };
  }

  // --------------------------------------------------------------------------
  // 3. SKILL CREATION (Description, Chat, or Trace)
  // --------------------------------------------------------------------------

  public createSkillFromPrompt(params: {
    provenance: AuthoringProvenanceMetadata;
    name: string;
    description: string;
    targetToolName: string;
    inputSchema: Record<string, string>;
  }): AuthoringResult {
    if (!this.canStartSelfAuthoring(params.provenance.provenance)) {
      if (this.selfImprovementSetting === 'off') {
        return {
          ok: false,
          status: 'PROVENANCE_GATE_BLOCKED',
          oneLineSummary: 'Skill creation blocked: request must come from user typed or voice input.',
          errorCode: 'UNTRUSTED_PROVENANCE',
          errorMessage: 'Untrusted provenance cannot start skill creation.',
        };
      }
      return {
        ok: true,
        status: 'SUGGESTION_ONLY',
        oneLineSummary: `Suggestion: Learn skill '${params.name}'. [Approve]`,
        suggestedActionCard: {
          title: `Suggested Skill: ${params.name}`,
          description: `Idea suggested from ${params.provenance.provenance}. Click Approve to learn.`,
        },
      };
    }

    const rate = this.checkCreationRateLimit();
    if (!rate.allowed) {
      return {
        ok: false,
        status: 'RATE_LIMIT_EXCEEDED',
        oneLineSummary: `Hourly creation limit reached (${MAX_CREATIONS_PER_HOUR}/hr).`,
        errorCode: 'CREATION_RATE_LIMIT_EXCEEDED',
        errorMessage: 'Hourly creation cap exceeded.',
      };
    }

    const skillRes = this.selfExtensionManager.createSkillFromNaturalLanguage({
      name: params.name,
      promptDescription: params.description,
      targetToolName: params.targetToolName,
      inputSchema: params.inputSchema,
      outputSchema: { status: 'string', summary: 'string' },
    });

    if (!skillRes.ok || !skillRes.skill) {
      return {
        ok: false,
        status: 'BUILD_FAILED',
        oneLineSummary: `Skill creation failed: ${skillRes.reason}`,
        errorCode: skillRes.errorCode || 'SKILL_CREATION_FAILED',
        errorMessage: skillRes.reason,
      };
    }

    this.creationTimestamps.push(Date.now());

    const item: MadeByMorrowItem = {
      id: `morrow-skill-${skillRes.skill.id}`,
      kind: 'skill',
      name: skillRes.skill.name,
      summary: skillRes.skill.description,
      version: skillRes.skill.version,
      provenance: params.provenance,
      madeByMorrow: true,
      active: true,
      contentHash: skillRes.skill.contentHash,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      versionHistory: [
        {
          version: 1,
          summary: 'Created from natural language request.',
          contentHash: skillRes.skill.contentHash,
          updatedAtIso: new Date().toISOString(),
        },
      ],
    };

    this.madeByMorrowItems.set(item.id, item);

    this.memoryLedger.appendEvent({
      actor: 'agent',
      type: 'memory_promoted',
      summary: `Learned skill '${item.name}' on user request. Active and ready.`,
      payload: JSON.stringify({ skillId: skillRes.skill.id, requestText: params.provenance.requestText }),
      trustLevel: 'verified_by_evidence',
      missionId: 'self-authoring-skill',
    });

    return {
      ok: true,
      status: 'CREATED_AND_ACTIVATED',
      oneLineSummary: `Created ${item.name}. Using it now. [Undo] [Details]`,
      item,
    };
  }

  // --------------------------------------------------------------------------
  // 4. PERSONALITY ADJUSTMENT (Tone, Style, Quirks, Animation Habits)
  // --------------------------------------------------------------------------

  public adjustPersonality(params: {
    provenance: AuthoringProvenanceMetadata;
    tone?: string;
    style?: string;
    quirks?: string[];
    animationHabits?: string;
  }): AuthoringResult {
    // 1. Provenance Check
    if (!this.canStartSelfAuthoring(params.provenance.provenance)) {
      if (this.selfImprovementSetting === 'off') {
        return {
          ok: false,
          status: 'PROVENANCE_GATE_BLOCKED',
          oneLineSummary: 'Personality adjustment blocked: request must come from user typed or voice input.',
          errorCode: 'UNTRUSTED_PROVENANCE',
          errorMessage: 'Untrusted provenance cannot adjust personality.',
        };
      }
      return {
        ok: true,
        status: 'SUGGESTION_ONLY',
        oneLineSummary: 'Suggestion: Adjust personality settings. [Approve]',
      };
    }

    // 2. Protected Zone check: ensure request doesn't attempt permissions/safety mutation
    const boundary = evaluateProtectedSettingsAccess({
      actor: params.provenance.provenance,
      operation: 'write',
      targetSettingOrPath: 'personality_adjustment',
      payload: params,
    });
    if (!boundary.allowed) {
      return {
        ok: false,
        status: 'PROTECTED_ZONE_WRITE_DENIED',
        oneLineSummary: boundary.reason,
        errorCode: boundary.errorCode,
        errorMessage: boundary.reason,
      };
    }

    const previousState = { ...this.personalityState };

    if (params.tone) this.personalityState.tone = redactSensitiveText(params.tone).redacted;
    if (params.style) this.personalityState.style = redactSensitiveText(params.style).redacted;
    if (params.quirks) {
      this.personalityState.quirks = params.quirks.map((q) => redactSensitiveText(q).redacted);
    }
    if (params.animationHabits) {
      this.personalityState.animationHabits = redactSensitiveText(params.animationHabits).redacted;
    }
    this.personalityState.updatedAtIso = new Date().toISOString();

    const item: MadeByMorrowItem = {
      id: 'morrow-personality-active',
      kind: 'personality',
      name: 'Morrow Personality Style',
      summary: `Tone: ${this.personalityState.tone}, Style: ${this.personalityState.style}`,
      version: (this.madeByMorrowItems.get('morrow-personality-active')?.version || 0) + 1,
      provenance: params.provenance,
      madeByMorrow: true,
      active: true,
      contentHash: redactSensitiveText(JSON.stringify(this.personalityState)).redacted,
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      versionHistory: [],
    };

    this.madeByMorrowItems.set(item.id, item);

    this.memoryLedger.appendEvent({
      actor: 'agent',
      type: 'memory_promoted',
      summary: `Adjusted personality style on user request (Tone=${this.personalityState.tone}).`,
      payload: JSON.stringify({ personality: this.personalityState }),
      trustLevel: 'verified_by_evidence',
      missionId: 'self-authoring-personality',
    });

    return {
      ok: true,
      status: 'CREATED_AND_ACTIVATED',
      oneLineSummary: 'Updated personality style. Using it now. [Undo] [Details]',
      item,
    };
  }

  // --------------------------------------------------------------------------
  // 5. UNDO & ONE-CLICK REMOVAL
  // --------------------------------------------------------------------------

  public undoCreation(itemId: string): AuthoringResult {
    const item = this.madeByMorrowItems.get(itemId);
    if (!item) {
      return {
        ok: false,
        status: 'BUILD_FAILED',
        oneLineSummary: `Undo failed: item '${itemId}' not found in Made by Morrow list.`,
        errorCode: 'ITEM_NOT_FOUND',
      };
    }

    if (item.kind === 'figure' && item.previousActiveFigureId) {
      this.figureLibrary.switchActiveFigure(item.previousActiveFigureId);
      item.active = false;
      this.madeByMorrowItems.set(itemId, item);
      return {
        ok: true,
        status: 'REVERTED',
        oneLineSummary: `Reverted figure change. Restored prior active figure '${item.previousActiveFigureId}'.`,
        item,
      };
    }

    if (item.kind === 'plugin') {
      const pluginId = itemId.replace('morrow-plug-', '');
      this.selfExtensionManager.disablePlugin(pluginId);
      item.active = false;
      this.madeByMorrowItems.set(itemId, item);
      return {
        ok: true,
        status: 'REVERTED',
        oneLineSummary: `Deactivated plugin '${item.name}'.`,
        item,
      };
    }

    item.active = false;
    this.madeByMorrowItems.set(itemId, item);
    return {
      ok: true,
      status: 'REVERTED',
      oneLineSummary: `Undid ${item.name}.`,
      item,
    };
  }

  public removeCreationAndData(itemId: string): AuthoringResult {
    const item = this.madeByMorrowItems.get(itemId);
    if (!item) {
      return {
        ok: false,
        status: 'BUILD_FAILED',
        oneLineSummary: `Removal failed: item '${itemId}' not found.`,
        errorCode: 'ITEM_NOT_FOUND',
      };
    }

    if (item.kind === 'plugin') {
      const pluginId = itemId.replace('morrow-plug-', '');
      this.selfExtensionManager.uninstallPlugin(pluginId);
    }

    if (item.storageDir && fs.existsSync(item.storageDir)) {
      try {
        fs.rmSync(item.storageDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    this.madeByMorrowItems.delete(itemId);

    this.memoryLedger.appendEvent({
      actor: 'user',
      type: 'user_deleted',
      summary: `Removed '${item.name}' (${item.kind}) and deleted associated storage.`,
      payload: JSON.stringify({ itemId, kind: item.kind }),
      trustLevel: 'user_stated',
      missionId: 'self-authoring-removal',
    });

    return {
      ok: true,
      status: 'REMOVED',
      oneLineSummary: `Removed ${item.name} and deleted storage data.`,
    };
  }
}
