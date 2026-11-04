# Blaize Plugin Development Guide

## Overview
Blaize plugins extend application capabilities through sandboxed, capability-confined extensions. Every plugin enforces strict capability limits, Zod manifest validation, static code inspection, and PolicyEngine oversight.

---

## Plugin Manifest Schema (`blaize.plugin.manifest.v1`)

```json
{
  "schema": "blaize.plugin.manifest.v1",
  "id": "plugin-custom-tool",
  "name": "Custom Workspace Tool",
  "version": "1.0.0",
  "entryPoint": "index.ts",
  "publisher": "Developer Name",
  "origin": "created_with_morrow",
  "contentHash": "<sha256-hash-of-code>",
  "integrity": {
    "algorithm": "sha256-hmac",
    "signatureHex": "<hmac-signature>",
    "signerId": "blaize-local-host",
    "signedAt": "2026-11-03T18:00:00.000Z"
  },
  "healthCheck": {
    "method": "ping",
    "timeoutMs": 1000,
    "expectedStatus": "ok"
  },
  "testCommand": "npm test",
  "declaredDataScopes": ["workspace"],
  "requestedCapabilities": ["workspace:read"],
  "riskClasses": ["read"],
  "tools": [
    {
      "name": "custom_inspect",
      "description": "Inspects local workspace files",
      "inputSchema": { "path": "string" },
      "outputSchema": { "content": "string" },
      "riskClass": "read",
      "requiredCapabilities": ["workspace:read"]
    }
  ]
}
```

---

## Installation Protocol

1. **Prepare Install (`POST /api/plugins/prepare-install`)**:
   - Validates manifest against Zod schema and static safety checks.
   - Computes capability diff against granted permissions.
   - Issues a server-side, cryptographically random, single-use `approvalNonce`.
2. **Operator Confirmation & Install (`POST /api/plugins/install`)**:
   - Client sends `{ approvalNonce: "nonce_..." }`.
   - Server consumes nonce (preventing replays) and persists plugin configuration to durable SQLite storage.
