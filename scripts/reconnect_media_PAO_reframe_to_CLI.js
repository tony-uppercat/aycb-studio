// AYCB Studio — Reconnect studio media for project "PAO_reframe_to_CLI"
//
// Why: enforceStorageCap (mediaStore.ts) evicts the OLDEST IndexedDB blobs
// globally across all projects, reference-blind. Heavy generation in newer
// projects silently deleted this project's studio blobs, so its canvas nodes
// show broken images. The bridged PNGs are SAFE on disk in
// shared/Media/PAO_reframe_to_CLI/ — this re-imports them back into IDB.
//
// How it maps disk -> node: the only deterministic link is the localStorage
// map `aycb_bridge_stems` (mediaId -> "generated_<ts>"). Disk files carry NO
// mediaId. So a node is restorable only if its mediaId still has a stem entry.
//
// Usage:
//   1. Open the studio at http://localhost:5100 (any project — script targets
//      PAO_reframe_to_CLI by id, no need to switch to it).
//   2. Paste this whole file into the DevTools Console. First run is a DRY RUN:
//      it only reports. Nothing is written.
//   3. Read the report. To actually restore, set APPLY = true (line below) and
//      paste again. Idempotent — existing blobs are skipped.
//   4. Reload (Ctrl+R) so nodes re-read IDB.

