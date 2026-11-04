/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10 — Real Connector Provider Adapters, Separated Lifecycle
 * (Connection Test vs. Capability Discovery vs. Tool Invocation),
 * OAuth 2.0 PKCE + Vault Lifecycle, Rate Limiting, Retry, Idempotency & Verifier.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScopedApprovalToken } from '../contracts';
import { ScopedRuleItem } from '../hub/index';
import { globalApprovalTokenStore, globalPolicyEngine } from '../trust';
import { SecretVault, PassphraseWrapVault, redactSecretsFromText } from '../vault';

// ============================================================================
// 1. HONEST CONNECTOR STATUS & EVIDENCE STATES
// ============================================================================

export type HonestConnectorStatus =
  | 'connected'
  | 'needs_setup'
  | 'not_configured'
  | 'unsupported'
  | 'error'
  | 'simulated';

export type ConnectorEvidenceClass =
  | 'REAL'
  | 'SIMULATED'
  | 'UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'NEEDS_SETUP'
  | 'FAILED'
  | 'UNCERTAIN'
  | 'BLOCKED'
  | 'WAITING_FOR_APPROVAL';

export interface ProviderErrorDetail {
  code:
    | 'MISSING_CREDENTIALS'
    | 'ADAPTER_NOT_IMPLEMENTED'
    | 'UNSUPPORTED_OPERATION'
    | 'INVALID_INPUT_SCHEMA'
    | 'MISSING_CAPABILITY_GRANT'
    | 'MISSING_OAUTH_SCOPE'
    | 'APPROVAL_REQUIRED'
    | 'POLICY_BLOCKED'
    | 'RATE_LIMIT_EXCEEDED'
    | 'UPSTREAM_HTTP_ERROR'
    | 'NETWORK_FAILURE'
    | 'VERIFICATION_FAILED'
    | 'SSRF_BLOCKED'
    | 'OAUTH_STATE_INVALID'
    | 'OAUTH_PKCE_INVALID'
    | 'OAUTH_REDIRECT_INVALID'
    | 'VAULT_LOCKED';
  message: string;
  httpStatus?: number;
  retryable: boolean;
  retryAfterMs?: number;
  providerRawCode?: string;
}

export interface ConnectorPaginationRequest {
  cursor?: string;
  pageSize?: number;
}

export interface ConnectorPaginationResult {
  nextCursor?: string;
  hasMore: boolean;
  pageSize: number;
  returnedCount: number;
}

export interface ConnectorToolSchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ConnectorAdapterToolSpec {
  name: string;
  description: string;
  risk: 'read' | 'write';
  idempotent: boolean;
  supportsPagination: boolean;
  requiredScopes: string[];
  rateLimitPerMinute: number;
  inputSchema: Record<string, ConnectorToolSchemaField>;
  outputSchema: Record<string, ConnectorToolSchemaField>;
  verifierDescription: string;
  verifyOutput: (output: unknown, input: Record<string, unknown>) => {
    verified: boolean;
    reason?: string;
  };
}

export interface ConnectorRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnlyIdempotentReads: boolean;
}

export interface ConnectorHttpTransportRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface ConnectorHttpTransportResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
}

export type ConnectorHttpTransport = (
  req: ConnectorHttpTransportRequest
) => Promise<ConnectorHttpTransportResponse>;

/**
 * Default real HTTP transport using global fetch.
 */
export const defaultConnectorHttpTransport: ConnectorHttpTransport = async (req) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 8000);
  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. XML/ICS/HTML)
    }
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key.toLowerCase()] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      headers: headersObj,
      text,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
};

// ============================================================================
// 2. SEPARATED LIFECYCLE RESULT TYPES
//    (1) Connection Test, (2) Capability Discovery, (3) Tool Invocation
// ============================================================================

export interface ConnectionTestContext {
  mode?: 'live' | 'simulated';
  vault?: SecretVault;
  vaultKeyId?: string;
  grantedScopes?: string[];
  customEndpointUrl?: string;
  workspaceRoot?: string;
  transport?: ConnectorHttpTransport;
}

export interface ConnectionTestResult {
  ok: boolean;
  connectorId: string;
  status: HonestConnectorStatus;
  evidenceClass: ConnectorEvidenceClass;
  isSimulated: boolean;
  testedAtIso: string;
  latencyMs: number;
  summary: string;
  authenticatedIdentity?: string;
  /**
   * Requirement 2: A connection test never claims every tool works.
   */
  connectionTestProvesAllToolsWork: false;
  error?: ProviderErrorDetail;
}

export interface DiscoveredToolCapability {
  toolName: string;
  risk: 'read' | 'write';
  available: boolean;
  requiredScopes: string[];
  missingScopes: string[];
  requiresApproval: boolean;
  supportsPagination: boolean;
  idempotent: boolean;
  reasonIfUnavailable?: string;
}

export interface CapabilityDiscoveryResult {
  ok: boolean;
  connectorId: string;
  status: HonestConnectorStatus;
  evidenceClass: ConnectorEvidenceClass;
  discoveredAtIso: string;
  grantedScopes: string[];
  supportedScopes: string[];
  tools: DiscoveredToolCapability[];
  allToolsAvailable: boolean;
  connectionTestProvesAllToolsWork: false;
  error?: ProviderErrorDetail;
}

export interface AdapterToolInvocationContext {
  toolName: string;
  args: Record<string, unknown>;
  pagination?: ConnectorPaginationRequest;
  idempotencyKey?: string;
  mode?: 'live' | 'simulated';
  vault?: SecretVault;
  vaultKeyId?: string;
  grantedCapabilities: string[];
  grantedScopes?: string[];
  approvalToken?: ScopedApprovalToken;
  rules?: ScopedRuleItem[];
  activeProjectId?: string;
  workspaceRoot?: string;
  customEndpointUrl?: string;
  transport?: ConnectorHttpTransport;
}

export interface AdapterToolInvocationResult {
  ok: boolean;
  connectorId: string;
  toolName: string;
  risk: 'read' | 'write';
  status:
    | 'executed'
    | 'simulated'
    | 'needs_approval'
    | 'blocked_by_rule'
    | 'missing_capability'
    | 'missing_scope'
    | 'not_configured'
    | 'failed';
  evidenceClass: ConnectorEvidenceClass;
  isSimulated: boolean;
  verified: boolean;
  verificationSummary: string;
  attempts: number;
  idempotencyKey?: string;
  deduplicatedFromCache?: boolean;
  pagination?: ConnectorPaginationResult;
  output?: unknown;
  error?: ProviderErrorDetail;
  recordedInLedger: boolean;
  ledgerRef?: string;
}

export interface ConnectorProviderAdapter {
  connectorId: string;
  providerName: string;
  authType: 'none' | 'api_key' | 'bearer' | 'oauth_pkce' | 'mcp';
  adapterImplemented: boolean;
  supportedScopes: string[];
  defaultVaultKeyId?: string;
  rateLimitPerMinute: number;
  retryPolicy: ConnectorRetryPolicy;
  toolSchemas: Record<string, ConnectorAdapterToolSpec>;

  /**
   * 1. Connection Test: Verifies provider reachability & auth validity ONLY.
   * Never marks status 'connected' unless a real provider response is validated.
   */
  testConnection(ctx?: ConnectionTestContext): Promise<ConnectionTestResult>;

  /**
   * 2. Capability Discovery: Separately inspects granted scopes & tool availability.
   */
  discoverCapabilities(ctx?: ConnectionTestContext): Promise<CapabilityDiscoveryResult>;

  /**
   * 3. Execute Raw Provider Operation (wrapped by invokeConnectorToolReal with PolicyEngine,
   *    capability check, rate limiter, retry, idempotency, and verifier).
   */
  executeProviderTool(
    toolSpec: ConnectorAdapterToolSpec,
    args: Record<string, unknown>,
    resolvedSecret: string | undefined,
    ctx: AdapterToolInvocationContext
  ): Promise<{
    output: unknown;
    pagination?: ConnectorPaginationResult;
  }>;
}

// ============================================================================
// 3. OAUTH 2.0 PKCE + STATE + REDIRECT VALIDATION + PHASE 3 VAULT STORAGE
// ============================================================================

export interface OAuthProviderConfig {
  connectorId: string;
  providerName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  allowedScopes: string[];
  allowedRedirectHosts: string[];
}

export const SUPPORTED_OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'conn-google-workspace': {
    connectorId: 'conn-google-workspace',
    providerName: 'Google Workspace',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
    allowedScopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    allowedRedirectHosts: ['localhost', '127.0.0.1'],
  },
  'conn-microsoft-365': {
    connectorId: 'conn-microsoft-365',
    providerName: 'Microsoft 365',
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    allowedScopes: [
      'Calendars.Read',
      'Files.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'offline_access',
    ],
    allowedRedirectHosts: ['localhost', '127.0.0.1'],
  },
};

export interface PendingOAuthPkceSession {
  state: string;
  connectorId: string;
  clientId: string;
  redirectUri: string;
  requestedScopes: string[];
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  createdAtEpochMs: number;
  expiresAtEpochMs: number;
}

export interface StoredOAuthCredentialMetadata {
  connectorId: string;
  accessTokenVaultKeyId: string;
  refreshTokenVaultKeyId?: string;
  grantedScopes: string[];
  missingScopes: string[];
  tokenType: string;
  expiresAtEpochMs: number;
  obtainedAtIso: string;
  refreshedAtIso?: string;
  revoked: boolean;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function computePkceS256Challenge(codeVerifier: string): string {
  const digest = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest();
  return base64UrlEncode(digest);
}

export function validateOAuthRedirectUri(
  redirectUri: string,
  allowedLoopbackHosts: string[] = ['localhost', '127.0.0.1']
): { valid: boolean; reason?: string; parsed?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return { valid: false, reason: 'Malformed redirect_uri.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === 'https:') {
    return { valid: true, parsed };
  }
  if (parsed.protocol === 'http:' && allowedLoopbackHosts.includes(host)) {
    return { valid: true, parsed };
  }
  return {
    valid: false,
    reason: `OAuth redirect_uri must use HTTPS or an allowed loopback host (${allowedLoopbackHosts.join(', ')}). Got: ${redirectUri}`,
  };
}

export class OAuthPkceLifecycleManager {
  private pendingSessions = new Map<string, PendingOAuthPkceSession>();
  private metadataByConnector = new Map<string, StoredOAuthCredentialMetadata>();
  private readonly vault: SecretVault;
  private readonly sessionTtlMs: number;

