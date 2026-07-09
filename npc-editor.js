// ═══════════════════════════════════════════════════════════════
//  npc-editor.js — the ONE NPC editor, shared by the Atlas
//  Workshop (map-dm.html right inspector) and the Chronicle
//  Workshop (sessions-dm.html modal). Full model everywhere:
//  name, role, status, currentLocationId, currentActivity,
//  description, notes, dmNotes, knownTo, tags, history.
//
//  Load AFTER auth.js + spire-ui.js:
//    <script src="npc-editor.js?v=1"></script>
//
//  window.NPCEditor:
//    blank()                          — empty full-model NPC (no id)
//    uniqueId(name, npcs, extraUsed)  — slugify + dedupe against npcs[]
//    createStub(fields, npcs, extra)  — full-model NPC with unique id
//                                       (used headlessly by Scan Prep
//                                       and any quick-create path)
//    open(opts)                       — render the editor into opts.host
//    openModal(opts)                  — same, wrapped in a theme modal
//
//  open()/openModal() opts:
//    host        Element to render into (open only)
//    npc         NPC object to edit, or null/undefined for a new one
//    prefill     optional fields for a new NPC ({name, role, ...})
//    npcs        the live npcs array — the editor mutates it
//                (push / merge / delete / history append)
//    characters  [{id, name}] for the KNOWN TO chips
//    locations   [{id, name, parent?}] for the location selects
//    timeline    optional timeline entries array — powers APPEARS IN
//    entryHref   optional fn(entry) → href for APPEARS IN links
//    persist     async fn() → boolean; saves the npcs array to KV
//    onSaved     fn(npc, isNew) — after a successful save
//    onDeleted   fn(id) — after a successful delete
//    onCancel    fn() — Cancel pressed / modal dismissed
//
//  The DOM is built fresh with closure references — no element ids —
//  so multiple editors can't collide and hosts can't leak state.
// ═══════════════════════════════════════════════════════════════
(function () {

  const esc = (s) => (window.UI ? UI.escapeHtml(s) : (s ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const notify = (msg, kind) => (window.UI ? UI.toast(msg, kind) : alert(msg));
  const confirmBox = (msg) => (window.UI ? UI.confirmDialog(msg) : Promise.resolve(confirm(msg)));

  function slugify(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function blank() {
    return {
      name: '', role: '', status: 'alive',
      currentLocationId: null, currentActivity: '',
      description: '', notes: '', dmNotes: '',
      knownTo: [], tags: [], history: [],
    };
  }

  function uniqueId(name, npcs, extraUsed) {
    const used = new Set([...(npcs || []).map(n => n.id), ...(extraUsed || [])]);
    const base = slugify(name) || 'npc';
    let id = base, n = 1;
    while (used.has(id)) id = `${base}-${++n}`;
    return id;
  }

  function createStub(fields, npcs, extraUsed) {
    const npc = { ...blank(), ...(fields || {}) };
    npc.id = uniqueId(npc.name, npcs, extraUsed);
    return npc;
  }

  // ── module CSS (theme-token based; tokens are aliased on every page) ──
  function injectCSS() {
    if (document.getElementById('npc-editor-css')) return;
    const style = document.createElement('style');
    style.id = 'npc-editor-css';
    style.textContent = `
.npce2{font-size:0.9rem}
.npce2 .npce2-row{display:flex;gap:8px}
.npce2 .npce2-row>.field{flex:1;min-width:0}
.npce2-chips{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 4px}
.npce2-chip{font-family:var(--font-display,'Cinzel',serif);font-size:0.62rem;letter-spacing:0.08em;padding:3px 10px;border-radius:10px;background:var(--c-surface-2,#1c2730);border:1px solid var(--c-border,#2c4048);color:var(--c-ink-faint,#6c787f);cursor:pointer;user-select:none;transition:all 0.12s}
.npce2-chip:hover{border-color:var(--c-teal,#4a9595)}
.npce2-chip.on{background:rgba(74,149,149,0.16);border-color:var(--c-teal,#4a9595);color:var(--c-teal-bright,#7ec5c5)}
.npce2-hint{font-size:0.72rem;color:var(--c-ink-faint,#6c787f);font-style:italic;margin-bottom:8px}
.npce2-dm{background:rgba(168,93,74,0.07);border:1px solid rgba(168,93,74,0.35);border-radius:4px;padding:8px 10px;margin:8px 0}
.npce2-dm-label{font-family:var(--font-display,'Cinzel',serif);font-size:0.6rem;letter-spacing:0.12em;color:var(--c-error,#c4604c);margin-bottom:4px}
.npce2-dm textarea{width:100%;background:transparent;border:none;color:var(--c-ink,#e5e9eb);font-family:var(--font-body,'Crimson Text',serif);font-size:0.9rem;outline:none;resize:vertical;line-height:1.5}
.npce2-section{font-family:var(--font-display,'Cinzel',serif);font-size:0.66rem;letter-spacing:0.12em;color:var(--c-brass,#b88a5a);text-transform:uppercase;margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--c-border,#2c4048)}
.npce2-move{background:var(--c-bg-elevated,#0d141a);border:1px solid var(--c-border,#2c4048);border-radius:4px;padding:8px 10px;margin-top:4px}
.npce2-hcard{background:var(--c-surface-2,#1c2730);border:1px solid var(--c-border,#2c4048);border-radius:4px;padding:6px 9px;margin-bottom:5px}
.npce2-hcard.dm-only{border-style:dashed;border-color:rgba(168,93,74,0.45)}
.npce2-hmeta{display:flex;justify-content:space-between;align-items:center;font-size:0.7rem;color:var(--c-ink-faint,#6c787f);margin-bottom:2px}
.npce2-hdel{background:transparent;border:none;color:var(--c-ink-faint,#6c787f);cursor:pointer;font-size:0.8rem;padding:0 3px}
.npce2-hdel:hover{color:var(--c-error,#c4604c)}
.npce2-hbody{color:var(--c-ink-light,#a8b2b8);font-size:0.8rem;line-height:1.4}
.npce2-appear{display:block;color:var(--c-teal-bright,#7ec5c5);font-size:0.82rem;text-decoration:none;padding:3px 0;border-bottom:1px dotted transparent}
.npce2-appear:hover{border-bottom-color:var(--c-teal,#4a9595)}
.npce2-appear .kind{font-family:var(--font-display,'Cinzel',serif);font-size:0.58rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--c-ink-faint,#6c787f);margin-right:6px}
.npce2-empty{font-size:0.8rem;color:var(--c-ink-faint,#6c787f);font-style:italic;padding:4px 0}
.npce2-actions{display:flex;gap:6px;margin:12px 0 4px}
.npce2-actions .push{margin-left:auto}
`;
    document.head.appendChild(style);
  }

  function locOptions(locations, current, emptyLabel) {
    const opts = (locations || []).slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(l => `<option value="${esc(l.id)}" ${l.id === current ? 'selected' : ''}>${esc(l.name)}${l.parent ? ` · ${esc(l.parent)}` : ''}</option>`)
      .join('');
    return `<option value="">${emptyLabel}</option>` + opts;
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  // ── the editor ─────────────────────────────────────────────────
  function open(opts) {
    injectCSS();
    const {
      host, npcs, characters = [], locations = [],
      timeline = null, entryHref = null,
      persist, onSaved, onDeleted, onCancel,
    } = opts;
    if (!host || !Array.isArray(npcs) || typeof persist !== 'function') {
      throw new Error('NPCEditor.open: host, npcs[] and persist() are required');
    }

    const existing = opts.npc || null;
    const isNew = !existing;
    // Working copy — nothing touches the real record until Save.
    const work = existing ? {
      ...blank(), ...existing,
      knownTo: Array.isArray(existing.knownTo) ? existing.knownTo.slice() : [],
      tags: Array.isArray(existing.tags) ? existing.tags.slice() : [],
    } : { ...blank(), ...(opts.prefill || {}) };

    const root = document.createElement('div');
    root.className = 'npce2';
    root.innerHTML = `
      <div class="field"><label>NAME</label><input type="text" data-f="name" placeholder="Sera Mott"></div>
      <div class="npce2-row">
        <div class="field"><label>ROLE</label><input type="text" data-f="role" placeholder="Fence &amp; broker"></div>
        <div class="field"><label>STATUS</label>
          <select data-f="status">
            <option value="alive">Alive</option>
            <option value="dead">Dead</option>
            <option value="missing">Missing</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>
      <div class="field"><label>CURRENT LOCATION</label>
        <select data-f="location">${locOptions(locations, work.currentLocationId, '— unknown / off-map —')}</select>
      </div>
      <div class="field"><label>CURRENT ACTIVITY</label><input type="text" data-f="activity" placeholder="Working the Tallow &amp; Wick most evenings"></div>
      <div class="field"><label>PUBLIC DESCRIPTION (visible to players who know them)</label><textarea data-f="description" rows="3"></textarea></div>
      <div class="field"><label>PUBLIC NOTES (visible to players)</label><textarea data-f="notes" rows="2" placeholder="Mannerisms, anything players might recall"></textarea></div>
      <div class="field"><label>TAGS <span style="text-transform:none;letter-spacing:0">(comma-separated)</span></label><input type="text" data-f="tags" placeholder="guild, ally, merchant"></div>
      <div class="field">
        <label>KNOWN TO (which characters have encountered them)</label>
        <div class="npce2-chips" data-r="knownto"></div>
        <div class="npce2-hint">Click to toggle. Only the selected characters see this NPC on their roster.</div>
      </div>
      <div class="npce2-dm">
        <div class="npce2-dm-label">🔒 DM ONLY — NOT SHOWN TO PLAYERS</div>
        <textarea data-f="dmNotes" rows="3" placeholder="True motives, stat block, plot hooks…"></textarea>
      </div>
      <div class="npce2-actions">
        <button class="btn btn--primary btn--sm" type="button" data-b="save">Save</button>
        <button class="btn btn--ghost btn--sm" type="button" data-b="cancel">Cancel</button>
        <button class="btn btn--danger btn--sm push" type="button" data-b="delete" ${isNew ? 'style="display:none"' : ''}>Delete</button>
      </div>
      <div data-r="post-save" ${isNew ? 'style="display:none"' : ''}>
        <div class="npce2-section">⇄ Move / log activity (appends to history)</div>
        <div class="npce2-move">
          <div class="npce2-row">
            <div class="field"><label>NEW LOCATION (optional)</label>
              <select data-f="move-loc">${locOptions(locations, '', '— keep current —')}</select>
            </div>
            <div class="field"><label>DATE</label><input type="date" data-f="move-date" value="${today()}"></div>
          </div>
          <div class="field"><label>NEW ACTIVITY (optional)</label><input type="text" data-f="move-activity" placeholder="Spotted in the docks at midnight"></div>
          <div class="field"><label>NOTE</label><input type="text" data-f="move-note" placeholder="Witnessed by Aldric"></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn--sm" type="button" data-b="log">Log entry</button>
            <label style="font-size:0.72rem;color:var(--c-ink-faint,#6c787f);display:flex;align-items:center;gap:4px"><input type="checkbox" data-f="move-dmonly"> DM-only entry</label>
          </div>
        </div>
        <div class="npce2-section">History</div>
        <div data-r="history"></div>
        <div class="npce2-section">Appears in</div>
        <div data-r="appears"></div>
      </div>
    `;

    const q = (sel) => root.querySelector(sel);
    const f = (name) => q(`[data-f="${name}"]`);

    // Populate scalar fields from the working copy.
    f('name').value = work.name || '';
    f('role').value = work.role || '';
    f('status').value = work.status || 'alive';
    f('activity').value = work.currentActivity || '';
    f('description').value = work.description || '';
    f('notes').value = work.notes || '';
    f('tags').value = (work.tags || []).join(', ');
    f('dmNotes').value = work.dmNotes || '';

    function locationName(id) {
      const l = (locations || []).find(x => x.id === id);
      return l ? l.name : '';
    }

    function renderKnownTo() {
      const wrap = q('[data-r="knownto"]');
      if (!characters.length) {
        wrap.innerHTML = '<div class="npce2-empty">No characters yet — set them up in the Atlas Workshop → Players tab.</div>';
        return;
      }
      wrap.innerHTML = characters.slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map(c => `<span class="npce2-chip ${work.knownTo.includes(c.id) ? 'on' : ''}" data-char="${esc(c.id)}">${esc(c.name)}</span>`)
        .join('');
      wrap.querySelectorAll('.npce2-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.char;
          const i = work.knownTo.indexOf(id);
          if (i >= 0) work.knownTo.splice(i, 1); else work.knownTo.push(id);
          chip.classList.toggle('on', work.knownTo.includes(id));
        });
      });
    }

    function currentRecord() {
      return isNewSaved ? npcs.find(n => n.id === savedId) : (existing ? npcs.find(n => n.id === existing.id) : null);
    }

    function renderHistory() {
      const list = q('[data-r="history"]');
      const rec = currentRecord();
      const items = ((rec && rec.history) || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!items.length) { list.innerHTML = '<div class="npce2-empty">No history yet.</div>'; return; }
      list.innerHTML = items.map(h => `
        <div class="npce2-hcard ${h.dmOnly ? 'dm-only' : ''}">
          <div class="npce2-hmeta">
            <span>${esc(h.date)}${h.dmOnly ? ' · DM only' : ''}</span>
            <button class="npce2-hdel" data-h="${esc(h.id)}" title="Delete">✕</button>
          </div>
          ${h.locationId ? `<div class="npce2-hbody">📍 ${esc(locationName(h.locationId))}</div>` : ''}
          ${h.activity ? `<div class="npce2-hbody" style="font-style:italic">${esc(h.activity)}</div>` : ''}
          ${h.note ? `<div class="npce2-hbody">${esc(h.note)}</div>` : ''}
        </div>`).join('');
      list.querySelectorAll('.npce2-hdel').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!(await confirmBox('Delete this history entry?'))) return;
          const rec2 = currentRecord();
          if (!rec2) return;
          rec2.history = (rec2.history || []).filter(h => h.id !== btn.dataset.h);
          await persist();
          renderHistory();
        });
      });
    }

    function renderAppearsIn() {
      const wrap = q('[data-r="appears"]');
      if (!wrap) return;
      const rec = currentRecord();
      if (!Array.isArray(timeline) || !rec) {
        wrap.innerHTML = '<div class="npce2-empty">—</div>';
        return;
      }
      const hits = timeline
        .filter(e => Array.isArray(e.npcIds) && e.npcIds.includes(rec.id))
        .sort((a, b) => (b.dateSort || '').localeCompare(a.dateSort || ''));
      if (!hits.length) {
        wrap.innerHTML = '<div class="npce2-empty">Not linked to any chronicle entries yet.</div>';
        return;
      }
      wrap.innerHTML = hits.map(e => {
        const label = `<span class="kind">${esc(e.kind || 'entry')}</span>${esc(e.title || '(untitled)')}${e.dateInGame ? ` <span style="opacity:0.55">· ${esc(e.dateInGame)}</span>` : ''}`;
        const href = entryHref ? entryHref(e) : null;
        return href
          ? `<a class="npce2-appear" href="${esc(href)}">${label}</a>`
          : `<span class="npce2-appear" style="cursor:default">${label}</span>`;
      }).join('');
    }

    let isNewSaved = false;   // a "new" editor that has saved becomes an edit session
    let savedId = existing ? existing.id : null;

    function collectFields() {
      return {
        name: f('name').value.trim(),
        role: f('role').value.trim(),
        status: f('status').value || 'alive',
        currentLocationId: f('location').value || null,
        currentActivity: f('activity').value.trim(),
        description: f('description').value.trim(),
        notes: f('notes').value.trim(),
        dmNotes: f('dmNotes').value.trim(),
        knownTo: work.knownTo.slice(),
        tags: f('tags').value.split(',').map(t => t.trim()).filter(Boolean),
      };
    }

    async function save() {
      const fields = collectFields();
      if (!fields.name) { notify('NPC needs a name.', 'error'); return; }
      let rec;
      const creating = !savedId;
      if (creating) {
        rec = { id: uniqueId(fields.name, npcs), ...blank(), ...fields };
        npcs.push(rec);
      } else {
        const idx = npcs.findIndex(n => n.id === savedId);
        if (idx < 0) return;
        npcs[idx] = { ...npcs[idx], ...fields };
        rec = npcs[idx];
      }
      const ok = await persist();
      if (!ok) {
        if (creating) npcs.pop();
        notify('Failed to save NPC — check your DM session and try again.', 'error');
        return;
      }
      if (creating) {
        savedId = rec.id;
        isNewSaved = true;
        const del = q('[data-b="delete"]'); if (del) del.style.display = '';
        const post = q('[data-r="post-save"]'); if (post) post.style.display = '';
        renderHistory(); renderAppearsIn();
      }
      notify('NPC saved.', 'success');
      if (onSaved) onSaved(rec, creating);
    }

    async function del() {
      const rec = currentRecord();
      if (!rec) { if (onCancel) onCancel(); return; }
      if (!(await confirmBox(`Delete ${rec.name}? Their history will be lost and players who knew them will no longer see them.`))) return;
      const idx = npcs.findIndex(n => n.id === rec.id);
      if (idx >= 0) npcs.splice(idx, 1);
      // Tell the host WHICH record was deleted so merge-before-write saves
      // don't resurrect it from the remote copy.
      const ok = await persist({ deletedId: rec.id });
      if (!ok) {
        if (idx >= 0) npcs.splice(idx, 0, rec);
        notify('Failed to delete NPC — try again.', 'error');
        return;
      }
      if (onDeleted) onDeleted(rec.id);
    }

    async function logMove() {
      const rec = currentRecord();
      if (!rec) { notify('Save the NPC first.', 'error'); return; }
      const newLoc = f('move-loc').value || '';
      const newActivity = f('move-activity').value.trim();
      const note = f('move-note').value.trim();
      const date = f('move-date').value || today();
      const dmOnly = f('move-dmonly').checked;
      if (!newLoc && !newActivity && !note) {
        notify('Add at least one of: new location, new activity, or a note.', 'error');
        return;
      }
      rec.history = rec.history || [];
      rec.history.push({
        id: 'h' + Date.now() + Math.floor(Math.random() * 1000),
        locationId: newLoc || rec.currentLocationId || null,
        activity: newActivity || rec.currentActivity || '',
        date, note, dmOnly,
      });
      if (newLoc) rec.currentLocationId = newLoc;
      if (newActivity) rec.currentActivity = newActivity;
      await persist();
      f('location').value = rec.currentLocationId || '';
      f('activity').value = rec.currentActivity || '';
      f('move-loc').value = ''; f('move-activity').value = '';
      f('move-note').value = ''; f('move-dmonly').checked = false;
      renderHistory();
      notify('History entry logged.', 'success');
      if (onSaved) onSaved(rec, false);
    }

    q('[data-b="save"]').addEventListener('click', save);
    q('[data-b="cancel"]').addEventListener('click', () => { if (onCancel) onCancel(); });
    q('[data-b="delete"]').addEventListener('click', del);
    const logBtn = q('[data-b="log"]');
    if (logBtn) logBtn.addEventListener('click', logMove);

    renderKnownTo();
    if (!isNew) { renderHistory(); renderAppearsIn(); }

    host.innerHTML = '';
    host.appendChild(root);
    setTimeout(() => f('name').focus(), 30);

    return {
      el: root,
      destroy() { root.remove(); },
    };
  }

  // ── modal wrapper (Chronicle) ──────────────────────────────────
  function openModal(opts) {
    injectCSS();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay is-visible';
    overlay.style.overflowY = 'auto';
    const pane = document.createElement('div');
    pane.className = 'modal';
    pane.style.maxWidth = '560px';
    pane.style.margin = 'auto';
    pane.innerHTML = `
      <button class="modal-close" type="button" aria-label="Close">×</button>
      <div class="modal-title">${opts.npc ? 'Edit NPC' : 'New NPC'}</div>
      <div class="npce2-host"></div>`;
    overlay.appendChild(pane);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); if (opts.onCancel) opts.onCancel(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { close(); if (opts.onCancel) opts.onCancel(); } });
    pane.querySelector('.modal-close').addEventListener('click', () => { close(); if (opts.onCancel) opts.onCancel(); });

    const ctl = open({
      ...opts,
      host: pane.querySelector('.npce2-host'),
      onCancel: () => { close(); if (opts.onCancel) opts.onCancel(); },
      onDeleted: (id) => { close(); if (opts.onDeleted) opts.onDeleted(id); },
    });
    return { ...ctl, close };
  }

  window.NPCEditor = { blank, uniqueId, createStub, open, openModal };
})();
