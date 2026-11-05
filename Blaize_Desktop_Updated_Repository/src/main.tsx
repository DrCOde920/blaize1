import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initClientApiInterceptor } from './utils/api_client';
import { buildDefaultPersistedSnapshot, migratePersistedSnapshot } from './packages/runtime';

initClientApiInterceptor();

async function bootstrapDesktopPersistence(): Promise<void> {
  const api = window.electronAPI;
  if (api?.isElectron) {
    try {
      const [snapshotRecord, prefsRecord, recordingRecord, skillsRecord] = await Promise.all([
        api.storage.getRecord('workspace_snapshot', 'v2'),
        api.storage.getRecord('ui_preferences', 'ui'),
        api.storage.getRecord('recorder_sessions', 'active'),
        api.storage.getRecord('recorder_skills', 'current'),
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
    } catch (error) {
      console.error('Blaize SQLite bootstrap failed; desktop persistence could not be confirmed.', error);
      window.__BLAIZE_BOOTSTRAP_SNAPSHOT__ = buildDefaultPersistedSnapshot();
    }
  }
  createRoot(document.getElementById('root')!).render(<App />);
}

void bootstrapDesktopPersistence();