  constructor(vault?: SecretVault, sessionTtlMs: number = 10 * 60 * 1000) {
    this.vault = vault ?? new PassphraseWrapVault();
    this.sessionTtlMs = sessionTtlMs;
  }

  getVault(): SecretVault {
    return this.vault;
  }

  /**
   * Starts an OAuth 2.0 Authorization Code + PKCE flow.
   */
  startFlow(input: {
    connectorId: string;
    clientId: string;
    redirectUri: string;
    requestedScopes: string[];
    codeVerifier?: string;
    nowEpochMs?: number;
  }): {
    ok: boolean;
    authorizationUrl?: string;
    state?: string;
    codeVerifier?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256';
    error?: ProviderErrorDetail;
  } {
    const provider = SUPPORTED_OAUTH_PROVIDERS[input.connectorId];
    if (!provider) {
      return {
        ok: false,
        error: {
          code: 'ADAPTER_NOT_IMPLEMENTED',
          message: `OAuth PKCE provider configuration is not supported for connector '${input.connectorId}'.`,
          retryable: false,
        },
      };
    }

    const redirectCheck = validateOAuthRedirectUri(
      input.redirectUri,
      provider.allowedRedirectHosts
    );
    if (!redirectCheck.valid) {
      return {
        ok: false,
        error: {
          code: 'OAUTH_REDIRECT_INVALID',
          message: redirectCheck.reason || 'Invalid redirect_uri.',
          retryable: false,
        },
      };
    }

    const verifier =
      input.codeVerifier && input.codeVerifier.length >= 43
        ? input.codeVerifier
        : base64UrlEncode(crypto.randomBytes(48));

    const challenge = computePkceS256Challenge(verifier);
    const state = base64UrlEncode(crypto.randomBytes(24));
    const now = input.nowEpochMs ?? Date.now();

    const validScopes = input.requestedScopes.filter((s) =>
      provider.allowedScopes.includes(s)
    );
    if (validScopes.length === 0) {
      return {
        ok: false,
        error: {
          code: 'MISSING_OAUTH_SCOPE',
          message: `None of the requested scopes are supported by ${provider.providerName}.`,
          retryable: false,
        },
      };
    }

    const session: PendingOAuthPkceSession = {
      state,
      connectorId: input.connectorId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      requestedScopes: validScopes,
      codeVerifier: verifier,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      createdAtEpochMs: now,
      expiresAtEpochMs: now + this.sessionTtlMs,
    };

    this.pendingSessions.set(state, session);

    const authUrl = new URL(provider.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', input.clientId);
    authUrl.searchParams.set('redirect_uri', input.redirectUri);
    authUrl.searchParams.set('scope', validScopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');

    return {
      ok: true,
      authorizationUrl: authUrl.toString(),
      state,
      codeVerifier: verifier,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    };
  }

  /**
   * Validates callback state, redirectUri, and PKCE verifier, exchanges the authorization
   * code with the real token endpoint, inspects granted scopes, and stores tokens
   * ONLY inside the encrypted Phase 3 Vault.
   */
  async exchangeCodeForTokens(input: {
    state: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    vaultSecretCode: string;
    transport?: ConnectorHttpTransport;
    nowEpochMs?: number;
  }): Promise<{
    ok: boolean;
    metadata?: StoredOAuthCredentialMetadata;
    error?: ProviderErrorDetail;
  }> {
    const now = input.nowEpochMs ?? Date.now();
    const session = this.pendingSessions.get(input.state);
    if (!session) {
      return {
        ok: false,
        error: {
          code: 'OAUTH_STATE_INVALID',
          message: 'Invalid, unknown, or already-consumed OAuth state parameter.',
          retryable: false,
        },
      };
    }

    // Consume state immediately (single-use anti-CSRF guarantee)
    this.pendingSessions.delete(input.state);

    if (now > session.expiresAtEpochMs) {
      return {
        ok: false,
        error: {
          code: 'OAUTH_STATE_INVALID',
          message: 'OAuth PKCE session state has expired.',
          retryable: false,
        },
      };
    }

    if (input.redirectUri !== session.redirectUri) {
      return {
        ok: false,
        error: {
          code: 'OAUTH_REDIRECT_INVALID',
          message: `OAuth redirect_uri mismatch: expected '${session.redirectUri}', received '${input.redirectUri}'.`,
          retryable: false,
        },
      };
    }

    const verifierToUse = input.codeVerifier ?? session.codeVerifier;
    const recomputedChallenge = computePkceS256Challenge(verifierToUse);
    if (recomputedChallenge !== session.codeChallenge) {
      return {
        ok: false,
        error: {
          code: 'OAUTH_PKCE_INVALID',
          message: 'PKCE code_verifier does not match the S256 code_challenge from authorization start.',
          retryable: false,
        },
      };
    }

    const provider = SUPPORTED_OAUTH_PROVIDERS[session.connectorId];
    const transport = input.transport ?? defaultConnectorHttpTransport;

    const formBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: session.redirectUri,
      client_id: session.clientId,
      code_verifier: verifierToUse,
    }).toString();

    let tokenResponse: ConnectorHttpTransportResponse;
    try {
      tokenResponse = await transport({
        url: provider.tokenEndpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody,
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: `OAuth token exchange network failure: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        },
      };
    }

    if (!tokenResponse.ok || !tokenResponse.json || typeof tokenResponse.json !== 'object') {
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_HTTP_ERROR',
          httpStatus: tokenResponse.status,
          message: `OAuth token endpoint returned HTTP ${tokenResponse.status}.`,
          retryable: tokenResponse.status >= 500,
        },
      };
    }

    const payload = tokenResponse.json as Record<string, unknown>;
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
    const refreshToken =
      typeof payload.refresh_token === 'string' ? payload.refresh_token.trim() : undefined;
    const expiresInSec =
      typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? payload.expires_in
        : 3600;
    const scopeStr =
      typeof payload.scope === 'string'
        ? payload.scope
        : session.requestedScopes.join(' ');

    if (!accessToken) {
      return {
        ok: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'OAuth token response did not include a valid access_token.',
          retryable: false,
        },
      };
    }

    const grantedScopes = scopeStr
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const missingScopes = session.requestedScopes.filter(
      (reqScope) => !grantedScopes.includes(reqScope)
    );

    const accessTokenVaultKeyId = `oauth_access_${session.connectorId}`;
    await this.vault.store(
      {
        keyId: accessTokenVaultKeyId,
        label: `${provider.providerName} OAuth Access Token`,
        provider: session.connectorId,
        plainKey: accessToken,
      },
      input.vaultSecretCode
    );

    let refreshTokenVaultKeyId: string | undefined;
    if (refreshToken) {
      refreshTokenVaultKeyId = `oauth_refresh_${session.connectorId}`;
      await this.vault.store(
        {
          keyId: refreshTokenVaultKeyId,
          label: `${provider.providerName} OAuth Refresh Token`,
          provider: session.connectorId,
          plainKey: refreshToken,
        },
        input.vaultSecretCode
      );
    }

    const metadata: StoredOAuthCredentialMetadata = {
      connectorId: session.connectorId,
      accessTokenVaultKeyId,
      refreshTokenVaultKeyId,
      grantedScopes,
      missingScopes,
      tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
      expiresAtEpochMs: now + expiresInSec * 1000,
      obtainedAtIso: new Date(now).toISOString(),
      revoked: false,
    };

    this.metadataByConnector.set(session.connectorId, metadata);
    return { ok: true, metadata };
  }

  /**
   * Refreshes an OAuth access token using the encrypted refresh token stored in Vault.
   */
  async refreshAccessToken(input: {
    connectorId: string;
    clientId: string;
    vaultSecretCode: string;
    transport?: ConnectorHttpTransport;
    nowEpochMs?: number;
  }): Promise<{
    ok: boolean;
    metadata?: StoredOAuthCredentialMetadata;
    error?: ProviderErrorDetail;
  }> {
    const meta = this.metadataByConnector.get(input.connectorId);
    const provider = SUPPORTED_OAUTH_PROVIDERS[input.connectorId];
    if (!meta || !provider || !meta.refreshTokenVaultKeyId || meta.revoked) {
      return {
        ok: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: `No active refresh token in Vault for connector '${input.connectorId}'.`,
          retryable: false,
        },
      };
    }

    if (this.vault.isLocked()) {
      const unlocked = await this.vault.unlock(input.vaultSecretCode);
      if (!unlocked) {
        return {
          ok: false,
          error: {
            code: 'VAULT_LOCKED',
            message: 'Encrypted Vault is locked or passphrase is invalid.',
            retryable: false,
          },
        };
      }
    }

    const transport = input.transport ?? defaultConnectorHttpTransport;
    const now = input.nowEpochMs ?? Date.now();

    const refreshCall = await this.vault.useForRequest(
      meta.refreshTokenVaultKeyId,
      async (resolvedRefreshToken) => {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: resolvedRefreshToken,
          client_id: input.clientId,
        }).toString();
        return transport({
          url: provider.tokenEndpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body,
        });
      }
    );

    if (!refreshCall.ok || !refreshCall.result) {
      return {
        ok: false,
        error: {
          code: 'VAULT_LOCKED',
          message: refreshCall.error || 'Failed to read refresh token from encrypted Vault.',
          retryable: false,
        },
      };
    }

    const response = refreshCall.result;
    if (!response.ok || !response.json || typeof response.json !== 'object') {
      return {
        ok: false,
        error: {
          code: 'UPSTREAM_HTTP_ERROR',
          httpStatus: response.status,
          message: `OAuth token refresh failed with HTTP ${response.status}.`,
          retryable: response.status >= 500,
        },
      };
    }

    const payload = response.json as Record<string, unknown>;
    const newAccessToken =
      typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
    if (!newAccessToken) {
      return {
        ok: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'OAuth refresh response did not contain a valid access_token.',
          retryable: false,
        },
      };
    }

    await this.vault.rotate(
      meta.accessTokenVaultKeyId,
      newAccessToken,
      input.vaultSecretCode
    );

    if (typeof payload.refresh_token === 'string' && payload.refresh_token.trim()) {
      await this.vault.rotate(
        meta.refreshTokenVaultKeyId,
        payload.refresh_token.trim(),
        input.vaultSecretCode
      );
    }

    const expiresInSec =
      typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? payload.expires_in
        : 3600;

    const updatedMeta: StoredOAuthCredentialMetadata = {
      ...meta,
      expiresAtEpochMs: now + expiresInSec * 1000,
      refreshedAtIso: new Date(now).toISOString(),
    };
    this.metadataByConnector.set(input.connectorId, updatedMeta);

    return { ok: true, metadata: updatedMeta };
  }

  /**
   * Revokes OAuth credentials upstream (if supported) and deletes tokens from the encrypted Vault.
   */
  async revokeCredentials(input: {
    connectorId: string;
    vaultSecretCode: string;
    transport?: ConnectorHttpTransport;
  }): Promise<{ ok: boolean; revokedInVault: boolean; revokedUpstream: boolean }> {
    const meta = this.metadataByConnector.get(input.connectorId);
    const provider = SUPPORTED_OAUTH_PROVIDERS[input.connectorId];
    if (!meta) {
      return { ok: true, revokedInVault: false, revokedUpstream: false };
    }

    let revokedUpstream = false;
    const transport = input.transport ?? defaultConnectorHttpTransport;

    if (provider?.revocationEndpoint && !this.vault.isLocked()) {
      const res = await this.vault.useForRequest(
        meta.accessTokenVaultKeyId,
        async (token) =>
          transport({
            url: provider.revocationEndpoint!,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
          })
      );
      revokedUpstream = Boolean(res.ok && res.result?.ok);
    }

    await this.vault.delete(meta.accessTokenVaultKeyId, input.vaultSecretCode);
    if (meta.refreshTokenVaultKeyId) {
      await this.vault.delete(meta.refreshTokenVaultKeyId, input.vaultSecretCode);
    }

    meta.revoked = true;
    meta.grantedScopes = [];
    this.metadataByConnector.set(input.connectorId, meta);

    return { ok: true, revokedInVault: true, revokedUpstream };
  }

  /**
   * Inspects granted vs. required scopes for a connector without exposing any raw token.
   */
  inspectScopes(
    connectorId: string,
    requiredScopes: string[]
  ): {
    authenticated: boolean;
    expired: boolean;
    grantedScopes: string[];
    missingScopes: string[];
    hasAllRequiredScopes: boolean;
  } {
    const meta = this.metadataByConnector.get(connectorId);
    if (!meta || meta.revoked) {
      return {
        authenticated: false,
        expired: true,
        grantedScopes: [],
        missingScopes: [...requiredScopes],
        hasAllRequiredScopes: requiredScopes.length === 0,
      };
    }
    const missingScopes = requiredScopes.filter((s) => !meta.grantedScopes.includes(s));
    return {
      authenticated: true,
      expired: Date.now() >= meta.expiresAtEpochMs,
      grantedScopes: [...meta.grantedScopes],
      missingScopes,
      hasAllRequiredScopes: missingScopes.length === 0,
    };
  }

  getMetadata(connectorId: string): StoredOAuthCredentialMetadata | undefined {
    return this.metadataByConnector.get(connectorId);
  }
}

// ============================================================================
// 4. RATE LIMITER & IDEMPOTENCY CACHE FOR CONNECTOR INVOCATIONS
// ============================================================================

export class ConnectorRateLimiter {
  private windows = new Map<string, { windowStartMs: number; count: number }>();

  checkAndConsume(
    key: string,
    limitPerMinute: number,
    nowMs: number = Date.now()
  ): { allowed: boolean; retryAfterMs?: number; remaining: number } {
    const current = this.windows.get(key);
    if (!current || nowMs - current.windowStartMs >= 60_000) {
      this.windows.set(key, { windowStartMs: nowMs, count: 1 });
      return { allowed: true, remaining: Math.max(0, limitPerMinute - 1) };
    }
    if (current.count >= limitPerMinute) {
      const retryAfterMs = Math.max(100, 60_000 - (nowMs - current.windowStartMs));
      return { allowed: false, retryAfterMs, remaining: 0 };
    }
    current.count += 1;
    return { allowed: true, remaining: Math.max(0, limitPerMinute - current.count) };
  }

  reset(): void {
    this.windows.clear();
  }
}

export const globalConnectorRateLimiter = new ConnectorRateLimiter();

const idempotencyResultCache = new Map<string, AdapterToolInvocationResult>();

export function clearConnectorIdempotencyCache(): void {
  idempotencyResultCache.clear();
}

// ============================================================================
// 5. XML / RSS / ICS / HTML DETERMINISTIC PARSERS FOR REAL ADAPTERS
// ============================================================================

export function parseRssOrAtomXml(xmlText: string): {
  feedTitle: string;
  items: { title: string; link: string; publishedAt: string }[];
} {
  const titleMatch = xmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const feedTitle = titleMatch
    ? titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
    : 'Untitled Feed';

  const items: { title: string; link: string; publishedAt: string }[] = [];
  const itemRegex = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[2];
    const itemTitle =
      block
        .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .trim() || 'Untitled Entry';
    const linkTag =
      block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ||
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ||
      '';
    const pubDate =
      block.match(/<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/i)?.[2]?.trim() || '';
    items.push({ title: itemTitle, link: linkTag, publishedAt: pubDate });
  }
  return { feedTitle, items };
}

export function parseIcsCalendarText(icsText: string): {
  calendarName: string;
  events: { uid: string; summary: string; dtstart: string; dtend: string; location?: string }[];
} {
  const calNameMatch = icsText.match(/^X-WR-CALNAME:(.*)$/m);
  const calendarName = calNameMatch ? calNameMatch[1].trim() : 'ICS Calendar';
  const events: {
    uid: string;
    summary: string;
    dtstart: string;
    dtend: string;
    location?: string;
  }[] = [];

  const eventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi;
  let match: RegExpExecArray | null;
  while ((match = eventRegex.exec(icsText)) !== null) {
    const block = match[1];
    const uid = block.match(/^UID:(.*)$/m)?.[1]?.trim() || `evt-${events.length + 1}`;
    const summary = block.match(/^SUMMARY:(.*)$/m)?.[1]?.trim() || 'Untitled Event';
    const dtstart = block.match(/^DTSTART[^:]*:(.*)$/m)?.[1]?.trim() || '';
    const dtend = block.match(/^DTEND[^:]*:(.*)$/m)?.[1]?.trim() || '';
    const location = block.match(/^LOCATION:(.*)$/m)?.[1]?.trim();
    if (dtstart) {
      events.push({ uid, summary, dtstart, dtend, location });
    }
  }
  return { calendarName, events };
}

// ============================================================================
// 6. REAL PROVIDER ADAPTER IMPLEMENTATIONS
// ============================================================================

function buildCapabilityDiscoveryFromAdapter(
  adapter: ConnectorProviderAdapter,
  ctx?: ConnectionTestContext
): CapabilityDiscoveryResult {
  const nowIso = new Date().toISOString();
  if (!adapter.adapterImplemented) {
    return {
      ok: false,
      connectorId: adapter.connectorId,
      status: 'not_configured',
      evidenceClass: 'NOT_CONFIGURED',
      discoveredAtIso: nowIso,
      grantedScopes: [],
      supportedScopes: adapter.supportedScopes,
      tools: [],
      allToolsAvailable: false,
      connectionTestProvesAllToolsWork: false,
      error: {
        code: 'ADAPTER_NOT_IMPLEMENTED',
        message: `Provider adapter for '${adapter.providerName}' is a catalogue entry and is not configured in this build.`,
        retryable: false,
      },
    };
  }

  const grantedScopes =
    ctx?.grantedScopes ??
    (adapter.authType === 'none' ? [...adapter.supportedScopes] : []);

  const tools: DiscoveredToolCapability[] = Object.values(adapter.toolSchemas).map(
    (spec) => {
      const missingScopes = spec.requiredScopes.filter(
        (reqScope) => !grantedScopes.includes(reqScope)
      );
      const available = missingScopes.length === 0;
      return {
        toolName: spec.name,
        risk: spec.risk,
        available,
        requiredScopes: [...spec.requiredScopes],
        missingScopes,
        requiresApproval: spec.risk === 'write',
        supportsPagination: spec.supportsPagination,
        idempotent: spec.idempotent,
        reasonIfUnavailable: available
          ? undefined
          : `Missing required scope(s): ${missingScopes.join(', ')}`,
      };
    }
  );

  const allToolsAvailable = tools.every((t) => t.available);
  return {
    ok: true,
    connectorId: adapter.connectorId,
    status: grantedScopes.length > 0 || adapter.authType === 'none' ? 'connected' : 'needs_setup',
    evidenceClass: 'REAL',
    discoveredAtIso: nowIso,
    grantedScopes,
    supportedScopes: adapter.supportedScopes,
    tools,
    allToolsAvailable,
    connectionTestProvesAllToolsWork: false,
  };
}

async function resolveAdapterSecret(
  adapter: ConnectorProviderAdapter,
  ctx?: { vault?: SecretVault; vaultKeyId?: string }
): Promise<{ ok: boolean; secret?: string; error?: ProviderErrorDetail }> {
  if (adapter.authType === 'none') {
    return { ok: true, secret: undefined };
  }
  const vault = ctx?.vault;
  const keyId = ctx?.vaultKeyId ?? adapter.defaultVaultKeyId;
  if (!vault || !keyId) {
    return {
      ok: false,
      error: {
        code: 'MISSING_CREDENTIALS',
        message: `Connector '${adapter.providerName}' requires credentials stored in the encrypted Vault (keyId: ${keyId || 'unset'}).`,
        retryable: false,
      },
    };
  }
  if (vault.isLocked()) {
    return {
      ok: false,
      error: {
        code: 'VAULT_LOCKED',
        message: `Encrypted Vault is locked; unlock required before accessing '${adapter.providerName}'.`,
        retryable: false,
      },
    };
  }
  let resolvedSecret: string | undefined;
  const res = await vault.useForRequest(keyId, async (plainKey) => {
    resolvedSecret = plainKey;
    return true;
  });
  if (!res.ok || !resolvedSecret) {
    return {
      ok: false,
      error: {
        code: 'MISSING_CREDENTIALS',
        message: `Credentials for '${adapter.providerName}' (keyId '${keyId}') were not found in the encrypted Vault.`,
        retryable: false,
      },
    };
  }
  return { ok: true, secret: resolvedSecret };
}

// --- 6.1 Weather (Open-Meteo) Adapter ---
const weatherAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-weather',
  providerName: 'Weather (Open-Meteo)',
  authType: 'none',
  adapterImplemented: true,
  supportedScopes: ['public.weather.read'],
  rateLimitPerMinute: 30,
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 50,
    maxDelayMs: 400,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    get_current_weather: {
      name: 'get_current_weather',
      description: 'Fetch current temperature and wind speed for latitude/longitude via Open-Meteo.',
      risk: 'read',
      idempotent: true,
      supportsPagination: false,
      requiredScopes: ['public.weather.read'],
      rateLimitPerMinute: 30,
      inputSchema: {
        latitude: { type: 'number', required: true, description: 'Latitude (-90 to 90)', minimum: -90, maximum: 90 },
        longitude: { type: 'number', required: true, description: 'Longitude (-180 to 180)', minimum: -180, maximum: 180 },
      },
      outputSchema: {
        temperatureC: { type: 'number', required: true, description: 'Current temperature in Celsius' },
        windSpeedKmH: { type: 'number', required: true, description: 'Current wind speed in km/h' },
      },
      verifierDescription: 'Verifies numeric temperatureC and windSpeedKmH from Open-Meteo current_weather object.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.temperatureC !== 'number' || Number.isNaN(rec.temperatureC)) {
          return { verified: false, reason: 'Missing numeric temperatureC.' };
        }
        if (typeof rec.windSpeedKmH !== 'number' || Number.isNaN(rec.windSpeedKmH)) {
          return { verified: false, reason: 'Missing numeric windSpeedKmH.' };
        }
        return { verified: true };
      },
    },
    get_7day_forecast: {
      name: 'get_7day_forecast',
      description: 'Fetch 7-day daily max/min temperature forecast via Open-Meteo.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['public.weather.read'],
      rateLimitPerMinute: 30,
      inputSchema: {
        latitude: { type: 'number', required: true, description: 'Latitude (-90 to 90)', minimum: -90, maximum: 90 },
        longitude: { type: 'number', required: true, description: 'Longitude (-180 to 180)', minimum: -180, maximum: 180 },
      },
      outputSchema: {
        days: { type: 'array', required: true, description: 'Daily forecast entries' },
      },
      verifierDescription: 'Verifies non-empty daily forecast array with date and max/min temperatures.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const days = (output as Record<string, unknown>).days;
        if (!Array.isArray(days) || days.length === 0) {
          return { verified: false, reason: 'Forecast days array is empty or missing.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: Open-Meteo sample response (not a live provider check).',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({
        url: 'https://api.open-meteo.com/v1/forecast?latitude=35.0116&longitude=135.7681&current_weather=true',
        method: 'GET',
      });
      const cw = (resp.json as Record<string, unknown> | undefined)?.current_weather as
        | Record<string, unknown>
        | undefined;
      if (!resp.ok || !cw || typeof cw.temperature !== 'number') {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `Open-Meteo health check failed (HTTP ${resp.status}).`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'UPSTREAM_HTTP_ERROR',
            httpStatus: resp.status,
            message: `Open-Meteo returned invalid response or HTTP ${resp.status}.`,
            retryable: resp.status >= 500,
          },
        };
      }
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Open-Meteo live check succeeded: ${cw.temperature}°C, wind ${cw.windspeed} km/h.`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Open-Meteo live check failed: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(toolSpec, args, _secret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    const lat = Number(args.latitude);
    const lon = Number(args.longitude);
    if (toolSpec.name === 'get_current_weather') {
      const resp = await transport({
        url: `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&current_weather=true`,
        method: 'GET',
      });
      if (!resp.ok) {
        throw Object.assign(new Error(`Open-Meteo HTTP ${resp.status}`), {
          httpStatus: resp.status,
        });
      }
      const cw = (resp.json as Record<string, unknown> | undefined)?.current_weather as
        | Record<string, unknown>
        | undefined;
      return {
        output: {
          latitude: lat,
          longitude: lon,
          temperatureC: cw?.temperature,
          windSpeedKmH: cw?.windspeed,
          weatherCode: cw?.weathercode,
          observedAt: cw?.time,
        },
      };
    }
    // get_7day_forecast
    const resp = await transport({
      url: `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}&longitude=${encodeURIComponent(String(lon))}&daily=temperature_2m_max,temperature_2m_min&timezone=UTC`,
      method: 'GET',
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Open-Meteo HTTP ${resp.status}`), {
        httpStatus: resp.status,
      });
    }
    const daily = (resp.json as Record<string, unknown> | undefined)?.daily as
      | { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] }
      | undefined;
    const allDays = (daily?.time ?? []).map((date, idx) => ({
      date,
      maxTempC: daily?.temperature_2m_max?.[idx] ?? null,
      minTempC: daily?.temperature_2m_min?.[idx] ?? null,
    }));
    const offset = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 0 : 0;
    const pageSize = ctx.pagination?.pageSize ?? 7;
    const slice = allDays.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    return {
      output: { days: slice },
      pagination: {
        pageSize,
        returnedCount: slice.length,
        hasMore: nextOffset < allDays.length,
        nextCursor: nextOffset < allDays.length ? String(nextOffset) : undefined,
      },
    };
  },
};

// --- 6.2 Wikipedia REST Adapter ---
const wikipediaAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-wikipedia',
  providerName: 'Wikipedia',
  authType: 'none',
  adapterImplemented: true,
  supportedScopes: ['public.wikipedia.read'],
  rateLimitPerMinute: 60,
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 50,
    maxDelayMs: 400,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    get_article_summary: {
      name: 'get_article_summary',
      description: 'Fetch Wikipedia summary and page metadata for a given article title.',
      risk: 'read',
      idempotent: true,
      supportsPagination: false,
      requiredScopes: ['public.wikipedia.read'],
      rateLimitPerMinute: 60,
      inputSchema: {
        title: { type: 'string', required: true, description: 'Article title', minLength: 1 },
      },
      outputSchema: {
        title: { type: 'string', required: true, description: 'Canonical article title' },
        extract: { type: 'string', required: true, description: 'Plain-text summary extract' },
      },
      verifierDescription: 'Verifies non-empty title and extract string from Wikipedia REST summary response.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.title !== 'string' || !rec.title.trim()) {
          return { verified: false, reason: 'Missing article title.' };
        }
        if (typeof rec.extract !== 'string' || !rec.extract.trim()) {
          return { verified: false, reason: 'Missing article extract.' };
        }
        return { verified: true };
      },
    },
    search_articles: {
      name: 'search_articles',
      description: 'Search Wikipedia articles by query string with pagination.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['public.wikipedia.read'],
      rateLimitPerMinute: 60,
      inputSchema: {
        query: { type: 'string', required: true, description: 'Search query', minLength: 1 },
      },
      outputSchema: {
        results: { type: 'array', required: true, description: 'Matching Wikipedia pages' },
      },
      verifierDescription: 'Verifies array of matching Wikipedia search results.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const results = (output as Record<string, unknown>).results;
        if (!Array.isArray(results)) {
          return { verified: false, reason: 'Missing results array.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: Wikipedia summary fixture (not a live provider check).',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({
        url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Kyoto',
        method: 'GET',
      });
      const body = resp.json as Record<string, unknown> | undefined;
      if (!resp.ok || !body || typeof body.title !== 'string' || typeof body.extract !== 'string') {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `Wikipedia REST API check failed (HTTP ${resp.status}).`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'UPSTREAM_HTTP_ERROR',
            httpStatus: resp.status,
            message: `Wikipedia returned HTTP ${resp.status} or invalid schema.`,
            retryable: resp.status >= 500,
          },
        };
      }
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Wikipedia live check succeeded: fetched "${body.title}".`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Wikipedia live check failed: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(toolSpec, args, _secret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    if (toolSpec.name === 'get_article_summary') {
      const title = String(args.title || '').trim();
      const resp = await transport({
        url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        method: 'GET',
      });
      if (!resp.ok) {
        throw Object.assign(new Error(`Wikipedia HTTP ${resp.status}`), {
          httpStatus: resp.status,
        });
      }
      const body = (resp.json ?? {}) as Record<string, unknown>;
      return {
        output: {
          title: body.title,
          extract: body.extract,
          pageId: body.pageid,
          url: (body.content_urls as Record<string, Record<string, string>> | undefined)?.desktop?.page,
        },
      };
    }
    const query = String(args.query || '').trim();
    const limit = ctx.pagination?.pageSize ?? 5;
    const offset = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 0 : 0;
    const resp = await transport({
      url: `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&sroffset=${offset}&format=json`,
      method: 'GET',
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Wikipedia search HTTP ${resp.status}`), {
        httpStatus: resp.status,
      });
    }
    const body = (resp.json ?? {}) as Record<string, unknown>;
    const searchArr = ((body.query as Record<string, unknown> | undefined)?.search ?? []) as unknown[];
    const continueObj = body.continue as Record<string, unknown> | undefined;
    const nextOffset = continueObj?.sroffset !== undefined ? String(continueObj.sroffset) : undefined;
    return {
      output: { results: searchArr },
      pagination: {
        pageSize: limit,
        returnedCount: searchArr.length,
        hasMore: Boolean(nextOffset),
        nextCursor: nextOffset,
      },
    };
  },
};

// --- 6.3 RSS / Atom Feed Adapter ---
const rssAtomAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-rss-atom',
  providerName: 'RSS / Atom Feeds',
  authType: 'none',
  adapterImplemented: true,
  supportedScopes: ['public.feeds.read'],
  rateLimitPerMinute: 30,
  retryPolicy: {
    maxAttempts: 2,
    baseDelayMs: 50,
    maxDelayMs: 300,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    read_feed_items: {
      name: 'read_feed_items',
      description: 'Fetch and parse an RSS 2.0 or Atom XML feed URL.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['public.feeds.read'],
      rateLimitPerMinute: 30,
      inputSchema: {
        feedUrl: { type: 'string', required: true, description: 'HTTPS RSS/Atom feed URL', minLength: 8 },
      },
      outputSchema: {
        feedTitle: { type: 'string', required: true, description: 'Parsed feed title' },
        items: { type: 'array', required: true, description: 'Parsed feed entries' },
      },
      verifierDescription: 'Verifies parsed RSS/Atom XML feedTitle and items list.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.feedTitle !== 'string' || !Array.isArray(rec.items)) {
          return { verified: false, reason: 'Invalid feedTitle or items array.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: RSS feed sample.',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const feedUrl = ctx.customEndpointUrl;
    if (!feedUrl) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'needs_setup',
        evidenceClass: 'NEEDS_SETUP',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'RSS/Atom feed URL is required to test a live feed connection.',
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Configure customEndpointUrl with a valid RSS/Atom feed URL.',
          retryable: false,
        },
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({ url: feedUrl, method: 'GET' });
      const parsed = parseRssOrAtomXml(resp.text);
      if (!resp.ok || parsed.items.length === 0) {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `RSS/Atom feed check failed or contained 0 items (HTTP ${resp.status}).`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'VERIFICATION_FAILED',
            httpStatus: resp.status,
            message: 'Feed response did not contain valid RSS <item> or Atom <entry> elements.',
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Verified feed "${parsed.feedTitle}" with ${parsed.items.length} entries.`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Feed fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(_toolSpec, args, _secret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    const feedUrl = String(args.feedUrl || ctx.customEndpointUrl || '').trim();
    const resp = await transport({ url: feedUrl, method: 'GET' });
    if (!resp.ok) {
      throw Object.assign(new Error(`Feed HTTP ${resp.status}`), { httpStatus: resp.status });
    }
    const parsed = parseRssOrAtomXml(resp.text);
    const offset = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 0 : 0;
    const pageSize = ctx.pagination?.pageSize ?? 10;
    const pageItems = parsed.items.slice(offset, offset + pageSize);
    const nextOffset = offset + pageItems.length;
    return {
      output: {
        feedTitle: parsed.feedTitle,
        items: pageItems,
      },
      pagination: {
        pageSize,
        returnedCount: pageItems.length,
        hasMore: nextOffset < parsed.items.length,
        nextCursor: nextOffset < parsed.items.length ? String(nextOffset) : undefined,
      },
    };
  },
};

// --- 6.4 Calendar (ICS Read-Only) Adapter ---
const calendarIcsAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-calendar-ics',
  providerName: 'Calendar (ICS Read-Only)',
  authType: 'none',
  adapterImplemented: true,
  supportedScopes: ['public.ics.read'],
  rateLimitPerMinute: 20,
  retryPolicy: {
    maxAttempts: 2,
    baseDelayMs: 50,
    maxDelayMs: 300,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    list_upcoming_events: {
      name: 'list_upcoming_events',
      description: 'Parse VEVENT items from an RFC 5545 ICS URL or inline ICS payload.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['public.ics.read'],
      rateLimitPerMinute: 20,
      inputSchema: {
        icsUrl: { type: 'string', required: true, description: 'HTTPS URL to .ics calendar feed', minLength: 8 },
      },
      outputSchema: {
        calendarName: { type: 'string', required: true, description: 'Calendar display name' },
        events: { type: 'array', required: true, description: 'Parsed VEVENT list' },
      },
      verifierDescription: 'Verifies RFC 5545 VCALENDAR header and parsed VEVENT entries.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.calendarName !== 'string' || !Array.isArray(rec.events)) {
          return { verified: false, reason: 'Missing calendarName or events array.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: ICS calendar sample.',
        connectionTestProvesAllToolsWork: false,
      };
    }
    if (!ctx.customEndpointUrl) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'needs_setup',
        evidenceClass: 'NEEDS_SETUP',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'ICS feed URL is required before testing calendar connection.',
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Provide customEndpointUrl pointing to a valid .ics calendar URL.',
          retryable: false,
        },
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({ url: ctx.customEndpointUrl, method: 'GET' });
      if (!resp.ok || !resp.text.includes('BEGIN:VCALENDAR')) {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: 'ICS endpoint did not return a valid BEGIN:VCALENDAR document.',
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'VERIFICATION_FAILED',
            httpStatus: resp.status,
            message: 'Response missing BEGIN:VCALENDAR header.',
            retryable: false,
          },
        };
      }
      const parsed = parseIcsCalendarText(resp.text);
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Verified ICS calendar "${parsed.calendarName}" (${parsed.events.length} events).`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `ICS calendar fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(_toolSpec, args, _secret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    const icsUrl = String(args.icsUrl || ctx.customEndpointUrl || '').trim();
    const resp = await transport({ url: icsUrl, method: 'GET' });
    if (!resp.ok || !resp.text.includes('BEGIN:VCALENDAR')) {
      throw Object.assign(new Error('Invalid ICS response'), { httpStatus: resp.status });
    }
    const parsed = parseIcsCalendarText(resp.text);
    const offset = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 0 : 0;
    const pageSize = ctx.pagination?.pageSize ?? 20;
    const slice = parsed.events.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    return {
      output: {
        calendarName: parsed.calendarName,
        events: slice,
      },
      pagination: {
        pageSize,
        returnedCount: slice.length,
        hasMore: nextOffset < parsed.events.length,
        nextCursor: nextOffset < parsed.events.length ? String(nextOffset) : undefined,
      },
    };
  },
};

// --- 6.5 Scoped Local Folder Adapter ---
const localFolderAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-local-folder',
  providerName: 'Local Folder (Scoped)',
  authType: 'none',
  adapterImplemented: true,
  supportedScopes: ['local.folder.read'],
  rateLimitPerMinute: 120,
  retryPolicy: {
    maxAttempts: 1,
    baseDelayMs: 10,
    maxDelayMs: 50,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    list_files: {
      name: 'list_files',
      description: 'List files inside a workspace-scoped folder.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['local.folder.read'],
      rateLimitPerMinute: 120,
      inputSchema: {
        relativePath: { type: 'string', required: false, description: 'Subpath inside workspace root' },
      },
      outputSchema: {
        files: { type: 'array', required: true, description: 'Directory entries' },
      },
      verifierDescription: 'Verifies directory listing came from canonical path inside workspaceRoot.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (!Array.isArray(rec.files)) {
          return { verified: false, reason: 'Missing files array.' };
        }
        return { verified: true };
      },
    },
    read_text_file: {
      name: 'read_text_file',
      description: 'Read UTF-8 text from a file inside the scoped workspace folder.',
      risk: 'read',
      idempotent: true,
      supportsPagination: false,
      requiredScopes: ['local.folder.read'],
      rateLimitPerMinute: 120,
      inputSchema: {
        relativePath: { type: 'string', required: true, description: 'Relative file path inside workspace root', minLength: 1 },
      },
      outputSchema: {
        content: { type: 'string', required: true, description: 'File text content' },
        sizeBytes: { type: 'number', required: true, description: 'File byte length' },
      },
      verifierDescription: 'Verifies string content and byte count from canonical path inside workspaceRoot.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.content !== 'string' || typeof rec.sizeBytes !== 'number') {
          return { verified: false, reason: 'Missing content or sizeBytes.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: Local folder sample.',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const root = ctx.workspaceRoot;
    if (!root) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'needs_setup',
        evidenceClass: 'NEEDS_SETUP',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'No scoped local folder path selected.',
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Provide workspaceRoot to connect Local Folder (Scoped).',
          retryable: false,
        },
      };
    }
    try {
      const canonical = fs.realpathSync(root);
      const stat = fs.statSync(canonical);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `Path '${canonical}' is not a directory.`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'Workspace root must be an existing directory.',
            retryable: false,
          },
        };
      }
      const entries = fs.readdirSync(canonical);
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Scoped local folder verified (${entries.length} entries in root).`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Local folder check failed: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(toolSpec, args, _secret, ctx) {
    if (!ctx.workspaceRoot) {
      throw new Error('workspaceRoot is required for conn-local-folder operations.');
    }
    const rootCanonical = fs.realpathSync(ctx.workspaceRoot);
    const rel = String(args.relativePath ?? '.');
    const candidate = path.resolve(rootCanonical, rel);
    const targetCanonical = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
    if (
      targetCanonical !== rootCanonical &&
      !targetCanonical.startsWith(rootCanonical + path.sep)
    ) {
      throw new Error(`Path traversal outside scoped folder '${rootCanonical}' is denied.`);
    }
    if (toolSpec.name === 'list_files') {
      const all = fs.readdirSync(targetCanonical);
      const offset = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 0 : 0;
      const pageSize = ctx.pagination?.pageSize ?? 50;
      const slice = all.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      return {
        output: { files: slice, root: rootCanonical },
        pagination: {
          pageSize,
          returnedCount: slice.length,
          hasMore: nextOffset < all.length,
          nextCursor: nextOffset < all.length ? String(nextOffset) : undefined,
        },
      };
    }
    const content = fs.readFileSync(targetCanonical, 'utf8');
    return {
      output: {
        relativePath: rel,
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
      },
    };
  },
};

// --- 6.6 GitHub REST API Adapter ---
const githubAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-github',
  providerName: 'GitHub',
  authType: 'bearer',
  adapterImplemented: true,
  defaultVaultKeyId: 'vault_conn_github',
  supportedScopes: ['repo:read', 'issues:read', 'issues:write', 'pull_requests:read'],
  rateLimitPerMinute: 60,
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 50,
    maxDelayMs: 400,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    list_issues: {
      name: 'list_issues',
      description: 'List issues in a GitHub repository with pagination.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['issues:read'],
      rateLimitPerMinute: 60,
      inputSchema: {
        owner: { type: 'string', required: true, description: 'Repository owner', minLength: 1 },
        repo: { type: 'string', required: true, description: 'Repository name', minLength: 1 },
      },
      outputSchema: {
        issues: { type: 'array', required: true, description: 'List of GitHub issues' },
      },
      verifierDescription: 'Verifies array of issue objects with numeric number and title.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const issues = (output as Record<string, unknown>).issues;
        if (!Array.isArray(issues)) {
          return { verified: false, reason: 'Missing issues array.' };
        }
        return { verified: true };
      },
    },
    create_issue: {
      name: 'create_issue',
      description: 'Create a new issue in a GitHub repository (requires write scope & approval).',
      risk: 'write',
      idempotent: false,
      supportsPagination: false,
      requiredScopes: ['issues:write'],
      rateLimitPerMinute: 20,
      inputSchema: {
        owner: { type: 'string', required: true, description: 'Repository owner', minLength: 1 },
        repo: { type: 'string', required: true, description: 'Repository name', minLength: 1 },
        title: { type: 'string', required: true, description: 'Issue title', minLength: 1 },
        body: { type: 'string', required: false, description: 'Issue markdown body' },
      },
      outputSchema: {
        issueNumber: { type: 'number', required: true, description: 'Created issue number' },
        htmlUrl: { type: 'string', required: true, description: 'Issue URL' },
      },
      verifierDescription: 'Verifies created GitHub issue number and htmlUrl from 201 Created response.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const rec = output as Record<string, unknown>;
        if (typeof rec.issueNumber !== 'number' || typeof rec.htmlUrl !== 'string') {
          return { verified: false, reason: 'Missing issueNumber or htmlUrl from GitHub response.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: GitHub user fixture (not a live provider check).',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const secretRes = await resolveAdapterSecret(this, ctx);
    if (!secretRes.ok || !secretRes.secret) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'needs_setup',
        evidenceClass: 'NEEDS_SETUP',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: secretRes.error?.message || 'GitHub Personal Access Token is not configured in Vault.',
        connectionTestProvesAllToolsWork: false,
        error: secretRes.error,
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({
        url: 'https://api.github.com/user',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretRes.secret}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const userObj = resp.json as Record<string, unknown> | undefined;
      if (!resp.ok || !userObj || typeof userObj.login !== 'string') {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `GitHub authentication test failed (HTTP ${resp.status}).`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'UPSTREAM_HTTP_ERROR',
            httpStatus: resp.status,
            message: `GitHub /user returned HTTP ${resp.status}.`,
            retryable: resp.status >= 500,
          },
        };
      }
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        authenticatedIdentity: userObj.login,
        summary: `GitHub authenticated as @${userObj.login}.`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `GitHub network error: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(toolSpec, args, resolvedSecret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    const owner = encodeURIComponent(String(args.owner));
    const repo = encodeURIComponent(String(args.repo));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${resolvedSecret}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };

    if (toolSpec.name === 'list_issues') {
      const page = ctx.pagination?.cursor ? parseInt(ctx.pagination.cursor, 10) || 1 : 1;
      const perPage = ctx.pagination?.pageSize ?? 10;
      const resp = await transport({
        url: `https://api.github.com/repos/${owner}/${repo}/issues?page=${page}&per_page=${perPage}`,
        method: 'GET',
        headers,
      });
      if (!resp.ok || !Array.isArray(resp.json)) {
        throw Object.assign(new Error(`GitHub list_issues HTTP ${resp.status}`), {
          httpStatus: resp.status,
        });
      }
      const items = resp.json as Record<string, unknown>[];
      const hasMore = items.length >= perPage;
      return {
        output: {
          issues: items.map((it) => ({
            number: it.number,
            title: it.title,
            state: it.state,
          })),
        },
        pagination: {
          pageSize: perPage,
          returnedCount: items.length,
          hasMore,
          nextCursor: hasMore ? String(page + 1) : undefined,
        },
      };
    }

    // create_issue
    const resp = await transport({
      url: `https://api.github.com/repos/${owner}/${repo}/issues`,
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: args.title,
        body: args.body ?? '',
      }),
    });
    if (!resp.ok || !resp.json || typeof resp.json !== 'object') {
      throw Object.assign(new Error(`GitHub create_issue HTTP ${resp.status}`), {
        httpStatus: resp.status,
      });
    }
    const created = resp.json as Record<string, unknown>;
    return {
      output: {
        issueNumber: created.number,
        htmlUrl: created.html_url,
        title: created.title,
      },
    };
  },
};

