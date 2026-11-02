/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Versioned SQLite Migrations for Blaize Durable Storage (`src/packages/storage/migrations.ts`)
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: any) => void;
  down?: (db: any) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_durable_schema',
    up: (db: any) => {
      // 1. Ledger Events (Hash-Chained Audit Ledger)
      db.exec(`
        CREATE TABLE IF NOT EXISTS ledger_events (
          id TEXT PRIMARY KEY,
          sequence INTEGER UNIQUE NOT NULL,
          timestamp TEXT NOT NULL,
          actor TEXT NOT NULL,
          event_type TEXT NOT NULL,
          mission_id TEXT NOT NULL,
          profile_workspace TEXT NOT NULL,
          summary TEXT NOT NULL,
          content_ref TEXT NOT NULL,
          evidence_hash TEXT NOT NULL,
          previous_hash TEXT NOT NULL,
          own_hash TEXT NOT NULL,
          trust_level TEXT NOT NULL,
          execution_state TEXT,
          verification_state TEXT,
          is_simulated INTEGER NOT NULL DEFAULT 0,
          quarantined INTEGER NOT NULL DEFAULT 0,
          schema_version INTEGER NOT NULL DEFAULT 2,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_events_sequence ON ledger_events(sequence);
        CREATE INDEX IF NOT EXISTS idx_ledger_events_mission ON ledger_events(mission_id);
        CREATE INDEX IF NOT EXISTS idx_ledger_events_content_ref ON ledger_events(content_ref);
      `);

      // 2. Encrypted Content (Content-Addressable AES-256-GCM Payloads)
      db.exec(`
        CREATE TABLE IF NOT EXISTS encrypted_content (
          content_ref TEXT PRIMARY KEY,
          iv_hex TEXT NOT NULL,
          ciphertext_hex TEXT NOT NULL,
          auth_tag_hex TEXT NOT NULL,
          byte_length INTEGER NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'application/json',
          deleted INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          created_at TEXT NOT NULL
        );
      `);

      // 3. Generic Storage Records (Electron & Application Collections)
      db.exec(`
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY,
          collection TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);
      `);

      // 4. Real SQLite FTS5 Full-Text Search Virtual Table
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_records USING fts5(
          record_id UNINDEXED,
          collection,
          title,
          content
        );
      `);

      // 5. Vault Metadata & Encrypted Secrets (Foreign key with cascade delete)
      db.exec(`
        CREATE TABLE IF NOT EXISTS vault_metadata (
          key_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          provider TEXT NOT NULL,
          masked_preview TEXT NOT NULL,
          last_four TEXT NOT NULL,
          backend_kind TEXT NOT NULL,
          spend_cap_usd REAL NOT NULL DEFAULT 10.0,
          spent_usd REAL NOT NULL DEFAULT 0.0,
          rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
          requests_in_current_window INTEGER NOT NULL DEFAULT 0,
          alert_threshold_pct REAL NOT NULL DEFAULT 80.0,
          alert_triggered INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS encrypted_secrets (
          key_id TEXT PRIMARY KEY,
          salt_hex TEXT NOT NULL,
          iv_hex TEXT NOT NULL,
          ciphertext_hex TEXT NOT NULL,
          auth_tag_hex TEXT NOT NULL,
          algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
          created_at TEXT NOT NULL,
          FOREIGN KEY (key_id) REFERENCES vault_metadata(key_id) ON DELETE CASCADE
        );
      `);

      // 6. Blobs
      db.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
          id TEXT PRIMARY KEY,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          data_base64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // 7. Skills & Plugins
      db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          is_compiled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);

      // 8. Schedules & Jobs
      db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          task_json TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          schedule_id TEXT,
          status TEXT NOT NULL,
          result_json TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
        );
      `);

      // 9. App Profiles & Character Packs (Demo identity isolated)
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          is_demo INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS character_packs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          pack_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // 10. Model Usage Records
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_usage_records (
          id TEXT PRIMARY KEY,
          mission_id TEXT,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          estimated_cost_usd REAL NOT NULL,
          timestamp TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_model_usage_timestamp ON model_usage_records(timestamp);
      `);
    },
    down: (db: any) => {
      db.exec(`
        DROP TABLE IF EXISTS model_usage_records;
        DROP TABLE IF EXISTS character_packs;
        DROP TABLE IF EXISTS app_profiles;
        DROP TABLE IF EXISTS jobs;
        DROP TABLE IF EXISTS schedules;
        DROP TABLE IF EXISTS plugins;
        DROP TABLE IF EXISTS skills;
        DROP TABLE IF EXISTS blobs;
        DROP TABLE IF EXISTS encrypted_secrets;
        DROP TABLE IF EXISTS vault_metadata;
        DROP TABLE IF EXISTS fts_records;
        DROP TABLE IF EXISTS records;
        DROP TABLE IF EXISTS encrypted_content;
        DROP TABLE IF EXISTS ledger_events;
      `);
    },
  },
];