(async () => {
  const APPLY = true;                               // <-- set true to write blobs
  const PROJECT_ID = 'proj-1779207005835-ik3jy4';
  const FOLDER = 'PAO_reframe_to_CLI';
  const STEM_MAP_KEY = 'aycb_bridge_stems';

  const open = n => new Promise((res, rej) => {
    const q = indexedDB.open(n); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const req = (db, store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
  });

  // ── 1. Load the project record ──────────────────────────────────────────────
  const projDb = await open('geminishot_projects');
  const project = await new Promise((res, rej) => {
    const t = projDb.transaction('projects', 'readonly');
    const r = t.objectStore('projects').get(PROJECT_ID);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  if (!project) { console.error(`[reconnect] project ${PROJECT_ID} not found in IDB`); projDb.close(); return; }
  console.log(`[reconnect] project "${project.name}" (${PROJECT_ID})`);

  // ── 2. Collect every referenced mediaId, recursing into subnets ─────────────
  //    Also build mediaId -> prompt (from the owning node) for diagnostics on
  //    anything the stem map can't resolve.
  const referenced = new Set();
  const promptOf = {};
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      const d = n.data ?? {};
      const ids = [];
      if (typeof d.mediaId === 'string') ids.push(d.mediaId);
      for (const k of ['historyIds', 'frameIds'])
        if (Array.isArray(d[k])) for (const x of d[k]) if (typeof x === 'string') ids.push(x);
      for (const id of ids) {
        referenced.add(id);
        const p = d.activePrompt ?? d.prompt ?? d.text;
        if (typeof p === 'string' && p && !promptOf[id]) promptOf[id] = p;
      }
      if (n.type === 'subnet' && d.sub_graph) walk(d.sub_graph.nodes);
    }
  };
  walk(project.canvas?.nodes);
  for (const m of project.mediaIds ?? []) referenced.add(m);
  console.log(`[reconnect] referenced mediaIds: ${referenced.size}`);

  // ── 3. Which referenced blobs are actually MISSING from IDB ──────────────────
  const medDb = await open('geminishot_media');
  const existing = new Set(await req(medDb, 'blobs', 'readonly', s => s.getAllKeys()));
  const missing = [...referenced].filter(id => !existing.has(id));
  console.log(`[reconnect] missing blobs: ${missing.length} (of ${referenced.size} referenced)`);

  // ── 4. Split missing by stem-map resolvability ──────────────────────────────
  let stemMap = {};
  try { stemMap = JSON.parse(localStorage.getItem(STEM_MAP_KEY) ?? '{}'); } catch {}
  const resolvable = [];      // { mediaId, stem }
  const unresolvable = [];    // mediaId (no stem entry — can't map deterministically)
  for (const id of missing) {
    const stem = stemMap[id];
    if (typeof stem === 'string' && stem) resolvable.push({ mediaId: id, stem });
    else unresolvable.push(id);
  }

  // ── 5. Cross-check against what's on disk (ALL folders, not just this one) ───
  //    A node's stem may point to a file bridged under a DIFFERENT project
  //    folder (shared graph, copied nodes). So resolve each stem's real
  //    folder+filename from the global media list — never assume FOLDER.
  const byStem = new Map();   // stem -> { path, filename, type }
  let diskStems = new Set();  // stems in THIS project's folder (for orphan count)
  try {
    const list = await (await fetch('/api/bridge/media/list')).json();
    for (const e of list) {
      if (!byStem.has(e.id)) byStem.set(e.id, { path: e.path, filename: e.filename, type: e.type });
      if (e.project === FOLDER && String(e.type).startsWith('image/')) diskStems.add(e.id);
    }
  } catch (e) { console.warn('[reconnect] could not fetch /api/bridge/media/list:', e); }
  const usedStems = new Set(resolvable.map(r => r.stem));
  const orphanDiskStems = [...diskStems].filter(s => !usedStems.has(s)); // in this folder, not linked to a broken node
  const restorableOnDisk = resolvable.filter(r => byStem.has(r.stem));    // stem hit AND file exists somewhere
  const stemButNoFile = resolvable.filter(r => !byStem.has(r.stem));      // stem hit but file gone from disk too

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('--------------------------------------------------------');
  console.log(`  stem-map hits:                   ${resolvable.length}`);
  console.log(`    restorable NOW (file on disk): ${restorableOnDisk.length}`);
  console.log(`    stem known but file gone:      ${stemButNoFile.length}`);
  console.log(`  unresolvable (no stem entry):    ${unresolvable.length}`);
  console.log(`  disk imgs in this folder:        ${diskStems.size}`);
  console.log(`    not linked to any node:        ${orphanDiskStems.length}`);
  console.log('--------------------------------------------------------');
  if (unresolvable.length) {
    console.log('[reconnect] unresolvable mediaIds (prompt preview for a future fuzzy pass):');
    for (const id of unresolvable.slice(0, 40))
      console.log(`   ${id}  ::  ${(promptOf[id] ?? '(no prompt on node)').slice(0, 80)}`);
    if (unresolvable.length > 40) console.log(`   ...and ${unresolvable.length - 40} more`);
  }

  if (!APPLY) {
    console.log('[reconnect] DRY RUN — nothing written. Set APPLY = true and paste again to restore.');
    projDb.close(); medDb.close(); return;
  }

  // ── 6. APPLY: fetch each resolvable disk PNG and put it back under its mediaId ─
  //    8 workers pull from a shared queue. Progress logs every 20 so you can
  //    SEE it finish — do NOT reload until the DONE line prints, or in-flight
  //    fetches are killed and nothing commits.
  let ok = 0, fail = 0, done = 0;
  const restoredIds = [];
  const queue = [...resolvable];
  const total = queue.length;
  console.log(`[reconnect] APPLY: fetching ${total} files (8 at a time)...`);
  async function worker() {
    while (queue.length) {
      const { mediaId, stem } = queue.shift();
      const hit = byStem.get(stem);
      if (hit) {
        try {
          const r = await fetch(`/api/bridge/media/file/${hit.path}/${hit.filename}`);
          if (r.ok) {
            const blob = await r.blob();
            await new Promise((res, rej) => {
              const t = medDb.transaction('blobs', 'readwrite');
              t.objectStore('blobs').put({ blob, name: hit.filename, type: hit.type || blob.type || 'image/png' }, mediaId);
              t.oncomplete = () => res(); t.onerror = () => rej(t.error);
            });
            restoredIds.push(mediaId); ok++;
          } else { console.warn(`[reconnect] ${hit.filename} -> HTTP ${r.status}`); fail++; }
        } catch (e) { console.warn(`[reconnect] ${stem} failed:`, e); fail++; }
      } else { fail++; } // stem known but no file anywhere on disk
      done++;
      if (done % 20 === 0 || done === total) console.log(`[reconnect] progress ${done}/${total} (ok ${ok}, fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  // ── 7. Ensure restored ids are registered in the project (gallery consistency) ─
  const have = new Set(project.mediaIds ?? []);
  const addToProject = restoredIds.filter(id => !have.has(id));
  if (addToProject.length) {
    project.mediaIds = [...(project.mediaIds ?? []), ...addToProject];
    await new Promise((res, rej) => {
      const t = projDb.transaction('projects', 'readwrite');
      t.objectStore('projects').put(project);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  }

  console.log(`[reconnect] DONE — restored ${ok} blob(s), ${fail} failed, +${addToProject.length} into project.mediaIds`);
  console.log('[reconnect] reload the page (Ctrl+R) to refresh node previews.');
  projDb.close(); medDb.close();
})();