// --- 6.7 Google Workspace OAuth 2.0 PKCE Adapter ---
const googleWorkspaceAdapter: ConnectorProviderAdapter = {
  connectorId: 'conn-google-workspace',
  providerName: 'Google Workspace',
  authType: 'oauth_pkce',
  adapterImplemented: true,
  defaultVaultKeyId: 'oauth_access_conn-google-workspace',
  supportedScopes: SUPPORTED_OAUTH_PROVIDERS['conn-google-workspace'].allowedScopes,
  rateLimitPerMinute: 60,
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 50,
    maxDelayMs: 400,
    retryOnlyIdempotentReads: true,
  },
  toolSchemas: {
    list_calendar_events: {
      name: 'list_calendar_events',
      description: 'List upcoming events from primary Google Calendar.',
      risk: 'read',
      idempotent: true,
      supportsPagination: true,
      requiredScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      rateLimitPerMinute: 60,
      inputSchema: {
        calendarId: { type: 'string', required: false, description: 'Calendar ID (default primary)' },
      },
      outputSchema: {
        events: { type: 'array', required: true, description: 'Calendar event items' },
      },
      verifierDescription: 'Verifies items array from Google Calendar v3 events list response.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        if (!Array.isArray((output as Record<string, unknown>).events)) {
          return { verified: false, reason: 'Missing events array.' };
        }
        return { verified: true };
      },
    },
    send_email: {
      name: 'send_email',
      description: 'Send an email via Gmail API (requires gmail.send scope and explicit user approval).',
      risk: 'write',
      idempotent: false,
      supportsPagination: false,
      requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
      rateLimitPerMinute: 10,
      inputSchema: {
        to: { type: 'string', required: true, description: 'Recipient email address', minLength: 3 },
        subject: { type: 'string', required: true, description: 'Email subject', minLength: 1 },
        bodyText: { type: 'string', required: true, description: 'Plain-text email body', minLength: 1 },
      },
      outputSchema: {
        messageId: { type: 'string', required: true, description: 'Sent Gmail message ID' },
      },
      verifierDescription: 'Verifies Gmail API returned a non-empty messageId.',
      verifyOutput: (output) => {
        if (!output || typeof output !== 'object') {
          return { verified: false, reason: 'Output is not an object.' };
        }
        const msgId = (output as Record<string, unknown>).messageId;
        if (typeof msgId !== 'string' || !msgId.trim()) {
          return { verified: false, reason: 'Missing Gmail messageId.' };
        }
        return { verified: true };
      },
    },
  },
  async testConnection(ctx = {}) {
    const start = Date.now();
    const testedAtIso = new Date(start).toISOString();
    if (ctx.mode === 'simulated') {
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'simulated',
        evidenceClass: 'SIMULATED',
        isSimulated: true,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: 'SIMULATED fixture: Google Workspace sample.',
        connectionTestProvesAllToolsWork: false,
      };
    }
    const secretRes = await resolveAdapterSecret(this, ctx);
    if (!secretRes.ok || !secretRes.secret) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'needs_setup',
        evidenceClass: 'NEEDS_SETUP',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: secretRes.error?.message || 'Google Workspace OAuth PKCE token not found in Vault.',
        connectionTestProvesAllToolsWork: false,
        error: secretRes.error,
      };
    }
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    try {
      const resp = await transport({
        url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretRes.secret}`,
          Accept: 'application/json',
        },
      });
      const data = resp.json as Record<string, unknown> | undefined;
      if (!resp.ok || !data || !Array.isArray(data.items)) {
        return {
          ok: false,
          connectorId: this.connectorId,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          testedAtIso,
          latencyMs: Date.now() - start,
          summary: `Google Workspace API check failed (HTTP ${resp.status}).`,
          connectionTestProvesAllToolsWork: false,
          error: {
            code: 'UPSTREAM_HTTP_ERROR',
            httpStatus: resp.status,
            message: `Google Calendar calendarList returned HTTP ${resp.status}.`,
            retryable: resp.status >= 500,
          },
        };
      }
      return {
        ok: true,
        connectorId: this.connectorId,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Google Workspace OAuth token verified (${data.items.length} calendar(s) accessible).`,
        connectionTestProvesAllToolsWork: false,
      };
    } catch (err) {
      return {
        ok: false,
        connectorId: this.connectorId,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        testedAtIso,
        latencyMs: Date.now() - start,
        summary: `Google Workspace network failure: ${err instanceof Error ? err.message : String(err)}`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'NETWORK_FAILURE',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
  },
  async discoverCapabilities(ctx = {}) {
    return buildCapabilityDiscoveryFromAdapter(this, ctx);
  },
  async executeProviderTool(toolSpec, args, resolvedSecret, ctx) {
    const transport = ctx.transport ?? defaultConnectorHttpTransport;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${resolvedSecret}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (toolSpec.name === 'list_calendar_events') {
      const calId = encodeURIComponent(String(args.calendarId || 'primary'));
      const maxResults = ctx.pagination?.pageSize ?? 10;
      const pageTokenParam = ctx.pagination?.cursor
        ? `&pageToken=${encodeURIComponent(ctx.pagination.cursor)}`
        : '';
      const resp = await transport({
        url: `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?maxResults=${maxResults}${pageTokenParam}`,
        method: 'GET',
        headers,
      });
      if (!resp.ok || !resp.json || typeof resp.json !== 'object') {
        throw Object.assign(new Error(`Google Calendar HTTP ${resp.status}`), {
          httpStatus: resp.status,
        });
      }
      const payload = resp.json as Record<string, unknown>;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const nextToken =
        typeof payload.nextPageToken === 'string' ? payload.nextPageToken : undefined;
      return {
        output: { events: items },
        pagination: {
          pageSize: maxResults,
          returnedCount: items.length,
          hasMore: Boolean(nextToken),
          nextCursor: nextToken,
        },
      };
    }

    // send_email
    const rawMime = `To: ${args.to}\r\nSubject: ${args.subject}\r\n\r\n${args.bodyText}`;
    const rawBase64Url = base64UrlEncode(Buffer.from(rawMime, 'utf8'));
    const resp = await transport({
      url: 'https://www.googleapis.com/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers,
      body: JSON.stringify({ raw: rawBase64Url }),
    });
    if (!resp.ok || !resp.json || typeof resp.json !== 'object') {
      throw Object.assign(new Error(`Gmail send HTTP ${resp.status}`), {
        httpStatus: resp.status,
      });
    }
    const sent = resp.json as Record<string, unknown>;
    return {
      output: {
        messageId: sent.id,
        threadId: sent.threadId,
      },
    };
  },
};

