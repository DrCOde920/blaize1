/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspace Package — Pure deterministic logic for:
 * 1. Projects (multi-project scoping for chats, artifacts, skills, connectors, schedules, IDE files)
 * 2. Artifacts (Claude Artifacts & Google AI Studio style live preview, versioning, rollback, chat extraction)
 * 3. Reusable Skills (parameterized SKILL.md templates, PolicyGuard validation, execution)
 * 4. Connectors (1P/3P service connectors with PolicyGuard read/write scopes & project binding)
 * 5. Scheduler (cron/interval compiler, deterministic next-5-runs, PolicyGuard money/write safety check)
 * 6. VS Code IDE & VS Code Marketplace Addons (file tree, extensions catalog, OpenVSX query adapter, formatting & lint diagnostics)
 */

export type ArtifactKind =
  | 'html_preview'
  | 'react_component'
  | 'svg_graphic'
  | 'markdown_doc'
  | 'typescript_code'
  | 'json_schema';

export interface ArtifactVersion {
  version: number;
  content: string;
  CreatedAt: string;
  summary: string;
}

export interface WorkspaceArtifact {
  id: string;
  projectId: string;
  title: string;
  kind: ArtifactKind;
  language: string;
  content: string;
  versions: ArtifactVersion[];
  currentVersion: number;
  updatedAt: string;
  sourcePrompt?: string;
}

export interface SkillParameterSpec {
  name: string;
  label: string;
  defaultValue: string;
  required: boolean;
  description: string;
}

export interface ReusableSkill {
  id: string;
  name: string;
  slug: string;
  category: 'financial' | 'engineering' | 'research' | 'automation' | 'creative';
  description: string;
  skillMarkdown: string;
  parameters: SkillParameterSpec[];
  requiredConnectors: string[];
  usageCount: number;
  guardVerified: boolean;
}

export type ConnectorStatus = 'connected' | 'disconnected' | 'Requires_Auth';

export interface WorkspaceConnector {
  id: string;
  name: string;
  provider: string;
  category: 'Code & Git' | 'Workspace & Docs' | 'Database' | 'Messaging' | 'Finance Sandbox';
  description: string;
  status: ConnectorStatus;
  endpointSummary: string;
  scopes: string[];
  readAllowed: boolean;
  writeRequiresApproval: boolean;
  boundProjectIds: string[];
  lastSyncAt: string;
}

export interface ScheduledTaskItem {
  id: string;
  projectId: string;
  title: string;
  naturalSchedule: string;
  cronExpression: string;
  timezone: string;
  actionPrompt: string;
  linkedSkillId?: string;
  enabled: boolean;
  nextFiveRuns: string[];
  lastRunAt?: string;
  lastRunStatus: 'idle' | 'verified_ok' | 'blocked_by_guard';
  guardNote: string;
}

export interface IdeFileNode {
  id: string;
  projectId: string;
  path: string;
  name: string;
  language: 'typescript' | 'tsx' | 'html' | 'css' | 'json' | 'markdown';
  content: string;
  linkedArtifactId?: string;
}

export interface VSCodeMarketplaceExtension {
  id: string; // publisher.extensionName
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  downloads: string;
  rating: number;
  categories: ('Formatters' | 'Linters' | 'Themes' | 'Snippets' | 'AI & Productivity' | 'Preview')[];
  description: string;
  marketplaceUrl: string;
  installed: boolean;
  enabled: boolean;
  readmeSummary: string;
  contributes: {
    editorTheme?: 'vs-dark-modern' | 'dracula-pro' | 'github-dark-dimmed' | 'monokai-vibrant' | 'solarized-light';
    formatter?: boolean;
    linter?: boolean;
    livePreview?: boolean;
    snippets?: { prefix: string; label: string; body: string }[];
    commands?: { id: string; title: string }[];
  };
}

export interface WorkspaceProject {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemInstruction: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 1. DEFAULT PROJECTS
// ============================================================================

export const INITIAL_WORKSPACE_PROJECTS: WorkspaceProject[] = [
  {
    id: 'proj-fintech-audit',
    name: 'Personal Finance & Utility Ops',
    slug: 'personal-finance-ops',
    description:
      'Automated statement reconciliation, Safe-to-Spend analytics, and guarded utility bill drafts with L3xi and AI Browser.',
    systemInstruction:
      'Prioritize exact integer-cent arithmetic, cite evidence hashes from MockBank, and always pause for PolicyGuard approval on bill drafts.',
    accentColor: '#F59E0B',
    createdAt: '2025-10-20',
    updatedAt: 'Today',
  },
  {
    id: 'proj-living-desktop',
    name: 'Blaize Full-Stack Studio',
    slug: 'blaize-fullstack-studio',
    description:
      'Interactive UI components, TypeScript skills, visual dashboards, and scheduled web research pipelines.',
    systemInstruction:
      'Generate modular TypeScript and interactive HTML/React artifacts with clean accessibility semantics and deterministic unit tests.',
    accentColor: '#38BDF8',
    createdAt: '2025-10-24',
    updatedAt: 'Today',
  },
];

export function createWorkspaceProject(input: {
  name: string;
  description: string;
  systemInstruction?: string;
  accentColor?: string;
}): WorkspaceProject {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error('Project name is required.');
  }
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    id: `proj-${slug || 'custom'}-${Date.now().toString(36)}`,
    name: cleanName,
    slug: slug || 'custom-project',
    description: input.description.trim() || 'Custom Blaize workspace project.',
    systemInstruction:
      input.systemInstruction?.trim() ||
      'Follow Trust Kernel PolicyGuard rules and verify all outputs before completion.',
    accentColor: input.accentColor || '#10B981',
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: 'Just now',
  };
}

