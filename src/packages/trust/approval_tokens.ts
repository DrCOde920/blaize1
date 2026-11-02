/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-Use Scoped Approval Token Store for Blaize Trust Kernel (PROMPT 2.9)
 *
 * Enforces:
 * - Single-use consumption (replays strictly rejected)
 * - Cryptographic / deterministic payload hash binding
 * - Strict binding to exact tool name, target, amount, browser profile, and expiry
 * - Zero reuse across mutated targets, changed amounts, or altered payloads
 */

import { BrowserProfileId, ScopedApprovalToken } from '../contracts';
import { computeDeterministicHash } from './hash';

export interface TokenValidationResult {
  valid: boolean;
  errorCode?:
    | 'MISSING_APPROVAL_TOKEN'
    | 'TOKEN_NOT_FOUND'
    | 'TOKEN_ALREADY_CONSUMED'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_TOOL_MISMATCH'
    | 'TOKEN_TARGET_MISMATCH'
    | 'TOKEN_PAYLOAD_HASH_MISMATCH'
    | 'TOKEN_AMOUNT_MISMATCH'
    | 'TOKEN_PROFILE_MISMATCH';
  reason: string;
  tokenId?: string;
}

export class SingleUseApprovalTokenStore {
  private activeTokens = new Map<string, ScopedApprovalToken>();
  private consumedTokens = new Set<string>();

  /**
   * Issues a new single-use scoped approval token bound to exact execution parameters.
   */
  public issueToken(params: {
    toolOrActionName: string;
    target: string;
    payload?: unknown;
    amount?: number;
    profileId: BrowserProfileId;
    ttlMs?: number;
    issuedBy?: 'operator' | 'user';
    scopeReason?: string;
  }): ScopedApprovalToken {
    const now = Date.now();
    const ttl = params.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
    const payloadStr =
      typeof params.payload === 'string'
        ? params.payload
        : JSON.stringify(params.payload ?? {});
    const payloadHash = computeDeterministicHash(
      `${params.toolOrActionName}|${params.target}|${payloadStr}|${params.amount ?? 'na'}`
    );

    const nonce = Math.random().toString(36).slice(2, 10);
    const tokenId = `appr_${now}_${nonce}`;

    const token: ScopedApprovalToken = {
      tokenId,
      toolOrActionName: params.toolOrActionName.trim(),
      target: params.target.trim(),
      payloadHash,
      amount: params.amount,
      profileId: params.profileId,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      issuedBy: params.issuedBy || 'operator',
      scopeReason: params.scopeReason,
      consumed: false,
    };

    this.activeTokens.set(tokenId, token);
    return token;
  }

  /**
   * Validates and immediately consumes a single-use token.
   * If any parameter differs from the approval grant, fails closed.
   */
  public validateAndConsumeToken(
    tokenInput: ScopedApprovalToken | undefined,
    expected: {
      toolOrActionName: string;
      target: string;
      payload?: unknown;
      amount?: number;
      profileId: BrowserProfileId;
    }
  ): TokenValidationResult {
    if (!tokenInput || !tokenInput.tokenId) {
      return {
        valid: false,
        errorCode: 'MISSING_APPROVAL_TOKEN',
        reason: 'Action requires explicit user approval; no approval token was provided.',
      };
    }

    const { tokenId } = tokenInput;

    // 1. Replay check
    if (this.consumedTokens.has(tokenId)) {
      return {
        valid: false,
        errorCode: 'TOKEN_ALREADY_CONSUMED',
        reason: `Approval token '${tokenId}' has already been consumed. Replay is strictly prohibited.`,
        tokenId,
      };
    }

    // 2. Lookup in store
    const stored = this.activeTokens.get(tokenId);
    if (!stored) {
      return {
        valid: false,
        errorCode: 'TOKEN_NOT_FOUND',
        reason: `Approval token '${tokenId}' was not found in the Trust Kernel token vault.`,
        tokenId,
      };
    }

    if (stored.consumed) {
      this.consumedTokens.add(tokenId);
      return {
        valid: false,
        errorCode: 'TOKEN_ALREADY_CONSUMED',
        reason: `Approval token '${tokenId}' was previously consumed.`,
        tokenId,
      };
    }

    // 3. Expiry check
    const expiresMs = new Date(stored.expiresAt).getTime();
    if (Date.now() > expiresMs) {
      this.activeTokens.delete(tokenId);
      return {
        valid: false,
        errorCode: 'TOKEN_EXPIRED',
        reason: `Approval token '${tokenId}' expired at ${stored.expiresAt}.`,
        tokenId,
      };
    }

    // 4. Exact tool check
    if (stored.toolOrActionName !== expected.toolOrActionName.trim()) {
      return {
        valid: false,
        errorCode: 'TOKEN_TOOL_MISMATCH',
        reason: `Approval token was granted for tool '${stored.toolOrActionName}', but attempted for '${expected.toolOrActionName}'.`,
        tokenId,
      };
    }

    // 5. Exact target check
    if (stored.target !== expected.target.trim()) {
      return {
        valid: false,
        errorCode: 'TOKEN_TARGET_MISMATCH',
        reason: `Approval token was granted for target '${stored.target}', but execution attempted target '${expected.target}'.`,
        tokenId,
      };
    }

    // 6. Exact profile check
    if (stored.profileId !== expected.profileId) {
      return {
        valid: false,
        errorCode: 'TOKEN_PROFILE_MISMATCH',
        reason: `Approval token was granted for profile '${stored.profileId}', but executed in profile '${expected.profileId}'.`,
        tokenId,
      };
    }

    // 7. Amount check (if spend)
    if (stored.amount !== undefined) {
      if (expected.amount === undefined || stored.amount !== expected.amount) {
        return {
          valid: false,
          errorCode: 'TOKEN_AMOUNT_MISMATCH',
          reason: `Approval token amount mismatch: granted for amount $${stored.amount}, but execution payload specifies $${expected.amount ?? 'N/A'}.`,
          tokenId,
        };
      }
    }

    // 8. Payload hash check
    const payloadStr =
      typeof expected.payload === 'string'
        ? expected.payload
        : JSON.stringify(expected.payload ?? {});
    const expectedPayloadHash = computeDeterministicHash(
      `${expected.toolOrActionName.trim()}|${expected.target.trim()}|${payloadStr}|${expected.amount ?? 'na'}`
    );

    if (stored.payloadHash !== expectedPayloadHash) {
      return {
        valid: false,
        errorCode: 'TOKEN_PAYLOAD_HASH_MISMATCH',
        reason: `Approval token payload hash mismatch. Payload arguments have been altered after approval was granted.`,
        tokenId,
      };
    }

    // 9. Successfully consume token
    stored.consumed = true;
    stored.consumedAt = new Date().toISOString();
    this.consumedTokens.add(tokenId);
    this.activeTokens.delete(tokenId);

    return {
      valid: true,
      reason: `Single-use approval token '${tokenId}' validated and consumed for '${expected.toolOrActionName}'.`,
      tokenId,
    };
  }

  public isConsumed(tokenId: string): boolean {
    return this.consumedTokens.has(tokenId);
  }

  public revokeToken(tokenId: string): boolean {
    const had = this.activeTokens.delete(tokenId);
    this.consumedTokens.add(tokenId);
    return had;
  }

  public clear(): void {
    this.activeTokens.clear();
    this.consumedTokens.clear();
  }
}

export const globalApprovalTokenStore = new SingleUseApprovalTokenStore();