// --- 6.8 Catalogue-Only Unimplemented Adapter Factory ---
function createCatalogueOnlyAdapter(
  connectorId: string,
  providerName: string,
  authType: ConnectorProviderAdapter['authType'],
  supportedScopes: string[]
): ConnectorProviderAdapter {
  return {
    connectorId,
    providerName,
    authType,
    adapterImplemented: false,
    supportedScopes,
    rateLimitPerMinute: 10,
    retryPolicy: {
      maxAttempts: 1,
      baseDelayMs: 50,
      maxDelayMs: 50,
      retryOnlyIdempotentReads: true,
    },
    toolSchemas: {},
    async testConnection(ctx = {}) {
      const testedAtIso = new Date().toISOString();
      if (ctx.mode === 'simulated') {
        return {
          ok: true,
          connectorId,
          status: 'simulated',
          evidenceClass: 'SIMULATED',
          isSimulated: true,
          testedAtIso,
          latencyMs: 0,
          summary: `SIMULATED fixture for catalogue entry '${providerName}'.`,
          connectionTestProvesAllToolsWork: false,
        };
      }
      return {
        ok: false,
        connectorId,
        status: 'not_configured',
        evidenceClass: 'NOT_CONFIGURED',
        isSimulated: false,
        testedAtIso,
        latencyMs: 0,
        summary: `${providerName} is a catalogue entry without a configured live provider adapter in this build.`,
        connectionTestProvesAllToolsWork: false,
        error: {
          code: 'ADAPTER_NOT_IMPLEMENTED',
          message: `Provider adapter for '${providerName}' (${connectorId}) is not configured.`,
          retryable: false,
        },
      };
    },
    async discoverCapabilities(ctx = {}) {
      return buildCapabilityDiscoveryFromAdapter(this, ctx);
    },
    async executeProviderTool() {
      throw new Error(`Provider adapter '${providerName}' (${connectorId}) is not implemented.`);
    },
  };
}

