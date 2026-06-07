// AYCB Studio — Browser storage cleanup (PAO-only)
//
// Wipes IDB + localStorage of everything not tied to the 6 PAO_* projects.
// Idempotent — safe to re-run.
//
// Backup taken at: shared/backups/2026-05-19_143137/
// Server-side canvas_backups already cleaned (24 folders removed).
//
// Usage: paste into DevTools Console at http://localhost:5100, then reload.
//
// Expected output:
//   [1/4] PAO kept: 6, mediaIds: ~964, to delete: 31
//   [2/4] deleted 31 projects from IDB
//   [3/4] deleted 205 blobs + 3538 thumbs
//   [4/4] localStorage: 5119.0 KB -> ~1325.0 KB  (-3794.0 KB)
//         bridge_stems: 3675 -> 665    media_meta: 500 -> 500
//   Browser storage: X MB used / Y MB quota
//   [done] reload the page (Ctrl+R) to refresh frontend state

(async () => {
  const PAO_IDS = new Set([
    'proj-1778444987700-snhp3a', // Pao_tmp
    'proj-1778759159216-tqkbk9', // PAO_prod
    'proj-1778864377827-9weuzj', // PAO_01
    'proj-1778865931999-p2tfzf', // PAO_01_Brushes
    'proj-1779061316364-x70qy5', // PAO_acting
    'proj-1779138241272-xd3fu1', // PAO_reframe
  ]);
  const open = n => new Promise((r, j) => { const q = indexedDB.open(n); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });

  // 1. Read all projects, collect PAO mediaIds, mark non-PAO for delete
  const projDb = await open('geminishot_projects');
  const all = await new Promise((r, j) => { const t = projDb.transaction('projects', 'readonly'); const q = t.objectStore('projects').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const keepMedia = new Set();
  const toDeleteIds = [];
  for (const p of all) {
    if (PAO_IDS.has(p.id)) {
      for (const m of p.mediaIds ?? []) keepMedia.add(m);
      for (const n of p.canvas?.nodes ?? []) {
        const d = n.data ?? {};
        if (typeof d.mediaId === 'string') keepMedia.add(d.mediaId);
        for (const k of ['historyIds', 'frameIds']) {
          if (Array.isArray(d[k])) for (const x of d[k]) if (typeof x === 'string') keepMedia.add(x);
        }
      }
    } else {
      toDeleteIds.push(p.id);
    }
  }
  console.log(`[1/4] PAO kept: ${PAO_IDS.size}, mediaIds: ${keepMedia.size}, to delete: ${toDeleteIds.length}`);

  // 2. Delete non-PAO projects
  await new Promise((r, j) => { const t = projDb.transaction('projects', 'readwrite'); const s = t.objectStore('projects'); for (const id of toDeleteIds) s.delete(id); t.oncomplete = () => r(); t.onerror = () => j(t.error); });
  projDb.close();
  console.log(`[2/4] deleted ${toDeleteIds.length} projects from IDB`);

  // 3. Prune media (blobs + thumbs)
  const medDb = await open('geminishot_media');
  async function prune(store) {
    const keys = await new Promise((r, j) => { const t = medDb.transaction(store, 'readonly'); const q = t.objectStore(store).getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const del = keys.filter(k => !keepMedia.has(k));
    if (!del.length) return 0;
    await new Promise((r, j) => { const t = medDb.transaction(store, 'readwrite'); const s = t.objectStore(store); for (const k of del) s.delete(k); t.oncomplete = () => r(); t.onerror = () => j(t.error); });
    return del.length;
  }
  const blobsDel = await prune('blobs');
  const thumbsDel = await prune('thumbs');
  medDb.close();
  console.log(`[3/4] deleted ${blobsDel} blobs + ${thumbsDel} thumbs`);

  // 4. localStorage
  const before = Object.entries(localStorage).reduce((s, [, v]) => s + v.length, 0);
  let lsFreed = 0;
  for (const k of ['aycb_presets', 'aycb_user_templates']) {
    const v = localStorage.getItem(k);
    if (v != null) { lsFreed += v.length; localStorage.removeItem(k); }
  }
  function filterMap(key) {
    try {
      const obj = JSON.parse(localStorage.getItem(key) ?? '{}');
      const kept = {};
      for (const [k, v] of Object.entries(obj)) if (keepMedia.has(k)) kept[k] = v;
      localStorage.setItem(key, JSON.stringify(kept));
      return [Object.keys(obj).length, Object.keys(kept).length];
    } catch (e) { return [0, 0]; }
  }
  const [bsB, bsA] = filterMap('aycb_bridge_stems');
  const [mmB, mmA] = filterMap('aycb_media_meta');
  try {
    const ui = JSON.parse(localStorage.getItem('aycb_ui') ?? '{}');
    if (ui.state) { ui.state.costs = []; localStorage.setItem('aycb_ui', JSON.stringify(ui)); }
  } catch (e) { /* ignore */ }
  const after = Object.entries(localStorage).reduce((s, [, v]) => s + v.length, 0);
  console.log(`[4/4] localStorage: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB  (-${((before - after) / 1024).toFixed(1)} KB)`);
  console.log(`      bridge_stems: ${bsB} -> ${bsA}    media_meta: ${mmB} -> ${mmA}`);

  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    console.log(`Browser storage: ${(e.usage / 1024 / 1024).toFixed(1)} MB used / ${(e.quota / 1024 / 1024).toFixed(0)} MB quota`);
  }
  console.log('[done] reload the page (Ctrl+R) to refresh frontend state');
})();
