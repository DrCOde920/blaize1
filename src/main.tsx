import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initClientApiInterceptor } from './utils/api_client';
import { buildDefaultPersistedSnapshot, migratePersistedSnapshot } from './packages/runtime';

initClientApiInterceptor();


async function readLegacyActiveCharacterPack(): Promise<any | null> {
  if (!window.indexedDB) return null;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = window.indexedDB.open('blaize_character_packs_db', 1); }
    catch { resolve(null); return; }
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('active_pack')) { db.close(); resolve(null); return; }
      try {
        const tx = db.transaction('active_pack', 'readonly');
        const get = tx.objectStore('active_pack').get('current_active_pack');
        get.onsuccess = () => { const manifest = get.result?.manifest || null; db.close(); resolve(manifest); };
        get.onerror = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  });
}

async function deleteLegacyActiveCharacterPack(): Promise<void> {
  if (!window.indexedDB) return;
  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = window.indexedDB.open('blaize_character_packs_db', 1); }
    catch { resolve(); return; }
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('active_pack')) { db.close(); resolve(); return; }
      try {
        const tx = db.transaction('active_pack', 'readwrite');
        tx.objectStore('active_pack').delete('current_active_pack');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); resolve(); };
      } catch { db.close(); resolve(); }
    };
  });
}

async function bootstrapDesktopPersistence(): Promise<void> {
  const api = window.electronAPI;
  if (api?.isElectron) {
    try {
      const [snapshotRecord, prefsRecord, recordingRecord, skillsRecord, artifactsRecord, characterPackRecord] = await Promise.all([
        api.storage.getRecord('workspace_snapshot', 'v2'),
        api.storage.getRecord('ui_preferences', 'ui'),
        api.storage.getRecord('recorder_sessions', 'active'),
        api.storage.getRecord('recorder_skills', 'current'),
        api.storage.getRecord('universal_artifacts', 'current'),
        api.storage.getRecord('character_packs', 'current_active_pack'),
      ]);
      let snapshot = (snapshotRecord?.data?.snapshot as any) || null;
      if (!snapshot) {
        // One-time migration from older desktop builds. SQLite wins after this import.
        try {
          const legacy = window.localStorage.getItem('blaize_persisted_snapshot_v2');
          if (legacy) {
            snapshot = migratePersistedSnapshot(JSON.parse(legacy));
            await api.storage.putRecord('workspace_snapshot', { id: 'v2', collection: 'workspace_snapshot', data: { snapshot }, createdAt: Date.now(), updatedAt: Date.now() });
            window.localStorage.removeItem('blaize_persisted_snapshot_v2');
          }
        } catch { /* use a fresh default below */ }
      }
      window.__BLAIZE_BOOTSTRAP_SNAPSHOT__ = migratePersistedSnapshot(snapshot || buildDefaultPersistedSnapshot());

      const storedValues = (prefsRecord?.data?.values && typeof prefsRecord.data.values === 'object')
        ? { ...(prefsRecord.data.values as Record<string, unknown>) } : {};
      let importedLegacyPreference = false;
      const companionPreferenceKeys = [
        'blaize_perch_by_page_v1', 'blaize_morrow_free_position_v1',
        'blaize_morrow_collapsed_dot_v1', 'blaize_companion_scale_pct_v1',
      ];
      for (const key of companionPreferenceKeys) {
        if (Object.prototype.hasOwnProperty.call(storedValues, key)) continue;
        try {
          const raw = window.localStorage.getItem(key);
          if (raw === null) continue;
          try { storedValues[key] = JSON.parse(raw); } catch { storedValues[key] = raw; }
          importedLegacyPreference = true;
          window.localStorage.removeItem(key);
        } catch { /* skip inaccessible legacy entry */ }
      }
      if (!prefsRecord) {
        const legacyValues: Record<string, unknown> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key?.startsWith('blaize_pref_')) continue;
          try { legacyValues[key.slice('blaize_pref_'.length)] = JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { /* skip malformed */ }
        }
        // Voice toggle predates the namespaced preference helper.
        try {
          const legacyVoice = window.localStorage.getItem('blaize_morrow_voice_enabled_v1');
          if (legacyVoice !== null && legacyValues.morrow_voice_enabled_v1 === undefined) {
            legacyValues.morrow_voice_enabled_v1 = JSON.parse(legacyVoice);
          }
        } catch { /* skip malformed legacy value */ }
        if (Object.keys(legacyValues).length) {
          Object.assign(storedValues, legacyValues);
          await api.storage.putRecord('ui_preferences', { id: 'ui', collection: 'ui_preferences', data: { values: storedValues }, createdAt: Date.now(), updatedAt: Date.now() });
        }
      }
      if (importedLegacyPreference) {
        await api.storage.putRecord('ui_preferences', { id: 'ui', collection: 'ui_preferences', data: { values: storedValues }, createdAt: Date.now(), updatedAt: Date.now() });
      }
      window.__BLAIZE_BOOTSTRAP_PREFS__ = storedValues;
      window.__BLAIZE_RUNTIME_PREFS__ = { ...storedValues };
      const recoveredSession = (recordingRecord?.data?.session as any) || null;
      if (recoveredSession && !recoveredSession.endedAt) {
        recoveredSession.endedAt = new Date().toISOString();
        recoveredSession.recoveryNote = 'Recording was closed after the app restarted; no live screen stream was resumed.';
        await api.storage.putRecord('recorder_sessions', {
          id: recoveredSession.id, collection: 'recorder_sessions', data: { session: recoveredSession },
          createdAt: Date.parse(recoveredSession.startedAt) || Date.now(), updatedAt: Date.now(),
        });
        await api.storage.deleteRecord('recorder_sessions', 'active');
      }
      window.__BLAIZE_BOOTSTRAP_ACTIVE_RECORDING__ = recoveredSession;
      window.__BLAIZE_BOOTSTRAP_RECORDED_SKILLS__ = Array.isArray(skillsRecord?.data?.skills) ? skillsRecord.data.skills : null;
      window.__BLAIZE_BOOTSTRAP_ARTIFACTS__ = Array.isArray(artifactsRecord?.data?.items) ? artifactsRecord.data.items : null;
      let characterPackManifest = characterPackRecord?.data?.manifest || null;
      if (!characterPackManifest) {
        const legacyPack = await readLegacyActiveCharacterPack();
        if (legacyPack) {
          await api.storage.putRecord('character_packs', { id: 'current_active_pack', collection: 'character_packs', data: { manifest: legacyPack }, createdAt: Date.now(), updatedAt: Date.now() });
          characterPackManifest = legacyPack;
          await deleteLegacyActiveCharacterPack();
        }
      }
      window.__BLAIZE_BOOTSTRAP_CHARACTER_PACK__ = characterPackManifest;
    } catch (error) {
      console.error('Blaize SQLite bootstrap failed; desktop persistence could not be confirmed.', error);
      window.__BLAIZE_BOOTSTRAP_SNAPSHOT__ = buildDefaultPersistedSnapshot();
    }
  }
  createRoot(document.getElementById('root')!).render(<App />);
}

void bootstrapDesktopPersistence();