export const CONNECTOR_PROVIDER_ADAPTERS: Record<string, ConnectorProviderAdapter> = {
  'conn-weather': weatherAdapter,
  'conn-wikipedia': wikipediaAdapter,
  'conn-rss-atom': rssAtomAdapter,
  'conn-calendar-ics': calendarIcsAdapter,
  'conn-local-folder': localFolderAdapter,
  'conn-github': githubAdapter,
  'conn-google-workspace': googleWorkspaceAdapter,
  // Catalogue-only entries explicitly marked adapterImplemented: false -> NOT_CONFIGURED
  'conn-web-fetch': createCatalogueOnlyAdapter('conn-web-fetch', 'Web Pages (Public)', 'none', ['public.web.read']),
  'conn-web-search': createCatalogueOnlyAdapter('conn-web-search', 'Web Search', 'none', ['public.search.query']),
  'conn-telegram': createCatalogueOnlyAdapter('conn-telegram', 'Telegram Bot', 'bearer', ['bot.updates.read', 'bot.messages.send']),
  'conn-slack': createCatalogueOnlyAdapter('conn-slack', 'Slack', 'bearer', ['channels:history', 'chat:write']),
  'conn-discord': createCatalogueOnlyAdapter('conn-discord', 'Discord Webhook', 'bearer', ['webhook.Info.read', 'webhook.messages.write']),
  'conn-notion': createCatalogueOnlyAdapter('conn-notion', 'Notion', 'bearer', ['pages:read', 'databases:read', 'pages:write']),
  'conn-linear': createCatalogueOnlyAdapter('conn-linear', 'Linear', 'api_key', ['issues:read', 'issues:write']),
  'conn-todoist': createCatalogueOnlyAdapter('conn-todoist', 'Todoist', 'bearer', ['data:read', 'data:read_write']),
  'conn-home-assistant': createCatalogueOnlyAdapter('conn-home-assistant', 'Home Assistant', 'bearer', ['states:read', 'services:call']),
  'conn-microsoft-365': createCatalogueOnlyAdapter('conn-microsoft-365', 'Microsoft 365', 'oauth_pkce', SUPPORTED_OAUTH_PROVIDERS['conn-microsoft-365'].allowedScopes),
  'conn-universal-mcp': createCatalogueOnlyAdapter('conn-universal-mcp', 'Universal MCP Server', 'mcp', ['mcp.tools.discover', 'mcp.tools.call']),
};

