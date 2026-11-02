/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Durable SQLite Database Engine for Blaize (`src/packages/storage/sqlite_db.ts`)
 * Powered by Node.js native `node:sqlite` (DatabaseSync).
 *
 * Features:
 * - WAL journal mode and foreign keys enforcement
 * - Atomic transactions with automatic rollback
 * - SQLite FTS5 full-text indexing & search
 * - Schema migrations tracking
 * - Database backup & restore
 * - Cryptographic integrity checks (PRAGMA integrity_check)
 * - Right-to-delete cascades across records, FTS5, and content stores
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS } from './migrations';
import {
  CanonicalLedgerFields,
  validateCanonicalLedgerFields,
  computeCanonicalLedgerHash,
} from '../trust/canonical_ledger';

export interface StorageRecordItem {
  id: string;
  collection: string;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface FtsSearchResultItem {
  id: string;
  collection: string;
  rank: number;
  snippet?: string;
  data?: any;
}

export interface EncryptedContentRecord {
  contentRef: string;
  ivHex: string;
  ciphertextHex: string;
  authTagHex: string;
  byteLength: number;
  mimeType: string;
  deleted: boolean;
  deletedAt?: string;
  createdAt: string;
}

export interface StoredLedgerEventRecord extends CanonicalLedgerFields {
  id: string;
  summary?: string;
  contentRef?: string;
  evidenceHash?: string;
  trustLevel: string;
  executionState?: string;
  verificationState?: string;
  isSimulated: boolean;
  quarantined: boolean;
  createdAt: string;
  ownHash: string;
}

export class DurableSqliteDatabase {
  private db: DatabaseSync;
  private dbPath: string;
  private isClosed = false;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.configurePragmas();
    this.runMigrations();
  }