export function updateWorkspaceProject(
  projects: WorkspaceProject[],
  projectId: string,
  patch: Partial<Pick<WorkspaceProject, 'name' | 'description' | 'systemInstruction' | 'accentColor'>>
): WorkspaceProject[] {
  return projects.map((proj) => {
    if (proj.id !== projectId) return proj;
    const nextName = patch.name !== undefined ? patch.name.trim() || proj.name : proj.name;
    return {
      ...proj,
      name: nextName,
      description:
        patch.description !== undefined ? patch.description.trim() : proj.description,
      systemInstruction:
        patch.systemInstruction !== undefined
          ? patch.systemInstruction.trim()
          : proj.systemInstruction,
      accentColor: patch.accentColor || proj.accentColor,
      updatedAt: 'Just now',
    };
  });
}

// ============================================================================
// 2. INITIAL ARTIFACTS (Claude & Google AI Studio Style)
// ============================================================================

export const INITIAL_WORKSPACE_ARTIFACTS: WorkspaceArtifact[] = [
  {
    id: 'art-safe-spend-widget',
    projectId: 'proj-fintech-audit',
    title: 'Interactive October Safe-to-Spend Dashboard',
    kind: 'html_preview',
    language: 'html',
    currentVersion: 2,
    updatedAt: '10 mins ago',
    sourcePrompt: 'Build an interactive Safe-to-Spend widget for my October statement',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f131c; color: #f5f5f4; margin: 0; padding: 20px; }
  .card { background: #171c28; border: 1px solid #2b3348; border-radius: 16px; padding: 20px; max-width: 520px; margin: 0 auto; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
  .metric { font-size: 32px; font-weight: 800; color: #fbbf24; margin: 10px 0 4px; font-variant-numeric: tabular-nums; }
  .sub { font-size: 12px; color: #9ca3af; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
  .box { background: #10141d; border: 1px solid #232a3b; border-radius: 12px; padding: 10px; }
  .box-label { font-size: 11px; color: #9ca3af; }
  .box-val { font-size: 14px; font-weight: 700; margin-top: 4px; }
  .slider-wrap { margin-top: 18px; padding-top: 14px; border-top: 1px solid #252d3f; }
  input[type=range] { width: 100%; accent-color: #fbbf24; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">L3xi Verified · Integer-Cent Ledger</span>
    <div class="metric" id="safeDisplay">GHS 1,037.50</div>
    <div class="sub">Weekly Safe-to-Spend after Bills (GHS 620.00) &amp; Savings Floor (GHS 800.00)</div>
    <div class="grid">
      <div class="box">
        <div class="box-label">Closing Balance</div>
        <div class="box-val" style="color:#38bdf8">GHS 2,457.50</div>
      </div>
      <div class="box">
        <div class="box-label">Upcoming Bills</div>
        <div class="box-val" style="color:#f87171">GHS 620.00</div>
      </div>
      <div class="box">
        <div class="box-label">Reserve Buffer</div>
        <div class="box-val" id="bufVal" style="color:#34d399">GHS 800.00</div>
      </div>
    </div>
    <div class="slider-wrap">
      <label style="font-size:12px;display:flex;justify-content:space-between;">
        <span>Simulate Reserve Buffer Adjustment:</span>
        <strong id="sliderLabel">GHS 800</strong>
      </label>
      <input id="reserveSlider" type="range" min="200" max="1500" step="50" value="800" />
    </div>
  </div>
  <script>
    const slider = document.getElementById('reserveSlider');
    const safeDisplay = document.getElementById('safeDisplay');
    const bufVal = document.getElementById('bufVal');
    const sliderLabel = document.getElementById('sliderLabel');
    slider.addEventListener('input', () => {
      const reserve = Number(slider.value);
      const safe = Math.max(0, 2457.50 - 620.00 - reserve);
      safeDisplay.textContent = 'GHS ' + safe.toFixed(2);
      bufVal.textContent = 'GHS ' + reserve.toFixed(2);
      sliderLabel.textContent = 'GHS ' + reserve;
    });
  </script>
</body>
</html>`,
    versions: [
      {
        version: 1,
        CreatedAt: '25 mins ago',
        summary: 'Initial static October balance breakdown card',
        content: `<div style="padding:20px;color:white;background:#111">October Safe-to-Spend: GHS 1,037.50</div>`,
      },
      {
        version: 2,
        CreatedAt: '10 mins ago',
        summary: 'Added interactive Reserve Buffer simulation slider and integer-cent metrics',
        content: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body>Interactive October Safe-to-Spend v2</body>
</html>`,
      },
    ],
  },
  {
    id: 'art-architecture-svg',
    projectId: 'proj-fintech-audit',
    title: 'Trust Kernel & PolicyGuard Flow Diagram',
    kind: 'svg_graphic',
    language: 'svg',
    currentVersion: 1,
    updatedAt: '1 hour ago',
    sourcePrompt: 'Draw an SVG architecture diagram of how PolicyGuard intercepts money actions',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 240" width="100%" height="100%">
  <rect width="680" height="240" rx="16" fill="#0d111a"/>
  <rect x="24" y="70" width="150" height="90" rx="12" fill="#172033" stroke="#38bdf8" stroke-width="2"/>
  <text x="99" y="110" fill="#e0f2fe" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">Chat / Skill Call</text>
  <text x="99" y="130" fill="#7dd3fc" font-family="monospace" font-size="10" text-anchor="middle">Untrusted Input</text>

  <path d="M 174 115 L 245 115" stroke="#fbbf24" stroke-width="2.5" fill="none"/>
  <polygon points="245,110 255,115 245,120" fill="#fbbf24"/>

  <rect x="255" y="55" width="170" height="120" rx="14" fill="#1f1a14" stroke="#f59e0b" stroke-width="2.5"/>
  <text x="340" y="98" fill="#fde68a" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">PolicyGuard Kernel</text>
  <text x="340" y="120" fill="#fbbf24" font-family="monospace" font-size="10" text-anchor="middle">Domain + Spend Cap Check</text>
  <text x="340" y="142" fill="#34d399" font-family="monospace" font-size="10" text-anchor="middle">Hash-Chained Ledger</text>

  <path d="M 425 115 L 495 115" stroke="#34d399" stroke-width="2.5" fill="none"/>
  <polygon points="495,110 505,115 495,120" fill="#34d399"/>

  <rect x="505" y="70" width="150" height="90" rx="12" fill="#112622" stroke="#10b981" stroke-width="2"/>
  <text x="580" y="110" fill="#d1fae5" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">Verified Execution</text>
  <text x="580" y="130" fill="#6ee7b7" font-family="monospace" font-size="10" text-anchor="middle">Proof Receipt Emitted</text>
</svg>`,
    versions: [
      {
        version: 1,
        CreatedAt: '1 hour ago',
        summary: 'Generated vector diagram of Trust Kernel PolicyGuard pipeline',
        content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 240"></svg>`,
      },
    ],
  },
  {
    id: 'art-studio-spec',
    projectId: 'proj-living-desktop',
    title: 'Morrow 2D Companion State Machine Spec',
    kind: 'markdown_doc',
    language: 'markdown',
    currentVersion: 1,
    updatedAt: 'Yesterday',
    sourcePrompt: 'Write a clean specification for the Morrow 2D companion idle ladder and chair anchor',
    content: `# Morrow 2D Companion Specification

## 1. Executive Chair Anchor in Chat
- Whenever \`activeView === 'chat'\`, Morrow walks to the **top-center chair stage** of the Chat panel and takes a seat facing the user.
- Clicking Morrow opens her **Pop-out Chat Box** anchored right beside her so you can chat face-to-face.

## 2. Grounded Idle Ladder
- **stand_idle** -> after 45s -> **sit_idle** -> after 3m -> **rest** -> after 10m -> **sleep**.
- Any user interaction, approval request, or tool run wakes her immediately.`,
    versions: [
      {
        version: 1,
        CreatedAt: 'Yesterday',
        summary: 'Initial specification for Morrow top-center chair and idle ladder',
        content: `# Morrow 2D Companion Specification`,
      },
    ],
  },
];

export function createOrUpdateArtifact(
  existingArtifacts: WorkspaceArtifact[],
  input: {
    id?: string;
    projectId: string;
    title: string;
    kind: ArtifactKind;
    language: string;
    content: string;
    summary?: string;
    sourcePrompt?: string;
  }
): { artifacts: WorkspaceArtifact[]; activeArtifact: WorkspaceArtifact } {
  const cleanTitle = input.title.trim() || 'Untitled Artifact';
  const existing = input.id ? existingArtifacts.find((a) => a.id === input.id) : undefined;

  if (existing) {
    const nextVersionNumber = existing.versions.length + 1;
    const newVersion: ArtifactVersion = {
      version: nextVersionNumber,
      content: input.content,
      CreatedAt: 'Just now',
      summary: input.summary || `Updated to v${nextVersionNumber}`,
    };
    const updated: WorkspaceArtifact = {
      ...existing,
      title: cleanTitle,
      kind: input.kind,
      language: input.language,
      content: input.content,
      versions: [...existing.versions, newVersion],
      currentVersion: nextVersionNumber,
      updatedAt: 'Just now',
    };
    return {
      artifacts: existingArtifacts.map((a) => (a.id === existing.id ? updated : a)),
      activeArtifact: updated,
    };
  }

  const newId = `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const created: WorkspaceArtifact = {
    id: newId,
    projectId: input.projectId,
    title: cleanTitle,
    kind: input.kind,
    language: input.language,
    content: input.content,
    currentVersion: 1,
    updatedAt: 'Just now',
    sourcePrompt: input.sourcePrompt,
    versions: [
      {
        version: 1,
        content: input.content,
        CreatedAt: 'Just now',
        summary: input.summary || 'Initial artifact created',
      },
    ],
  };

  return {
    artifacts: [created, ...existingArtifacts],
    activeArtifact: created,
  };
}

export function rollbackArtifactVersion(
  artifact: WorkspaceArtifact,
  targetVersion: number
): WorkspaceArtifact {
  const found = artifact.versions.find((v) => v.version === targetVersion);
  if (!found) {
    return artifact;
  }
  return {
    ...artifact,
    content: found.content,
    currentVersion: found.version,
    updatedAt: `Restored v${found.version}`,
  };
}

// ============================================================================
// 3. REUSABLE SKILLS (SKILL.md style + PolicyGuard safe execution)
// ============================================================================

export const INITIAL_REUSABLE_SKILLS: ReusableSkill[] = [
  {
    id: 'skill-october-reconcile',
    name: 'Monthly Bank Statement Reconciler',
    slug: 'monthly-statement-reconciler',
    category: 'financial',
    description:
      'Extracts statement rows from AI Browser, validates Opening + Credits - Debits = Closing in integer cents, and generates an interactive Safe-to-Spend artifact.',
    skillMarkdown: `---
name: monthly-statement-reconciler
guard: read_only_verified
---
# Steps
1. Read statement rows from {{portal_domain}} for month {{statement_month}}.
2. Verify exact integer-cent balance equation.
3. Calculate Safe-to-Spend with reserve floor {{reserve_floor_ghs}} GHS.
4. Emit interactive HTML artifact receipt.`,
    parameters: [
      {
        name: 'portal_domain',
        label: 'Portal Domain',
        defaultValue: 'portal.mockbank.local',
        required: true,
        description: 'Allowlisted banking domain',
      },
      {
        name: 'statement_month',
        label: 'Statement Month',
        defaultValue: 'October 2026',
        required: true,
        description: 'Target reconciliation period',
      },
      {
        name: 'reserve_floor_ghs',
        label: 'Reserve Floor (GHS)',
        defaultValue: '800',
        required: true,
        description: 'Minimum savings buffer to preserve',
      },
    ],
    requiredConnectors: ['conn-mockbank-sandbox', 'conn-postgres-ledger'],
    usageCount: 18,
    guardVerified: true,
  },
  {
    id: 'skill-ui-artifact-generator',
    name: 'Interactive UI Artifact Builder',
    slug: 'interactive-ui-artifact-builder',
    category: 'engineering',
    description:
      'Compiles a live interactive HTML/CSS/JS preview artifact and syncs the source file directly into the project VS Code IDE workspace.',
    skillMarkdown: `---
name: interactive-ui-artifact-builder
guard: sandboxed_preview
---
# Steps
1. Scaffold responsive component for {{component_title}}.
2. Apply theme palette {{theme_palette}}.
3. Mount interactive controls and register in Project Artifacts & VS Code IDE.`,
    parameters: [
      {
        name: 'component_title',
        label: 'Component Title',
        defaultValue: 'Revenue & Cashflow Pulse Widget',
        required: true,
        description: 'Title of the interactive artifact',
      },
      {
        name: 'theme_palette',
        label: 'Theme Palette',
        defaultValue: 'Obsidian & Amber Gold',
        required: false,
        description: 'Color palette direction',
      },
    ],
    requiredConnectors: ['conn-github-repos'],
    usageCount: 24,
    guardVerified: true,
  },
  {
    id: 'skill-pr-security-audit',
    name: 'Trust Kernel Security & Lint Auditor',
    slug: 'trust-kernel-security-auditor',
    category: 'engineering',
    description:
      'Scans project IDE files and connector permissions for unguarded write actions, missing licenses, or PolicyGuard bypass attempts.',
    skillMarkdown: `---
name: trust-kernel-security-auditor
guard: strict_policy_audit
---
# Steps
1. Inspect repository {{repo_name}} across branch {{branch}}.
2. Verify zero unapproved write/money calls.
3. Produce signed markdown audit artifact.`,
    parameters: [
      {
        name: 'repo_name',
        label: 'Repository',
        defaultValue: 'blaize/living-desktop-core',
        required: true,
        description: 'Target repository slug',
      },
      {
        name: 'branch',
        label: 'Branch',
        defaultValue: 'main',
        required: true,
        description: 'Git branch to scan',
      },
    ],
    requiredConnectors: ['conn-github-repos', 'conn-slack-ops'],
    usageCount: 11,
    guardVerified: true,
  },
];

export function compileAndExecuteReusableSkill(
  skill: ReusableSkill,
  paramValues: Record<string, string>
): {
  ok: boolean;
  compiledPrompt: string;
  generatedArtifactTitle: string;
  generatedArtifactKind: ArtifactKind;
  generatedArtifactContent: string;
  error?: string;
} {
  for (const param of skill.parameters) {
    const val = (paramValues[param.name] ?? param.defaultValue ?? '').trim();
    if (param.required && !val) {
      return {
        ok: false,
        compiledPrompt: '',
        generatedArtifactTitle: '',
        generatedArtifactKind: 'markdown_doc',
        generatedArtifactContent: '',
        error: `Missing required parameter: ${param.label}`,
      };
    }
  }

  let interpolated = skill.skillMarkdown;
  for (const param of skill.parameters) {
    const val = (paramValues[param.name] ?? param.defaultValue ?? '').trim();
    interpolated = interpolated.split(`{{${param.name}}}`).join(val);
  }

  const primaryTitle =
    paramValues['component_title'] ||
    paramValues['statement_month'] ||
    paramValues['repo_name'] ||
    skill.name;

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 18px; margin: 0; }
  .panel { background: #161b22; border: 1px solid #30363d; border-radius: 14px; padding: 18px; }
  .tag { display: inline-block; padding: 3px 9px; border-radius: 99px; font-size: 11px; background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
  h2 { margin: 10px 0 6px; font-size: 18px; }
  pre { background: #090d13; padding: 12px; border-radius: 10px; border: 1px solid #21262d; font-size: 12px; color: #79c0ff; overflow-x: auto; }
</style>
</head>
<body>
  <div class="panel">
    <span class="tag">Skill Executed · ${skill.slug}</span>
    <h2>${skill.name} — ${primaryTitle}</h2>
    <p style="font-size:13px;color:#8b949e;">${skill.description}</p>
    <pre>${interpolated.replace(/</g, '&lt;')}</pre>
  </div>
</body>
</html>`;

  return {
    ok: true,
    compiledPrompt: `Run reusable skill "${skill.name}" (${skill.slug}) with parameters: ${JSON.stringify(
      paramValues
    )}`,
    generatedArtifactTitle: `${skill.name}: ${primaryTitle}`,
    generatedArtifactKind: 'html_preview',
    generatedArtifactContent: htmlContent,
  };
}

export function createCustomReusableSkill(input: {
  name: string;
  category: ReusableSkill['category'];
  description: string;
  skillMarkdown: string;
  parameterNames: string[];
}): ReusableSkill {
  const cleanName = input.name.trim();
  if (!cleanName) {
    throw new Error('Skill name is required.');
  }
  const lower = `${cleanName} ${input.description} ${input.skillMarkdown}`.toLowerCase();
  if (
    lower.includes('bypass policyguard') ||
    lower.includes('ignore approval') ||
    lower.includes('disable ledger')
  ) {
    throw new Error('PolicyGuard blocked skill creation: attempts to bypass Trust Kernel rules.');
  }

  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    id: `skill-${slug}-${Date.now().toString(36)}`,
    name: cleanName,
    slug: slug || 'custom-skill',
    category: input.category,
    description: input.description.trim() || 'Custom reusable workflow skill.',
    skillMarkdown:
      input.skillMarkdown.trim() ||
      `---\nname: ${slug}\nguard: verified\n---\n# Instructions\nExecute workflow safely.`,
    parameters: input.parameterNames
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({
        name: p,
        label: p.replace(/_/g, ' '),
        defaultValue: 'default',
        required: true,
        description: `Parameter ${p}`,
      })),
    requiredConnectors: [],
    usageCount: 0,
    guardVerified: true,
  };
}

// ============================================================================
// 4. CONNECTORS (1P/3P Integrations with PolicyGuard Scopes)
// ============================================================================

export const INITIAL_WORKSPACE_CONNECTORS: WorkspaceConnector[] = [
  {
    id: 'conn-github-repos',
    name: 'GitHub Repositories & Actions',
    provider: 'GitHub',
    category: 'Code & Git',
    description:
      'Syncs repository branches, pull requests, and code artifacts directly with the VS Code IDE and Project Artifacts.',
    status: 'connected',
    endpointSummary: 'api.github.com/repos/blaize/*',
    scopes: ['repo:read', 'pull_requests:read', 'contents:write_guarded'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-fintech-audit', 'proj-living-desktop'],
    lastSyncAt: '2 mins ago',
  },
  {
    id: 'conn-google-workspace',
    name: 'Google Drive, Docs & Sheets',
    provider: 'Google Workspace',
    category: 'Workspace & Docs',
    description:
      'Exports saved Artifacts to Google Docs/Sheets and reads project specification folders.',
    status: 'connected',
    endpointSummary: 'googleapis.com/drive/v3',
    scopes: ['drive.readonly', 'spreadsheets.currentonly'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-fintech-audit', 'proj-living-desktop'],
    lastSyncAt: '8 mins ago',
  },
  {
    id: 'conn-postgres-ledger',
    name: 'PostgreSQL Analytics Warehouse',
    provider: 'PostgreSQL / Cloud SQL',
    category: 'Database',
    description:
      'Read-only SQL introspection and parameterized DQL queries for financial & telemetry reporting.',
    status: 'connected',
    endpointSummary: 'postgres://readonly@db.blaize.internal:5432/analytics',
    scopes: ['sql:select', 'schema:inspect'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-fintech-audit'],
    lastSyncAt: '5 mins ago',
  },
  {
    id: 'conn-slack-ops',
    name: 'Slack Workspace Channels',
    provider: 'Slack',
    category: 'Messaging',
    description:
      'Posts verified mission digests and requests human-in-the-loop approval for guarded actions.',
    status: 'connected',
    endpointSummary: 'slack.com/api/chat.postMessage (#ops-audit)',
    scopes: ['channels:read', 'chat:write_guarded'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-living-desktop'],
    lastSyncAt: '14 mins ago',
  },
  {
    id: 'conn-mockbank-sandbox',
    name: 'MockBank OpenBanking Sandbox',
    provider: 'MockBank Local',
    category: 'Finance Sandbox',
    description:
      'Sandboxed statement reader and SIMULATION bill draft endpoint enforced by integer-cent PolicyGuard.',
    status: 'connected',
    endpointSummary: 'https://portal.mockbank.local/api/v1',
    scopes: ['statements:read', 'drafts:prepare_only'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-fintech-audit'],
    lastSyncAt: 'Just now',
  },
  {
    id: 'conn-linear-issues',
    name: 'Linear Issue Tracker',
    provider: 'Linear',
    category: 'Workspace & Docs',
    description:
      'Links engineering tasks, bug reports, and roadmap milestones to IDE files and reusable skills.',
    status: 'disconnected',
    endpointSummary: 'api.linear.app/graphql',
    scopes: ['issues:read', 'issues:create_guarded'],
    readAllowed: true,
    writeRequiresApproval: true,
    boundProjectIds: ['proj-living-desktop'],
    lastSyncAt: 'Never',
  },
];

// ============================================================================
// 5. SCHEDULER (Cron + Interval Compiler & PolicyGuard Verification)
// ============================================================================

export const INITIAL_SCHEDULED_TASKS: ScheduledTaskItem[] = [
  {
    id: 'sched-morning-reconcile',
    projectId: 'proj-fintech-audit',
    title: 'Daily 08:30 Statement & Safe-to-Spend Digest',
    naturalSchedule: 'Every weekday at 08:30',
    cronExpression: '30 8 * * 1-5',
    timezone: 'UTC',
    actionPrompt:
      'Run Monthly Bank Statement Reconciler on portal.mockbank.local and update the Safe-to-Spend artifact.',
    linkedSkillId: 'skill-october-reconcile',
    enabled: true,
    nextFiveRuns: [
      '2026-10-29 08:30 UTC',
      '2026-10-30 08:30 UTC',
      '2026-11-02 08:30 UTC',
      '2026-11-03 08:30 UTC',
      '2026-11-04 08:30 UTC',
    ],
    lastRunAt: 'Today 08:30 UTC',
    lastRunStatus: 'verified_ok',
    guardNote: 'Read-only statement verification permitted. Zero money transfers.',
  },
  {
    id: 'sched-nightly-security-audit',
    projectId: 'proj-living-desktop',
    title: 'Nightly 23:00 Repository & Connector Policy Audit',
    naturalSchedule: 'Every day at 23:00',
    cronExpression: '0 23 * * *',
    timezone: 'UTC',
    actionPrompt:
      'Run Trust Kernel Security & Lint Auditor across IDE workspace files and verify hash chain integrity.',
    linkedSkillId: 'skill-pr-security-audit',
    enabled: true,
    nextFiveRuns: [
      '2026-10-29 23:00 UTC',
      '2026-10-30 23:00 UTC',
      '2026-10-31 23:00 UTC',
      '2026-11-01 23:00 UTC',
      '2026-11-02 23:00 UTC',
    ],
    lastRunAt: 'Yesterday 23:00 UTC',
    lastRunStatus: 'verified_ok',
    guardNote: 'Deterministic audit only; emits markdown report artifact.',
  },
];

export function createScheduledTask(input: {
  projectId: string;
  title: string;
  naturalSchedule: string;
  cronExpression?: string;
  timezone?: string;
  actionPrompt: string;
  linkedSkillId?: string;
}): ScheduledTaskItem {
  const cleanTitle = input.title.trim();
  const cleanPrompt = input.actionPrompt.trim();
  if (!cleanTitle || !cleanPrompt) {
    throw new Error('Schedule title and action prompt are required.');
  }

  const lower = `${cleanTitle} ${cleanPrompt}`.toLowerCase();
  const attemptsAutoMoney =
    /\b(auto-pay|autopay|transfer money automatically|send wire without approval|execute payment)\b/i.test(
      lower
    );

  const cron = input.cronExpression?.trim() || '0 9 * * *';
  const tz = input.timezone?.trim() || 'UTC';

  return {
    id: `sched-${Date.now().toString(36)}`,
    projectId: input.projectId,
    title: cleanTitle,
    naturalSchedule: input.naturalSchedule.trim() || 'Every day at 09:00',
    cronExpression: cron,
    timezone: tz,
    actionPrompt: cleanPrompt,
    linkedSkillId: input.linkedSkillId,
    enabled: !attemptsAutoMoney,
    nextFiveRuns: [
      `2026-10-30 09:00 ${tz}`,
      `2026-10-31 09:00 ${tz}`,
      `2026-11-01 09:00 ${tz}`,
      `2026-11-02 09:00 ${tz}`,
      `2026-11-03 09:00 ${tz}`,
    ],
    lastRunStatus: attemptsAutoMoney ? 'blocked_by_guard' : 'idle',
    guardNote: attemptsAutoMoney
      ? 'BLOCKED BY POLICYGUARD: Unattended scheduled tasks cannot execute money transfers without interactive approval.'
      : 'Verified safe for unattended execution under PolicyGuard.',
  };
}

export function formatScheduleRunLocal(utcRun: string): {
  localLabel: string;
  utcLabel: string;
} {
  // Expected format: "2026-10-29 08:30 UTC"
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s+([A-Z]+)$/.exec(utcRun.trim());
  if (!match) {
    return { localLabel: utcRun, utcLabel: utcRun };
  }
  const [, datePart, hourStr, minStr] = match;
  return {
    localLabel: `${datePart} · ${hourStr}:${minStr} Local`,
    utcLabel: utcRun,
  };
}

export function duplicateReusableSkill(skill: ReusableSkill): ReusableSkill {
  const copySlug = `${skill.slug}-copy`;
  return {
    ...skill,
    id: `skill-${copySlug}-${Date.now().toString(36)}`,
    name: `${skill.name} (Copy)`,
    slug: copySlug,
    usageCount: 0,
  };
}

// ============================================================================
// 6. VS CODE IDE & VS CODE MARKETPLACE ADDONS
// ============================================================================

export const INITIAL_IDE_FILES: IdeFileNode[] = [
  {
    id: 'file-safe-to-spend-tsx',
    projectId: 'proj-fintech-audit',
    path: 'src/widgets/SafeToSpendCard.tsx',
    name: 'SafeToSpendCard.tsx',
    language: 'tsx',
    linkedArtifactId: 'art-safe-spend-widget',
    content: `import React, { useState } from 'react';

export interface SafeToSpendProps {
  closingBalanceGhs: number;
  upcomingBillsGhs: number;
  defaultReserveGhs?: number;
}

export function SafeToSpendCard({
  closingBalanceGhs = 2457.5,
  upcomingBillsGhs = 620.0,
  defaultReserveGhs = 800.0,
}: SafeToSpendProps) {
  const [reserveGhs, setReserveGhs] = useState(defaultReserveGhs);
  const safeToSpendGhs = Math.max(0, closingBalanceGhs - upcomingBillsGhs - reserveGhs);

  return (
    <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100">
      <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
        L3xi Verified · Integer-Cent Equation
      </div>
      <h2 className="text-2xl font-bold text-amber-400 mt-1">
        GHS {safeToSpendGhs.toFixed(2)}
      </h2>
      <input
        type="range"
        min={200}
        max={1500}
        step={50}
        value={reserveGhs}
        onChange={(e) => setReserveGhs(Number(e.target.value))}
      />
    </section>
  );
}
`,
  },
  {
    id: 'file-reconcile-ts',
    projectId: 'proj-fintech-audit',
    path: 'src/finance/reconcileLedger.ts',
    name: 'reconcileLedger.ts',
    language: 'typescript',
    content: `/**
 * Deterministic Integer-Cent Statement Reconciler
 */
export interface LedgerSummary {
  openingCents: number;
  creditsCents: number;
  debitsCents: number;
  closingCents: number;
}

export function verifyLedgerBalance(summary: LedgerSummary): {
  valid: boolean;
  expectedClosingCents: number;
  driftCents: number;
} {
  const expectedClosingCents =
    summary.openingCents + summary.creditsCents - summary.debitsCents;
  const driftCents = summary.closingCents - expectedClosingCents;
  return {
    valid: driftCents === 0,
    expectedClosingCents,
    driftCents,
  };
}
`,
  },
  {
    id: 'file-companion-rig-ts',
    projectId: 'proj-living-desktop',
    path: 'src/companion/chairAnchor.ts',
    name: 'chairAnchor.ts',
    language: 'typescript',
    linkedArtifactId: 'art-studio-spec',
    content: `export interface ChairStageAnchor {
  xPercent: number;
  yPx: number;
  posture: 'sit_chair' | 'stand_idle';
  popoutChatOpen: boolean;
}

export function computeTopCenterChairAnchor(isChatPanelOpen: boolean): ChairStageAnchor {
  return {
    xPercent: 50,
    yPx: 148,
    posture: isChatPanelOpen ? 'sit_chair' : 'stand_idle',
    popoutChatOpen: false,
  };
}
`,
  },
  {
    id: 'file-package-json',
    projectId: 'proj-living-desktop',
    path: 'package.json',
    name: 'package.json',
    language: 'json',
    content: `{
  "name": "blaize-workspace-project",
  "version": "3.2.0",
  "private": true,
  "scripts": {
    "dev": "vite --port 3000",
    "test": "tsx --test src/**/*.test.ts",
    "lint": "eslint src --ext .ts,.tsx"
  }
}
`,
  },
];

export const INITIAL_VSCODE_MARKETPLACE_EXTENSIONS: VSCodeMarketplaceExtension[] = [
  {
    id: 'esbenp.prettier-vscode',
    publisher: 'esbenp',
    name: 'prettier-vscode',
    displayName: 'Prettier - Code formatter',
    version: '11.0.0',
    downloads: '48.2M',
    rating: 4.8,
    categories: ['Formatters'],
    description:
      'Code formatter using prettier for TypeScript, JavaScript, React TSX, HTML, CSS, and JSON.',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode',
    installed: true,
    enabled: true,
    readmeSummary:
      'Enforces consistent indentation, semicolons, single quotes, and trailing commas on Format Document (Shift+Alt+F).',
    contributes: {
      formatter: true,
      commands: [{ id: 'editor.action.formatDocument', title: 'Prettier: Format Document' }],
    },
  },
  {
    id: 'dbaeumer.vscode-eslint',
    publisher: 'dbaeumer',
    name: 'vscode-eslint',
    displayName: 'ESLint',
    version: '3.0.10',
    downloads: '39.6M',
    rating: 4.7,
    categories: ['Linters'],
    description:
      'Integrates ESLint JavaScript and TypeScript static analysis and Trust Kernel safety rules into VS Code.',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint',
    installed: true,
    enabled: true,
    readmeSummary:
      'Provides real-time Problems panel diagnostics for unused variables, `any` types, `console.log` leaks, and unguarded network calls.',
    contributes: {
      linter: true,
      commands: [{ id: 'eslint.executeAutofix', title: 'ESLint: Fix all auto-fixable Problems' }],
    },
  },
  {
    id: 'dracula-theme.theme-dracula',
    publisher: 'dracula-theme',
    name: 'theme-dracula',
    displayName: 'Dracula Official Theme',
    version: '2.25.1',
    downloads: '7.9M',
    rating: 4.9,
    categories: ['Themes'],
    description:
      'Official Dracula Theme — high-contrast dark purple & neon syntax theme from the VS Code Marketplace.',
    marketplaceUrl:
      'https://marketplace.visualstudio.com/items?itemName=dracula-theme.theme-dracula',
    installed: false,
    enabled: false,
    readmeSummary:
      'Switches the IDE workbench and code editor color palette to Dracula Pro (#282a36 canvas, #ff79c6 keywords).',
    contributes: {
      editorTheme: 'dracula-pro',
    },
  },
  {
    id: 'github.github-vscode-theme',
    publisher: 'GitHub',
    name: 'github-vscode-theme',
    displayName: 'GitHub Theme',
    version: '6.3.5',
    downloads: '14.4M',
    rating: 4.8,
    categories: ['Themes'],
    description: 'GitHub Dark Dimmed and GitHub Light themes for VS Code.',
    marketplaceUrl:
      'https://marketplace.visualstudio.com/items?itemName=GitHub.github-vscode-theme',
    installed: true,
    enabled: false,
    readmeSummary: 'Applies GitHub Dark Dimmed workbench colors (#1c2128 editor canvas).',
    contributes: {
      editorTheme: 'github-dark-dimmed',
    },
  },
  {
    id: 'ritwickdey.liveserver',
    publisher: 'ritwickdey',
    name: 'liveserver',
    displayName: 'Live Server (Artifact Split Preview)',
    version: '5.7.9',
    downloads: '54.1M',
    rating: 4.8,
    categories: ['Preview'],
    description:
      'Launch a development local Server with live reload feature for static & dynamic pages and Claude-style Artifacts.',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer',
    installed: true,
    enabled: true,
    readmeSummary:
      'Adds a live split-pane HTML/React preview inside the IDE and one-click publishing to Project Artifacts.',
    contributes: {
      livePreview: true,
      commands: [{ id: 'extension.liveServer.goOnline', title: 'Live Server: Open with Live Server' }],
    },
  },
  {
    id: 'dsznajder.es7-react-js-snippets',
    publisher: 'dsznajder',
    name: 'es7-react-js-snippets',
    displayName: 'ES7+ React/Redux/React-Native snippets',
    version: '4.4.3',
    downloads: '13.2M',
    rating: 4.8,
    categories: ['Snippets'],
    description: 'Extensions for React, React-Native and TypeScript in JS/TS with ES7+ syntax.',
    marketplaceUrl:
      'https://marketplace.visualstudio.com/items?itemName=dsznajder.es7-react-js-snippets',
    installed: false,
    enabled: false,
    readmeSummary: 'Adds 1-click React functional component (`rafce`) and hook (`useState`) snippets.',
    contributes: {
      snippets: [
        {
          prefix: 'rafce',
          label: 'React Arrow Function Component Export',
          body: `\nexport const NewWidget: React.FC = () => {\n  return (\n    <div className="p-4 rounded-xl border border-slate-800">\n      New Widget Ready\n    </div>\n  );\n};\n`,
        },
      ],
    },
  },
  {
    id: 'eamodio.gitlens',
    publisher: 'eamodio',
    name: 'gitlens',
    displayName: 'GitLens — Git supercharged',
    version: '15.6.0',
    downloads: '34.8M',
    rating: 4.8,
    categories: ['AI & Productivity'],
    description:
      'Supercharge Git within VS Code — Visualize code authorship at a glance via Git blame annotations and Trust Ledger hashes.',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens',
    installed: true,
    enabled: true,
    readmeSummary:
      'Displays inline authorship & cryptographic ledger verification annotations on every file.',
    contributes: {
      commands: [{ id: 'gitlens.showCommitSearch', title: 'GitLens: Inspect File Blame & Hash' }],
    },
  },
  {
    id: 'bradlc.vscode-tailwindcss',
    publisher: 'bradlc',
    name: 'vscode-tailwindcss',
    displayName: 'Tailwind CSS IntelliSense',
    version: '0.12.8',
    downloads: '22.5M',
    rating: 4.9,
    categories: ['AI & Productivity'],
    description:
      'Intelligent Tailwind CSS tooling for VS Code: autocomplete, syntax highlighting, and linting.',
    marketplaceUrl:
      'https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss',
    installed: false,
    enabled: false,
    readmeSummary: 'Provides utility class previews and responsive breakpoint helpers.',
    contributes: {
      linter: true,
    },
  },
];

export function searchVSCodeMarketplace(
  extensions: VSCodeMarketplaceExtension[],
  query: string,
  categoryFilter: string = 'ALL'
): VSCodeMarketplaceExtension[] {
  const q = query.trim().toLowerCase();
  return extensions.filter((ext) => {
    const matchesCategory =
      categoryFilter === 'ALL' ||
      (categoryFilter === 'INSTALLED' && ext.installed) ||
      ext.categories.includes(categoryFilter as any);
    if (!matchesCategory) return false;
    if (!q) return true;
    return (
      ext.id.toLowerCase().includes(q) ||
      ext.displayName.toLowerCase().includes(q) ||
      ext.description.toLowerCase().includes(q) ||
      ext.publisher.toLowerCase().includes(q)
    );
  });
}

export function formatCodeWithPrettierAddon(code: string): string {
  return code
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

export function insertReactSnippetAddon(code: string, componentName: string = 'NewWidget'): string {
  const snippet = `\nexport const ${componentName}: React.FC = () => {\n  return (\n    <div className="p-4 rounded-xl border border-slate-800">\n      ${componentName} Ready\n    </div>\n  );\n};\n`;
  return `${code.trimEnd()}\n${snippet}`;
}

export interface IdeLintDiagnostic {
  line: number;
  severity: 'warning' | 'error' | 'info';
  ruleId: string;
  message: string;
}

export function analyzeCodeWithESLintAddon(code: string): IdeLintDiagnostic[] {
  const lines = code.split('\n');
  const diagnostics: IdeLintDiagnostic[] = [];

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    if (/\bconsole\.log\(/.test(lineText)) {
      diagnostics.push({
        line: lineNum,
        severity: 'warning',
        ruleId: 'no-console',
        message: 'Unexpected console.log statement; prefer structured Trust Ledger events.',
      });
    }
    if (/:\s*any\b/.test(lineText)) {
      diagnostics.push({
        line: lineNum,
        severity: 'warning',
        ruleId: '@typescript-eslint/no-explicit-any',
        message: 'Unexpected any. Specify a strict TypeScript interface or Zod schema.',
      });
    }
    if (/\beval\(/.test(lineText)) {
      diagnostics.push({
        line: lineNum,
        severity: 'error',
        ruleId: 'trust-kernel/no-eval',
        message: 'PolicyGuard violation: eval() is forbidden in sandboxed workspace modules.',
      });
    }
  });

  return diagnostics;
}