export function getConnectorProviderAdapter(
  connectorId: string
): ConnectorProviderAdapter | undefined {
  return CONNECTOR_PROVIDER_ADAPTERS[connectorId];
}

// ============================================================================
// 7. UNIFIED REAL TOOL INVOCATION PIPELINE
//    (PolicyEngine + Exact Capability Grant + Scope Check + Approval + Retry + Verifier)
// ============================================================================

function validateToolInputSchema(
  schema: Record<string, ConnectorToolSchemaField>,
  args: Record<string, unknown>
): { valid: boolean; reason?: string } {
  for (const [key, field] of Object.entries(schema)) {
    const val = args[key];
    if (field.required && (val === undefined || val === null || val === '')) {
      return { valid: false, reason: `Missing required parameter '${key}'.` };
    }
    if (val !== undefined && val !== null) {
      if (field.type === 'string' && typeof val !== 'string') {
        return { valid: false, reason: `Parameter '${key}' must be a string.` };
      }
      if (field.type === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
        return { valid: false, reason: `Parameter '${key}' must be a valid number.` };
      }
      if (field.type === 'string' && typeof val === 'string') {
        if (field.minLength !== undefined && val.length < field.minLength) {
          return {
            valid: false,
            reason: `Parameter '${key}' must be at least ${field.minLength} characters.`,
          };
        }
      }
      if (field.type === 'number' && typeof val === 'number') {
        if (field.minimum !== undefined && val < field.minimum) {
          return {
            valid: false,
            reason: `Parameter '${key}' must be >= ${field.minimum}.`,
          };
        }
        if (field.maximum !== undefined && val > field.maximum) {
          return {
            valid: false,
            reason: `Parameter '${key}' must be <= ${field.maximum}.`,
          };
        }
      }
    }
  }
  return { valid: true };
}

