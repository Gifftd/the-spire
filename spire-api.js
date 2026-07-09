// ═══════════════════════════════════════════════════════════════
//  spire-api.js — shared Worker fetch helpers.
//
//  Load AFTER auth.js (depends on window.Auth):
//    <script src="auth.js?v=2"></script>
//    <script src="spire-api.js?v=1"></script>
//
//  Exposes window.API:
//    WORKER_URL          — canonical Worker endpoint (from Auth)
//    get(type)           — anonymous GET, throws on !ok
//    dmGet(type)         — DM-authenticated GET, throws on !ok
//    dmPost(type, payload) — DM-authenticated POST; never throws,
//                            returns { ok, status, body }
//
//  Non-standard POST shapes (auth flows, crucible runs) should keep
//  using raw fetch — don't force-fit them through these helpers.
// ═══════════════════════════════════════════════════════════════
(function () {
  const WORKER_URL = (window.Auth && window.Auth.WORKER_URL)
    || 'https://dnd-perk-webhook.jacobgiff.workers.dev/';

  async function get(type) {
    const res = await fetch(`${WORKER_URL}?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`GET ${type} failed: HTTP ${res.status}`);
    return res.json();
  }

  async function dmGet(type) {
    const res = await fetch(`${WORKER_URL}?type=${encodeURIComponent(type)}`, {
      cache: 'no-store',
      headers: Auth.dmHeaders(),
    });
    if (!res.ok) {
      const err = new Error(`GET ${type} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function dmPost(type, payload) {
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: Auth.dmHeaders(),
        body: JSON.stringify({ type, payload }),
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: e.message } };
    }
  }

  // Merge-before-write for whole-blob array keys (`npcs`, `timeline`).
  // KV writes are last-write-wins; two DM tabs can silently clobber each
  // other. This re-fetches the remote array right before POSTing and merges
  // by id: local wins for every id it contains, remote-only records are
  // kept (they were added elsewhere), and `deletedIds` are dropped
  // explicitly (otherwise a concurrent tab's copy would resurrect them).
  //
  //   const { ok, merged } = await API.dmPostMerged('npcs', 'npcs', npcs, { deletedIds });
  //   if (ok) npcs = merged;   // adopt the merge so the tab sees remote adds
  //
  // getType differs from postType for the timeline ('timeline_dm' reads the
  // full DM array; 'timeline' is the write type).
  // Pure merge: local wins by id, remote-only records kept, deletedIds
  // dropped. Ids compared as strings (numeric-id boundary rule).
  function mergeById(remote, local, deletedIds) {
    const deleted = new Set((deletedIds || []).map(String));
    const localById = new Map(local.map(x => [String(x.id), x]));
    const out = [];
    const seen = new Set();
    for (const r of remote) {
      const id = String(r.id);
      if (deleted.has(id)) continue;
      if (localById.has(id)) { out.push(localById.get(id)); seen.add(id); }
      else out.push(r);
    }
    for (const l of local) {
      const id = String(l.id);
      if (!seen.has(id) && !deleted.has(id)) out.push(l);
    }
    return out;
  }

  async function dmPostMerged(postType, getType, localArray, opts) {
    let merged = localArray;
    try {
      const remote = await dmGet(getType);
      if (Array.isArray(remote)) merged = mergeById(remote, localArray, (opts && opts.deletedIds) || []);
    } catch { /* re-fetch failed — post the local array as-is */ }
    const res = await dmPost(postType, merged);
    return { ...res, merged };
  }

  window.API = { WORKER_URL, get, dmGet, dmPost, dmPostMerged, mergeById };
})();