  private configurePragmas(): void {
    // WAL mode for concurrency and durability
    if (this.dbPath !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode = WAL;');
      } catch {
        // WAL may not be supported on all memory/network volumes
      }
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = this.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
      .all() as Array<{ version: number }>;
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        this.transaction(() => {
          migration.up(this.db);
          this.db
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, new Date().toISOString());
        });
      }
    }
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public getPath(): string {
    return this.dbPath;
  }

  private transactionDepth = 0;

  /**
   * Executes an atomic transaction. Supports nesting via SQLite savepoints.
   * Automatically commits on return and rolls back on exception.
   */
  public transaction<T>(fn: () => T): T {
    this.checkOpen();
    const isRoot = this.transactionDepth === 0;
    const savepointName = `sp_${this.transactionDepth}`;
    this.transactionDepth++;

    if (isRoot) {
      this.db.exec('BEGIN IMMEDIATE');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    }

    try {
      const result = fn();
      if (isRoot) {
        this.db.exec('COMMIT');
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      this.transactionDepth--;
      return result;
    } catch (err) {
      if (isRoot) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Ignore
        }
      } else {
        try {
          this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        } catch {
          // Ignore
        }
      }
      this.transactionDepth--;
      throw err;
    }
  }

  /**
   * Runs SQLite PRAGMA integrity_check.
   */
  public checkIntegrity(): { ok: boolean; details: string[] } {
    this.checkOpen();
    const rows = this.db.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    const details = rows.map((r) => r.integrity_check);
    const ok = details.length === 1 && details[0] === 'ok';
    return { ok, details };
  }

  // ==========================================================================
  // 1. GENERIC RECORDS & SQLite FTS5 SEARCH
  // ==========================================================================

  public setRecord(collection: string, id: string, data: any): void {
    this.checkOpen();
    const now = new Date().toISOString();
    const dataJson = JSON.stringify(data);
    const title = data?.title || data?.name || data?.label || id;
    const textContent = `${title} ${dataJson}`;

    this.transaction(() => {
      // 1. Upsert record
      const stmt = this.db.prepare(`
        INSERT INTO records (id, collection, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          collection = excluded.collection,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `);
      stmt.run(id, collection, dataJson, now, now);

      // 2. Synchronize FTS5 index: delete old, insert new
      this.db.prepare('DELETE FROM fts_records WHERE record_id = ?').run(id);
      this.db
        .prepare('INSERT INTO fts_records (record_id, collection, title, content) VALUES (?, ?, ?, ?)')
        .run(id, collection, String(title), textContent);
    });
  }

  public getRecord<T = any>(id: string): StorageRecordItem | null {
    this.checkOpen();
    const row = this.db
      .prepare('SELECT id, collection, data_json, created_at, updated_at FROM records WHERE id = ?')
      .get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      collection: row.collection,
      data: JSON.parse(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listRecords(collection?: string): StorageRecordItem[] {
    this.checkOpen();
    const query = collection
      ? 'SELECT id, collection, data_json, created_at, updated_at FROM records WHERE collection = ? ORDER BY updated_at DESC'
      : 'SELECT id, collection, data_json, created_at, updated_at FROM records ORDER BY updated_at DESC';
    const rows = (collection ? this.db.prepare(query).all(collection) : this.db.prepare(query).all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      collection: r.collection,
      data: JSON.parse(r.data_json),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public deleteRecord(id: string): boolean {
    this.checkOpen();
    return this.transaction(() => {
      this.db.prepare('DELETE FROM fts_records WHERE record_id = ?').run(id);
      const res = this.db.prepare('DELETE FROM records WHERE id = ?').run(id);
      return res.changes > 0;
    });
  }

  /**
   * Real SQLite FTS5 full-text query with bm25 ranking.
   */
  public searchFts(query: string, collection?: string, limit = 20): FtsSearchResultItem[] {
    this.checkOpen();
    const sanitizedQuery = query
      .replace(/[^\w\s-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w}"*`)
      .join(' ');

    if (!sanitizedQuery) return [];

    let sql: string;
    let params: any[];

    if (collection) {
      sql = `
        SELECT fts.record_id, fts.collection, bm25(fts_records) AS rank, r.data_json
        FROM fts_records fts
        LEFT JOIN records r ON r.id = fts.record_id
        WHERE fts_records MATCH ? AND fts.collection = ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [sanitizedQuery, collection, limit];
    } else {
      sql = `
        SELECT fts.record_id, fts.collection, bm25(fts_records) AS rank, r.data_json
        FROM fts_records fts
        LEFT JOIN records r ON r.id = fts.record_id
        WHERE fts_records MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [sanitizedQuery, limit];
    }

    try {
      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map((r) => ({
        id: r.record_id,
        collection: r.collection,
        rank: Number(r.rank),
        data: r.data_json ? JSON.parse(r.data_json) : undefined,
      }));
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // 2. ENCRYPTED CONTENT STORE (AES-256-GCM PAYLOADS) & RIGHT-TO-DELETE
  // ==========================================================================

  public setEncryptedContent(
    contentRef: string,
    envelope: { ivHex: string; ciphertextHex: string; authTagHex: string; byteLength: number; mimeType?: string }
  ): void {
    this.checkOpen();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO encrypted_content (content_ref, iv_hex, ciphertext_hex, auth_tag_hex, byte_length, mime_type, deleted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(content_ref) DO UPDATE SET
        iv_hex = excluded.iv_hex,
        ciphertext_hex = excluded.ciphertext_hex,
        auth_tag_hex = excluded.auth_tag_hex,
        byte_length = excluded.byte_length,
        mime_type = excluded.mime_type,
        deleted = 0,
        deleted_at = NULL
    `);
    stmt.run(
      contentRef,
      envelope.ivHex,
      envelope.ciphertextHex,
      envelope.authTagHex,
      envelope.byteLength,
      envelope.mimeType || 'application/json',
      now
    );
  }

  public getEncryptedContent(contentRef: string): EncryptedContentRecord | null {
    this.checkOpen();
    const row = this.db
      .prepare('SELECT content_ref, iv_hex, ciphertext_hex, auth_tag_hex, byte_length, mime_type, deleted, deleted_at, created_at FROM encrypted_content WHERE content_ref = ?')
      .get(contentRef) as any;
    if (!row) return null;
    return {
      contentRef: row.content_ref,
      ivHex: row.iv_hex,
      ciphertextHex: row.ciphertext_hex,
      authTagHex: row.auth_tag_hex,
      byteLength: row.byte_length,
      mimeType: row.mime_type,
      deleted: Boolean(row.deleted),
      deletedAt: row.deleted_at || undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Permanent right-to-delete: zeroes out ciphertext, IV, and auth tag in database storage.
   */
  public deleteEncryptedContent(contentRef: string): { deleted: boolean; bytesReclaimed: number } {
    this.checkOpen();
    return this.transaction(() => {
      const existing = this.getEncryptedContent(contentRef);
      if (!existing || existing.deleted) {
        return { deleted: false, bytesReclaimed: 0 };
      }
      const bytesReclaimed = existing.byteLength;
      const now = new Date().toISOString();
      this.db
        .prepare(`
          UPDATE encrypted_content
          SET iv_hex = '', ciphertext_hex = '', auth_tag_hex = '', byte_length = 0, deleted = 1, deleted_at = ?
          WHERE content_ref = ?
        `)
        .run(now, contentRef);

      return { deleted: true, bytesReclaimed };
    });
  }

  // ==========================================================================
  // 3. AUDIT LEDGER EVENTS
  // ==========================================================================

  public appendLedgerEvent(event: {
    sequence: number;
    timestamp: string;
    actor: string;
    eventType: string;
    missionId: string;
    profileWorkspace: string;
    summary: string;
    contentRef: string;
    evidenceHash: string;
    previousHash: string;
    ownHash?: string;
    trustLevel: string;
    executionState?: string;
    verificationState?: string;
    isSimulated?: boolean;
    quarantined?: boolean;
    schemaVersion?: number;
  }): StoredLedgerEventRecord {
    this.checkOpen();
    const schemaVersion = event.schemaVersion || 2;
    const validation = validateCanonicalLedgerFields({
      ...event,
      schemaVersion,
      redactedSummary: event.summary,
      payloadReference: event.contentRef,
      payloadDigest: event.evidenceHash,
    });

    if (!validation.valid || !validation.canonicalFields) {
      throw new Error(`Cannot append invalid canonical ledger event: ${validation.errors.join('; ')}`);
    }

    const ownHash = event.ownHash || computeCanonicalLedgerHash(validation.canonicalFields);
    const id = `evt_${event.sequence + 1}_${ownHash.slice(0, 8)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO ledger_events (
        id, sequence, timestamp, actor, event_type, mission_id, profile_workspace,
        summary, content_ref, evidence_hash, previous_hash, own_hash,
        trust_level, execution_state, verification_state, is_simulated, quarantined,
        schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      validation.canonicalFields.sequence,
      validation.canonicalFields.timestamp,
      validation.canonicalFields.actor,
      validation.canonicalFields.eventType,
      validation.canonicalFields.mission,
      validation.canonicalFields.profileWorkspace,
      validation.canonicalFields.redactedSummary,
      validation.canonicalFields.payloadReference,
      validation.canonicalFields.payloadDigest,
      validation.canonicalFields.previousHash,
      ownHash,
      event.trustLevel,
      event.executionState || null,
      event.verificationState || null,
      event.isSimulated ? 1 : 0,
      event.quarantined ? 1 : 0,
      schemaVersion,
      now
    );

    return {
      id,
      ...validation.canonicalFields,
      summary: validation.canonicalFields.redactedSummary,
      contentRef: validation.canonicalFields.payloadReference,
      evidenceHash: validation.canonicalFields.payloadDigest,
      trustLevel: event.trustLevel,
      executionState: event.executionState,
      verificationState: event.verificationState,
      isSimulated: Boolean(event.isSimulated),
      quarantined: Boolean(event.quarantined),
      ownHash,
      createdAt: now,
    };
  }

  public getLedgerEvents(): StoredLedgerEventRecord[] {
    this.checkOpen();
    const rows = this.db
      .prepare('SELECT * FROM ledger_events ORDER BY sequence ASC')
      .all() as any[];

    return rows.map((r) => ({
      id: r.id,
      sequence: Number(r.sequence),
      timestamp: r.timestamp,
      actor: r.actor,
      eventType: r.event_type,
      mission: r.mission_id,
      profileWorkspace: r.profile_workspace,
      redactedSummary: r.summary,
      summary: r.summary,
      payloadReference: r.content_ref,
      contentRef: r.content_ref,
      payloadDigest: r.evidence_hash,
      evidenceHash: r.evidence_hash,
      previousHash: r.previous_hash,
      ownHash: r.own_hash,
      trustLevel: r.trust_level,
      executionState: r.execution_state || undefined,
      verificationState: r.verification_state || undefined,
      isSimulated: Boolean(r.is_simulated),
      quarantined: Boolean(r.quarantined),
      schemaVersion: Number(r.schema_version),
      createdAt: r.created_at,
    }));
  }

  // ==========================================================================
  // 4. VAULT METADATA & PERSISTED ENCRYPTED SECRETS
  // ==========================================================================

  public storeVaultSecret(
    meta: {
      keyId: string;
      label: string;
      provider: string;
      maskedPreview: string;
      lastFour: string;
      backendKind: string;
      spendCapUsd?: number;
      spentUsd?: number;
      rateLimitPerMinute?: number;
      alertThresholdPct?: number;
    },
    secretEnvelope: {
      saltHex: string;
      ivHex: string;
      ciphertextHex: string;
      authTagHex: string;
      algorithm?: string;
    }
  ): void {
    this.checkOpen();
    const now = new Date().toISOString();
    this.transaction(() => {
      // 1. Upsert vault_metadata
      const metaStmt = this.db.prepare(`
        INSERT INTO vault_metadata (
          key_id, label, provider, masked_preview, last_four, backend_kind,
          spend_cap_usd, spent_usd, rate_limit_per_minute, requests_in_current_window,
          alert_threshold_pct, alert_triggered, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)
        ON CONFLICT(key_id) DO UPDATE SET
          label = excluded.label,
          provider = excluded.provider,
          masked_preview = excluded.masked_preview,
          last_four = excluded.last_four,
          backend_kind = excluded.backend_kind,
          spend_cap_usd = excluded.spend_cap_usd,
          rate_limit_per_minute = excluded.rate_limit_per_minute,
          alert_threshold_pct = excluded.alert_threshold_pct,
          updated_at = excluded.updated_at
      `);
      metaStmt.run(
        meta.keyId,
        meta.label,
        meta.provider,
        meta.maskedPreview,
        meta.lastFour,
        meta.backendKind,
        meta.spendCapUsd ?? 10.0,
        meta.spentUsd ?? 0.0,
        meta.rateLimitPerMinute ?? 30,
        meta.alertThresholdPct ?? 80.0,
        now,
        now
      );

      // 2. Upsert encrypted_secrets
      const secretStmt = this.db.prepare(`
        INSERT INTO encrypted_secrets (
          key_id, salt_hex, iv_hex, ciphertext_hex, auth_tag_hex, algorithm, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key_id) DO UPDATE SET
          salt_hex = excluded.salt_hex,
          iv_hex = excluded.iv_hex,
          ciphertext_hex = excluded.ciphertext_hex,
          auth_tag_hex = excluded.auth_tag_hex,
          algorithm = excluded.algorithm
      `);
      secretStmt.run(
        meta.keyId,
        secretEnvelope.saltHex,
        secretEnvelope.ivHex,
        secretEnvelope.ciphertextHex,
        secretEnvelope.authTagHex,
        secretEnvelope.algorithm || 'aes-256-gcm',
        now
      );
    });
  }

  public getVaultSecret(keyId: string): {
    meta: any;
    secret: {
      saltHex: string;
      ivHex: string;
      ciphertextHex: string;
      authTagHex: string;
      algorithm: string;
    };
  } | null {
    this.checkOpen();
    const meta = this.db.prepare('SELECT * FROM vault_metadata WHERE key_id = ?').get(keyId) as any;
    if (!meta) return null;
    const secret = this.db.prepare('SELECT * FROM encrypted_secrets WHERE key_id = ?').get(keyId) as any;
    if (!secret) return null;
    return {
      meta: {
        keyId: meta.key_id,
        label: meta.label,
        provider: meta.provider,
        maskedPreview: meta.masked_preview,
        lastFour: meta.last_four,
        backendKind: meta.backend_kind,
        spendCapUsd: meta.spend_cap_usd,
        spentUsd: meta.spent_usd,
        rateLimitPerMinute: meta.rate_limit_per_minute,
        requestsInCurrentWindow: meta.requests_in_current_window,
        alertThresholdPct: meta.alert_threshold_pct,
        alertTriggered: Boolean(meta.alert_triggered),
        createdAtIso: meta.created_at,
        updatedAtIso: meta.updated_at,
      },
      secret: {
        saltHex: secret.salt_hex,
        ivHex: secret.iv_hex,
        ciphertextHex: secret.ciphertext_hex,
        authTagHex: secret.auth_tag_hex,
        algorithm: secret.algorithm,
      },
    };
  }

  public listVaultMasked(): any[] {
    this.checkOpen();
    const rows = this.db.prepare('SELECT * FROM vault_metadata ORDER BY created_at ASC').all() as any[];
    return rows.map((meta) => ({
      keyId: meta.key_id,
      label: meta.label,
      provider: meta.provider,
      maskedPreview: meta.masked_preview,
      lastFour: meta.last_four,
      backendKind: meta.backend_kind,
      spendCapUsd: meta.spend_cap_usd,
      spentUsd: meta.spent_usd,
      rateLimitPerMinute: meta.rate_limit_per_minute,
      requestsInCurrentWindow: meta.requests_in_current_window,
      alertThresholdPct: meta.alert_threshold_pct,
      alertTriggered: Boolean(meta.alert_triggered),
      createdAtIso: meta.created_at,
      updatedAtIso: meta.updated_at,
    }));
  }

  public deleteVaultSecret(keyId: string): boolean {
    this.checkOpen();
    // Cascades delete to encrypted_secrets via foreign key
    const res = this.db.prepare('DELETE FROM vault_metadata WHERE key_id = ?').run(keyId);
    return res.changes > 0;
  }

  // ==========================================================================
  // 5. BLOBS
  // ==========================================================================

  public setBlob(id: string, mimeType: string, dataBase64: string): void {
    this.checkOpen();
    const sizeBytes = Buffer.byteLength(dataBase64, 'base64');
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO blobs (id, mime_type, size_bytes, data_base64, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        data_base64 = excluded.data_base64
    `);
    stmt.run(id, mimeType, sizeBytes, dataBase64, now);
  }

  public getBlob(id: string): { id: string; mimeType: string; sizeBytes: number; dataBase64: string } | null {
    this.checkOpen();
    const row = this.db.prepare('SELECT * FROM blobs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      dataBase64: row.data_base64,
    };
  }

  public deleteBlob(id: string): boolean {
    this.checkOpen();
    const res = this.db.prepare('DELETE FROM blobs WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ==========================================================================
  // 6. BACKUP & RESTORE
  // ==========================================================================

  /**
   * Backs up database cleanly using WAL checkpoint or file copy.
   */
  public async backup(destinationPath: string): Promise<void> {
    this.checkOpen();
    if (this.dbPath === ':memory:') {
      throw new Error('Cannot backup in-memory database to file via filesystem copy.');
    }
    // Checkpoint WAL first
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // Ignore
    }

    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(this.dbPath, destinationPath);
  }

  public close(): void {
    if (!this.isClosed) {
      try {
        this.db.close();
      } catch {
        // Ignore
      }
      this.isClosed = true;
    }
  }

  private checkOpen(): void {
    if (this.isClosed) {
      throw new Error('DurableSqliteDatabase is closed.');
    }
  }
}

// Global default singleton instance for applet server runtime
let defaultDurableDb: DurableSqliteDatabase | null = null;

export function getGlobalDurableDb(customPath?: string): DurableSqliteDatabase {
  if (!defaultDurableDb) {
    const dbPath = customPath || process.env.BLAIZE_SQLITE_PATH || path.join(process.cwd(), '.blaize', 'blaize.sqlite');
    defaultDurableDb = new DurableSqliteDatabase(dbPath);
  }
  return defaultDurableDb;
}