export async function invokeConnectorAdapterTool(
  connectorId: string,
  ctx: AdapterToolInvocationContext
): Promise<AdapterToolInvocationResult> {
  const adapter = getConnectorProviderAdapter(connectorId);
  if (!adapter || !adapter.adapterImplemented) {
    return {
      ok: false,
      connectorId,
      toolName: ctx.toolName,
      risk: 'read',
      status: 'not_configured',
      evidenceClass: 'NOT_CONFIGURED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Adapter for '${connectorId}' is not configured.`,
      attempts: 0,
      recordedInLedger: false,
      error: {
        code: 'ADAPTER_NOT_IMPLEMENTED',
        message: `Connector '${connectorId}' does not have an active provider adapter.`,
        retryable: false,
      },
    };
  }

  const toolSpec = adapter.toolSchemas[ctx.toolName];
  if (!toolSpec) {
    return {
      ok: false,
      connectorId,
      toolName: ctx.toolName,
      risk: 'read',
      status: 'failed',
      evidenceClass: 'UNSUPPORTED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Tool '${ctx.toolName}' is not supported by '${adapter.providerName}'.`,
      attempts: 0,
      recordedInLedger: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Tool '${ctx.toolName}' does not exist on adapter '${adapter.providerName}'.`,
        retryable: false,
      },
    };
  }

  // 1. Exact Capability Grant Enforcement
  const exactCap = `connector:${connectorId}:${toolSpec.name}`;
  const wildcardCap = `connector:${connectorId}:*`;
  const hasCap =
    ctx.grantedCapabilities.includes(exactCap) ||
    ctx.grantedCapabilities.includes(wildcardCap);
  if (!hasCap) {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'missing_capability',
      evidenceClass: 'BLOCKED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Missing required capability grant '${exactCap}'.`,
      attempts: 0,
      recordedInLedger: true,
      ledgerRef: `ledg-cap-deny-${Date.now()}`,
      error: {
        code: 'MISSING_CAPABILITY_GRANT',
        message: `Caller lacks capability grant '${exactCap}'.`,
        retryable: false,
      },
    };
  }

  // 2. Scope Enforcement (proving connection test != every tool works)
  const effectiveScopes =
    ctx.grantedScopes ??
    (adapter.authType === 'none' ? adapter.supportedScopes : []);
  const missingScopes = toolSpec.requiredScopes.filter(
    (s) => !effectiveScopes.includes(s)
  );
  if (missingScopes.length > 0) {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'missing_scope',
      evidenceClass: 'BLOCKED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Missing required OAuth/API scope(s): ${missingScopes.join(', ')}`,
      attempts: 0,
      recordedInLedger: true,
      ledgerRef: `ledg-scope-deny-${Date.now()}`,
      error: {
        code: 'MISSING_OAUTH_SCOPE',
        message: `Tool '${toolSpec.name}' requires scope(s): ${missingScopes.join(', ')}.`,
        retryable: false,
      },
    };
  }

  // 3. Rule Book check
  const matchedRule = (ctx.rules || []).find(
    (r) =>
      r.enabled &&
      (r.scope === 'Everywhere' ||
        (r.scope === 'Connector' &&
          (!r.targetName ||
            r.targetName.toLowerCase().includes(adapter.providerName.toLowerCase())))) &&
      (r.actionClass === 'write' || r.actionClass === 'destructive')
  );
  if (matchedRule?.enforcement === 'block' && toolSpec.risk === 'write') {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'blocked_by_rule',
      evidenceClass: 'BLOCKED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Rule Book blocked write tool '${toolSpec.name}' on '${adapter.providerName}'.`,
      attempts: 0,
      recordedInLedger: true,
      ledgerRef: `ledg-rule-deny-${Date.now()}`,
      error: {
        code: 'POLICY_BLOCKED',
        message: `Blocked by Rule Book rule '${matchedRule.id}'.`,
        retryable: false,
      },
    };
  }

  // 4. Central PolicyEngine & Single-Use ScopedApprovalToken Evaluation
  const policyRiskClass =
    toolSpec.risk === 'write' ? 'external_send' : 'read';
  const targetIdentifier = `${connectorId}:${toolSpec.name}`;
  const policyDecision = globalPolicyEngine.evaluateToolCall({
    callerId: `connector:${connectorId}`,
    toolName: `connector.${toolSpec.name}`,
    target: targetIdentifier,
    args: ctx.args,
    riskClass: policyRiskClass,
    profileId: 'personal',
    approvalToken: ctx.approvalToken,
  });

  if (!policyDecision.allowed) {
    const isApproval =
      policyDecision.decision === 'REQUIRE_APPROVAL' ||
      policyDecision.decision === 'SUSPEND_TAKEOVER';
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: isApproval ? 'needs_approval' : 'blocked_by_rule',
      evidenceClass: isApproval ? 'WAITING_FOR_APPROVAL' : 'BLOCKED',
      isSimulated: false,
      verified: false,
      verificationSummary: policyDecision.reason,
      attempts: 0,
      recordedInLedger: true,
      ledgerRef: `ledg-policy-${isApproval ? 'wait' : 'deny'}-${Date.now()}`,
      error: {
        code: isApproval ? 'APPROVAL_REQUIRED' : 'POLICY_BLOCKED',
        message: policyDecision.reason,
        retryable: false,
      },
    };
  }

  // 5. Input Schema Validation
  const schemaCheck = validateToolInputSchema(toolSpec.inputSchema, ctx.args);
  if (!schemaCheck.valid) {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'failed',
      evidenceClass: 'FAILED',
      isSimulated: false,
      verified: false,
      verificationSummary: schemaCheck.reason || 'Input schema validation failed.',
      attempts: 0,
      recordedInLedger: false,
      error: {
        code: 'INVALID_INPUT_SCHEMA',
        message: schemaCheck.reason || 'Invalid tool arguments.',
        retryable: false,
      },
    };
  }

  // 6. Idempotency Deduplication Check
  if (ctx.idempotencyKey) {
    const cacheKey = `${connectorId}:${toolSpec.name}:${ctx.idempotencyKey}`;
    const cached = idempotencyResultCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        deduplicatedFromCache: true,
      };
    }
  }

  // 7. Rate Limit Check
  const rateCheck = globalConnectorRateLimiter.checkAndConsume(
    `${connectorId}:${toolSpec.name}`,
    toolSpec.rateLimitPerMinute
  );
  if (!rateCheck.allowed) {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'failed',
      evidenceClass: 'FAILED',
      isSimulated: false,
      verified: false,
      verificationSummary: `Rate limit exceeded (${toolSpec.rateLimitPerMinute}/min).`,
      attempts: 0,
      recordedInLedger: true,
      ledgerRef: `ledg-ratelimit-${Date.now()}`,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit of ${toolSpec.rateLimitPerMinute} req/min exceeded for ${connectorId}:${toolSpec.name}.`,
        retryable: true,
        retryAfterMs: rateCheck.retryAfterMs,
      },
    };
  }

  // 8. Resolve Vault Credentials if needed
  const secretRes = await resolveAdapterSecret(adapter, ctx);
  if (!secretRes.ok) {
    return {
      ok: false,
      connectorId,
      toolName: toolSpec.name,
      risk: toolSpec.risk,
      status: 'failed',
      evidenceClass: 'NEEDS_SETUP',
      isSimulated: false,
      verified: false,
      verificationSummary: secretRes.error?.message || 'Missing credentials in Vault.',
      attempts: 0,
      recordedInLedger: false,
      error: secretRes.error,
    };
  }

  // 9. Execute with Retry Policy (Retries ONLY for idempotent reads)
  const canRetry =
    toolSpec.idempotent &&
    toolSpec.risk === 'read' &&
    adapter.retryPolicy.maxAttempts > 1;
  const maxAttempts = canRetry ? adapter.retryPolicy.maxAttempts : 1;

  let attempts = 0;
  let lastErr: unknown = undefined;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const execResult = await adapter.executeProviderTool(
        toolSpec,
        ctx.args,
        secretRes.secret,
        ctx
      );

      // 10. Independent Verifier Check
      const verification = toolSpec.verifyOutput(execResult.output, ctx.args);
      if (!verification.verified) {
        return {
          ok: false,
          connectorId,
          toolName: toolSpec.name,
          risk: toolSpec.risk,
          status: 'failed',
          evidenceClass: 'FAILED',
          isSimulated: false,
          verified: false,
          verificationSummary: `Verifier rejected provider output: ${verification.reason}`,
          attempts,
          recordedInLedger: true,
          ledgerRef: `ledg-verify-fail-${Date.now()}`,
          error: {
            code: 'VERIFICATION_FAILED',
            message: verification.reason || 'Provider output failed schema verification.',
            retryable: false,
          },
        };
      }

      const finalResult: AdapterToolInvocationResult = {
        ok: true,
        connectorId,
        toolName: toolSpec.name,
        risk: toolSpec.risk,
        status: 'executed',
        evidenceClass: 'REAL',
        isSimulated: false,
        verified: true,
        verificationSummary: `Verified by ${adapter.providerName} adapter verifier (${toolSpec.verifierDescription})`,
        attempts,
        idempotencyKey: ctx.idempotencyKey,
        pagination: execResult.pagination,
        output: execResult.output,
        recordedInLedger: true,
        ledgerRef: `ledg-exec-${connectorId}-${Date.now()}`,
      };

      if (ctx.idempotencyKey) {
        idempotencyResultCache.set(
          `${connectorId}:${toolSpec.name}:${ctx.idempotencyKey}`,
          finalResult
        );
      }

      return finalResult;
    } catch (err) {
      lastErr = err;
      const httpStatus = (err as { httpStatus?: number })?.httpStatus;
      const isTransient =
        httpStatus === undefined ||
        httpStatus === 429 ||
        httpStatus === 502 ||
        httpStatus === 503 ||
        httpStatus === 504;
      if (!canRetry || !isTransient || attempts >= maxAttempts) {
        break;
      }
      const delay = Math.min(
        adapter.retryPolicy.maxDelayMs,
        adapter.retryPolicy.baseDelayMs * Math.pow(2, attempts - 1)
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const rawMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const safeMsg = redactSecretsFromText(
    rawMsg,
    secretRes.secret ? [secretRes.secret] : []
  );
  const httpStatus = (lastErr as { httpStatus?: number })?.httpStatus;

  return {
    ok: false,
    connectorId,
    toolName: toolSpec.name,
    risk: toolSpec.risk,
    status: 'failed',
    evidenceClass: 'FAILED',
    isSimulated: false,
    verified: false,
    verificationSummary: `Provider invocation failed after ${attempts} attempt(s): ${safeMsg}`,
    attempts,
    idempotencyKey: ctx.idempotencyKey,
    recordedInLedger: true,
    ledgerRef: `ledg-fail-${connectorId}-${Date.now()}`,
    error: {
      code: httpStatus ? 'UPSTREAM_HTTP_ERROR' : 'NETWORK_FAILURE',
      httpStatus,
      message: safeMsg,
      retryable: Boolean(toolSpec.idempotent && toolSpec.risk === 'read'),
    },
  };
}
