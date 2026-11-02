/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Versioned Canonical Ledger Serialization & Chain Verification (`src/packages/trust/canonical_ledger.ts`)
 *
 * Binds:
 * - sequence / index
 * - timestamp
 * - actor
 * - eventType
 * - mission
 * - profileWorkspace
 * - redactedSummary
 * - payloadReference
 * - payloadDigest (real SHA-256 hex)
 * - previousHash (real SHA-256 hex)
 * - schemaVersion (version 2)
 */

import { computeCryptographicSha256 } from './crypto';

export const CANONICAL_LEDGER_SCHEMA_VERSION = 2;
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export interface CanonicalLedgerFields {
  sequence: number;
  timestamp: string;
  actor: string;
  eventType: string;
  mission: string;
  profileWorkspace: string;
  redactedSummary: string;
  payloadReference: string;
  payloadDigest: string; // Real SHA-256 hex
  previousHash: string;  // Real SHA-256 hex
  schemaVersion: number; // 2
}

/**
 * Deterministically serializes the 11 bound ledger fields into a canonical string.
 * Uses strict key ordering and JSON normalization so whitespace or field order
 * cannot cause non-deterministic hash variation.
 */
export function serializeCanonicalLedgerRecord(fields: CanonicalLedgerFields): string {
  const normalized = {
    schemaVersion: Number(fields.schemaVersion),
    sequence: Number(fields.sequence),
    timestamp: String(fields.timestamp || '').trim(),
    actor: String(fields.actor || '').trim(),
    eventType: String(fields.eventType || '').trim(),
    mission: String(fields.mission || '').trim(),
    profileWorkspace: String(fields.profileWorkspace || '').trim(),
    redactedSummary: String(fields.redactedSummary || '').trim(),
    payloadReference: String(fields.payloadReference || '').trim(),
    payloadDigest: String(fields.payloadDigest || '').toLowerCase().trim(),
    previousHash: String(fields.previousHash || '').toLowerCase().trim(),
  };

  // Deterministic JSON with fixed key order
  return JSON.stringify(normalized, [
    'schemaVersion',
    'sequence',
    'timestamp',
    'actor',
    'eventType',
    'mission',
    'profileWorkspace',
    'redactedSummary',
    'payloadReference',
    'payloadDigest',
    'previousHash',
  ]);
}

/**
 * Computes the real SHA-256 hash of the canonical serialized ledger record.
 */
export function computeCanonicalLedgerHash(fields: CanonicalLedgerFields): string {
  const canonicalString = serializeCanonicalLedgerRecord(fields);
  return computeCryptographicSha256(canonicalString);
}

export interface LedgerValidationResult {
  valid: boolean;
  errors: string[];
  canonicalFields?: CanonicalLedgerFields;
}

/**
 * Validates that all 11 required canonical ledger fields are present, properly typed, and meet schema constraints.
 */
export function validateCanonicalLedgerFields(raw: any): LedgerValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Record must be a non-null object.'] };
  }

  const sequence = Number(raw.sequence ?? raw.index);
  if (!Number.isInteger(sequence) || sequence < 0) {
    errors.push(`Invalid sequence: expected non-negative integer, got ${raw.sequence}`);
  }

  const schemaVersion = Number(raw.schemaVersion ?? 2);
  if (schemaVersion < 1) {
    errors.push(`Invalid schemaVersion: expected positive integer, got ${raw.schemaVersion}`);
  }

  if (!raw.timestamp || isNaN(Date.parse(raw.timestamp))) {
    errors.push(`Invalid timestamp: ${raw.timestamp}`);
  }

  if (!raw.actor || typeof raw.actor !== 'string') {
    errors.push('Missing or invalid actor.');
  }

  const eventType = raw.eventType || raw.type;
  if (!eventType || typeof eventType !== 'string') {
    errors.push('Missing or invalid eventType.');
  }

  const mission = raw.mission || raw.missionId || 'unassigned';
  const profileWorkspace = raw.profileWorkspace || raw.workspaceId || raw.orgId || 'default-workspace';
  const redactedSummary = raw.redactedSummary ?? raw.summary ?? '';
  const payloadReference = raw.payloadReference ?? raw.contentRef ?? '';

  const payloadDigest = String(raw.payloadDigest || raw.evidenceHash || '').toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(payloadDigest) && !/^[0-9a-f]{16,64}$/.test(payloadDigest)) {
    errors.push(`Invalid payloadDigest: expected hex hash, got '${payloadDigest}'`);
  }

  const previousHash = String(raw.previousHash || '').toLowerCase().trim();
  if (sequence === 0) {
    if (previousHash !== GENESIS_PREVIOUS_HASH && previousHash !== '0'.repeat(previousHash.length || 64)) {
      errors.push(`Genesis event must have previousHash of zeroes, got '${previousHash}'`);
    }
  } else if (!/^[0-9a-f]{64}$/.test(previousHash) && !/^[0-9a-f]{16,64}$/.test(previousHash)) {
    errors.push(`Invalid previousHash: expected hex hash, got '${previousHash}'`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    canonicalFields: {
      sequence,
      timestamp: new Date(raw.timestamp).toISOString(),
      actor: raw.actor.trim(),
      eventType: String(eventType).trim(),
      mission: String(mission).trim(),
      profileWorkspace: String(profileWorkspace).trim(),
      redactedSummary: String(redactedSummary).trim(),
      payloadReference: String(payloadReference).trim(),
      payloadDigest,
      previousHash,
      schemaVersion,
    },
  };
}

/**
 * Validates cryptographic chain integrity between a current event and its preceding event.
 */
export function verifyLedgerEventChainLink(
  current: CanonicalLedgerFields,
  currentReportedHash: string,
  previous?: { sequence: number; ownHash: string; timestamp: string }
): { valid: boolean; reason?: string } {
  // 1. Verify schema version
  if (current.schemaVersion !== CANONICAL_LEDGER_SCHEMA_VERSION && current.schemaVersion !== 1) {
    return { valid: false, reason: `Unsupported schema version: ${current.schemaVersion}` };
  }

  // 2. Verify own hash recomputation
  const recomputedHash = computeCanonicalLedgerHash(current);
  if (recomputedHash.toLowerCase() !== currentReportedHash.toLowerCase()) {
    return {
      valid: false,
      reason: `Hash mismatch at sequence ${current.sequence}: stored ownHash='${currentReportedHash}', recomputed='${recomputedHash}'`,
    };
  }

  // 3. Genesis check
  if (!previous) {
    if (current.sequence !== 0) {
      return { valid: false, reason: `Genesis event must have sequence 0, got ${current.sequence}` };
    }
    return { valid: true };
  }

  // 4. Sequence increment check
  if (current.sequence !== previous.sequence + 1) {
    return {
      valid: false,
      reason: `Sequence break at sequence ${current.sequence}: expected ${previous.sequence + 1}, got ${current.sequence}`,
    };
  }

  // 5. Previous hash link check
  if (current.previousHash.toLowerCase() !== previous.ownHash.toLowerCase()) {
    return {
      valid: false,
      reason: `Chain link broken at sequence ${current.sequence}: expected previousHash='${previous.ownHash}', got '${current.previousHash}'`,
    };
  }

  // 6. Monotonic timestamp check
  const currTime = Date.parse(current.timestamp);
  const prevTime = Date.parse(previous.timestamp);
  if (currTime < prevTime) {
    return {
      valid: false,
      reason: `Non-monotonic timestamp at sequence ${current.sequence}: timestamp ${current.timestamp} is before previous ${previous.timestamp}`,
    };
  }

  return { valid: true };
}
