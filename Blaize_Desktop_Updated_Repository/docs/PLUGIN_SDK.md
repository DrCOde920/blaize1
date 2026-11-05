# Blaize Plugin SDK & Architecture Guide

Blaize is a general-purpose, accountable AI desktop operating system. Every domain capability (including finance, code analysis, research, music, and browser automation) is implemented as a decoupled, modular plugin conforming to strict security and verification contracts.

Nothing in the Blaize core depends on any specific plugin.

---

## 1. Core Architecture Principles

1. **Domain-Neutral Core**: Core modules (`core`, `trust`, `living`, `runtime`, `workspace`) contain zero domain-specific logic, banking scripts, or hardcoded rules.
2. **Generic Risk Classes**: Every action and tool declares one of 7 standard risk classes:
   - `read`: Read-only queries with zero mutations.
   - `write`: File or workspace modifications within sandboxed boundaries.
   - `destructive`: Irreversible actions (file deletion, database drops) requiring operator approval.
   - `external_send`: Outbound network transmissions, messaging, or emails.
   - `credential`: Secret handling, token access, or authentication elevation.
   - `spend`: Financial transactions, billing, or balance alterations (requires explicit operator confirmation).
   - `system`: OS-level operations, container controls, or sandbox parameters.
3. **Tightening PolicyPacks**: Plugins may ship a `PolicyPack` that adds extra safety constraints (domain allowlists, spend caps, blocked UI selectors, or mandatory approvals). A `PolicyPack` can **only tighten** core rules—it can never relax or bypass core security policies.
4. **Verifier Registry**: Actions cannot be recorded as successful in the tamper-evident ledger without cryptographic or empirical verification. The core provides 6 foundational verifiers:
   - `dom_assertion`: Asserts DOM element presence or text content.
   - `url_check`: Validates final navigation URL matches allowlisted patterns.
   - `file_exists_hash`: Computes SHA-256 hash to prove file contents.
   - `test_suite_pass`: Verifies zero failing tests and exit code 0.
   - `screenshot_check`: Verifies visual page rendered within dimensions.
   - `schedule_preview`: Verifies cron and next scheduled run timestamp.
   Plugins register custom domain verifiers (e.g., L3xi's `numeric_reconciliation`, research's `citation_check`).

---

## 2. Plugin Manifest Specification

A Blaize plugin is declared via a `PluginManifest`:

```typescript
import {
  PluginManifest,
  GenericRiskClass,
  PolicyPack,
  VerifierStrategy,
} from './packages/contracts';

export const MY_PLUGIN_MANIFEST: PluginManifest = {
  id: 'plugin-citation-research',
  name: 'Academic Citation & Fact Verifier',
  version: '1.2.0',
  description: 'Searches scholarly papers, extracts claims, and verifies primary DOI sources.',
  publisher: 'Open Research Guild',
  riskClasses: ['read'],
  permissions: ['browser:active_tab', 'verifier:citation_check'],
  tools: [
    {
      name: 'plugin.research.verify_citation',
      description: 'Checks paper text against extracted DOI and author claims.',
      risk: 'read',
      verifier: 'citation_check',
      inputSchema: {
        doi: 'string',
        claimText: 'string',
        primarySourceUrl: 'string',
      },
      outputSchema: {
        verified: 'boolean',
        matchingPassage: 'string',
        confidenceScore: 'number',
      },
      loadedInContext: true,
    },
  ],
  policyPack: {
    id: 'pack-academic-safety',
    pluginId: 'plugin-citation-research',
    name: 'Academic Research Safety Pack',
    description: 'Enforces HTTPS scholar domains and prevents credential leakage.',
    rules: [
      {
        id: 'rule-academic-domains-only',
        name: 'Scholar Allowlist',
        ruleType: 'domain_allowlist',
        enforcement: 'block',
        description: 'Only navigate to vetted scholarly archives (arxiv.org, doi.org, nature.com).',
        matcher: (target) =>
          target.includes('arxiv.org') ||
          target.includes('doi.org') ||
          target.includes('nature.com'),
      },
    ],
  },
  verifiers: [
    {
      id: 'citation_check',
      name: 'Academic Citation Proof Verifier',
      description: 'Verifies that a citation excerpt verbatim matches source DOI document text.',
      verify: async (context) => {
        const { doi, claimText, primarySourceUrl } = context.actionPayload || {};
        const isMatch = Boolean(doi && claimText && primarySourceUrl);
        return {
          verified: isMatch,
          evidenceHash: `hash-${doi || 'unknown'}`,
          proofFormula: 'SourceText.contains(ClaimText) && DOI.resolves(PrimaryURL)',
          discrepancies: isMatch ? [] : ['DOI claim was not found in source text.'],
          details: { doi, claimText },
        };
      },
    },
  ],
};
```

---

## 3. Registering Custom Verifier Strategies

Plugins register custom verifiers using the global `VerifierRegistry`:

```typescript
import { registerVerifierStrategy, VerifierStrategy } from './packages/trust';

export const CITATION_VERIFIER_STRATEGY: VerifierStrategy = {
  id: 'citation_check',
  name: 'Academic Citation Verifier',
  description: 'Proves citation claims match peer-reviewed source excerpts.',
  verify: async (ctx) => {
    // Return verified status, evidenceHash, proof formula, and any discrepancies
    return {
      verified: true,
      evidenceHash: 'sha256:4a8b...verified',
      proofFormula: 'Claim matched against ArXiv paper abstract',
      discrepancies: [],
    };
  },
};

registerVerifierStrategy(CITATION_VERIFIER_STRATEGY);
```

---

## 4. Permission Review Screen & Marketplace API

When users browse the Marketplace, plugins are discovered via `GET /api/plugins/marketplace`.

Before any plugin can be installed:
1. The user is presented with the **Permission Review Screen**.
2. The modal discloses all requested **Risk Classes** (e.g. `read`, `write`, `spend`).
3. The tightening **PolicyPack Rules** and **Registered Verifiers** are displayed.
4. The operator must confirm: `POST /api/plugins/install` with `{ confirmedByOperator: true }`.
5. The plugin is activated in the sandbox, added to the ledger, and registered with `PolicyGuard`.
