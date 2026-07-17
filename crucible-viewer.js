// ═══════════════════════════════════════════════════════════════════════
//  crucible-viewer.js
//  SVG event-sourced replay viewer for Crucible v2 tactical trials.
//
//  Public surface:
//    CrucibleViewer.mount(rootEl, trialResult)     — render board + controls
//    CrucibleViewer.initialState(placementEvent)   — derive starting state
//    CrucibleViewer.applyEvent(state, event)       — mutate state in place
//    CrucibleViewer.renderSVG(host, state)         — paint the board
//
//  No engine coupling beyond reading trial.events.
// ═══════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const CrucibleViewer = {};

  const CELL = 24;  // pixels per cell
  CrucibleViewer.CELL = CELL;

  // Distinct, theme-friendly fill colors for PC tokens. Selected so the
  // dark-bg first-letter glyph stays legible on every swatch. Order is
  // deliberate — first PCs get the most distinctive hues.
  const PC_PALETTE = [
    '#7ec5c5', // teal (the existing accent)
    '#d4a85a', // amber/brass
    '#c87cd4', // violet
    '#e08a8a', // rose
    '#7ad4e0', // cyan
    '#a5d47a', // lime
    '#e0b07a', // peach
    '#9a8de0', // periwinkle
  ];
  CrucibleViewer.PC_PALETTE = PC_PALETTE;
  function pcColor(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return PC_PALETTE[h % PC_PALETTE.length];
  }
  CrucibleViewer.pcColor = pcColor;

  function initialState(placementEvent) {
    if (!placementEvent || placementEvent.type !== 'placement') {
      return { map: { width: 20, height: 20, blocked: null }, combatants: [],
               lastMove: null, lastAoE: null };
    }
    const combatants = placementEvent.placements.map(p => ({
      id: p.id, name: p.name, side: p.side,
      x: p.pos.x, y: p.pos.y,
      hp: p.hp, maxHp: p.maxHp, ac: p.ac, speed: p.speed,
      // v3.8: grid footprint (cells per side) for size-scaled token rendering.
      sizeCells: p.sizeCells || 1,
      color: p.side === 'pc' ? pcColor(p.id) : null,
      dead: false, downed: false,
      // v3.6: viewer-side, name-only condition markers driven by the event
      // stream (condition-applied/ended, grapple, shove-prone, stand-up).
      conditions: new Set(),
    }));
    return { map: placementEvent.map, combatants, lastMove: null, lastAoE: null };
  }
  CrucibleViewer.initialState = initialState;

  function applyEvent(state, ev) {
    if (!ev) return;
    state.lastMove = null;
    state.lastAoE = null;
    switch (ev.type) {
      case 'move': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c) { c.x = ev.to.x; c.y = ev.to.y; }
        state.lastMove = ev;
        break;
      }
      case 'damage': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.max(0, c.hp - (ev.amount || 0));
          if (c.hp === 0) {
            if (c.side === 'pc') c.downed = true;
            else c.dead = true;
          }
        }
        break;
      }
      case 'heal': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.min(c.maxHp || (c.hp + (ev.amount || 0)), c.hp + (ev.amount || 0));
          if (ev.revived) c.downed = false;
        }
        break;
      }
      case 'regen': {
        const c = state.combatants.find(cc => cc.name === ev.actor);
        if (c && typeof ev.hpAfter === 'number') c.hp = ev.hpAfter;
        break;
      }
      case 'aoe': {
        state.lastAoE = ev;
        break;
      }
      case 'terrain-damage': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c) c.hp = Math.max(0, c.hp - (ev.amount || 0));
        break;
      }
      case 'shove': {
        const t = state.combatants.find(cc => cc.id === ev.target);
        if (t) {
          if (ev.outcome === 'pushed' && ev.to) { t.x = ev.to.x; t.y = ev.to.y; }
          else if (ev.outcome === 'prone' && t.conditions) t.conditions.add('prone');
        }
        break;
      }
      case 'push': {
        if (ev.to) {
          const t = state.combatants.find(cc => cc.id === ev.target);
          if (t) { t.x = ev.to.x; t.y = ev.to.y; }
        }
        break;
      }
      // v3.6: token status-glyph bookkeeping (name-only Sets).
      case 'condition-applied': {
        const t = state.combatants.find(cc => cc.id === ev.target);
        if (t && t.conditions && ev.condition) t.conditions.add(ev.condition);
        break;
      }
      case 'condition-ended': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c && c.conditions && ev.condition) c.conditions.delete(ev.condition);
        break;
      }
      case 'grapple': {
        if (ev.success) {
          const t = state.combatants.find(cc => cc.id === ev.target);
          if (t && t.conditions) t.conditions.add('grappled');
        }
        break;
      }
      case 'stand-up': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c && c.conditions) c.conditions.delete('prone');
        break;
      }
      // attack/save/feature events don't change state — they're informational.
      // Turn-scoped flags (dodging/hidden) have no turn-boundary events in the
      // stream, so the viewer doesn't track them. The v3.4 decision (AI trace)
      // and buff events remain log-only.
    }
  }
  CrucibleViewer.applyEvent = applyEvent;

  function renderTo(state, events, idx) {
    // Replay from event 1 (skip placement, already used by initialState) up to idx inclusive.
    for (let i = 1; i <= idx && i < events.length; i++) applyEvent(state, events[i]);
    return state;
  }
  CrucibleViewer.renderTo = renderTo;

  // v3.6: compact status-glyph strip for a combatant's conditions. Special
  // glyphs for the two most common tactical states; every other condition
  // shows its first letter uppercased. Returns '' when there's nothing to show.
  const CONDITION_GLYPHS = { prone: '▼', grappled: '✕' };
  function statusGlyphs(c) {
    if (!c.conditions || !c.conditions.size) return '';
    return Array.from(c.conditions)
      .map(cond => CONDITION_GLYPHS[cond] || String(cond).charAt(0).toUpperCase())
      .join(' ');
  }

  function renderSVG(host, state) {
    const w = state.map.width * CELL;
    const h = state.map.height * CELL;
    const tokensHtml = state.combatants.map(c => {
      // v3.8: an N×N creature anchors at its top-left cell; center + radius
      // scale with the footprint so a Large token fills its 2×2 block, etc.
      const n = c.sizeCells || 1;
      const cx = c.x * CELL + CELL * n / 2;
      const cy = c.y * CELL + CELL * n / 2;
      const r  = CELL * 0.4 * n;
      const cls = c.side === 'pc' ? 'token pc' : 'token monster';
      const dead = c.dead ? ' dead' : '';
      const downed = c.downed ? ' downed' : '';
      const hpFrac = c.maxHp ? Math.max(0, c.hp / c.maxHp) : 1;
      // Per-PC fill so multiple PCs are visually distinct. Monsters keep
      // their CSS-driven red. Downed PCs fall back to the grey downed style.
      const fillStyle = (c.side === 'pc' && c.color && !c.downed)
        ? ` style="fill:${c.color}"` : '';
      const glyphs = statusGlyphs(c);
      const glyphHtml = glyphs
        ? `<text class="status-glyphs" y="${-r - 9}">${glyphs}</text>` : '';
      return `<g class="${cls}${dead}${downed}" data-id="${c.id}" transform="translate(${cx}, ${cy})">
        <circle r="${r}"${fillStyle} />
        <text dy="0.35em" text-anchor="middle">${(c.name || '?').charAt(0)}</text>
        <rect class="hp-bar" x="${-r}" y="${-r - 6}" width="${2*r*hpFrac}" height="3" />
        ${glyphHtml}
      </g>`;
    }).join('');
    const gridLines = [];
    for (let i = 0; i <= state.map.width; i++) {
      gridLines.push(`<line x1="${i*CELL}" y1="0" x2="${i*CELL}" y2="${h}" class="grid-line" />`);
    }
    for (let i = 0; i <= state.map.height; i++) {
      gridLines.push(`<line x1="0" y1="${i*CELL}" x2="${w}" y2="${i*CELL}" class="grid-line" />`);
    }
    const terrainHtml = [];
    if (state.map.terrain) {
      for (let y = 0; y < state.map.height; y++) {
        const row = state.map.terrain[y] || [];
        for (let x = 0; x < state.map.width; x++) {
          const t = row[x];
          if (!t) continue;
          const px = x * CELL, py = y * CELL;
          if (t.type === 'wall') {
            terrainHtml.push(`<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" class="terrain-wall" />`);
          } else if (t.type === 'difficult') {
            terrainHtml.push(`<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" class="terrain-difficult" />`);
          } else if (t.type === 'damaging') {
            const label = t.dice ? `${t.dice}${t.mod ? (t.mod > 0 ? '+' + t.mod : t.mod) : ''}` : '!';
            terrainHtml.push(
              `<g class="terrain-damaging" transform="translate(${px}, ${py})">
                 <rect width="${CELL}" height="${CELL}" />
                 <text x="${CELL/2}" y="${CELL/2 + 4}" text-anchor="middle">${label}</text>
               </g>`
            );
          } else if (t.type === 'cover-half' || t.type === 'cover-34') {
            // v4.0 cover: low obstacle — bottom-half slab so it reads as
            // something you duck behind; ¾ cover is drawn taller.
            const frac = t.type === 'cover-34' ? 0.72 : 0.45;
            const ch = Math.round(CELL * frac);
            terrainHtml.push(
              `<g class="terrain-cover" transform="translate(${px}, ${py})">
                 <rect y="${CELL - ch}" width="${CELL}" height="${ch}" rx="2" />
                 <text x="${CELL/2}" y="${CELL/2 + 4}" text-anchor="middle">${t.type === 'cover-34' ? '¾' : '½'}</text>
               </g>`
            );
          }
        }
      }
    }
    const aoeHtml = state.lastAoE
      ? state.lastAoE.cellsCovered.map(c => `<rect x="${c.x*CELL}" y="${c.y*CELL}" width="${CELL}" height="${CELL}" class="aoe-cell" />`).join('')
      : '';
    const trailHtml = state.lastMove
      ? `<polyline points="${[state.lastMove.from, ...state.lastMove.path].map(c => (c.x*CELL + CELL/2) + ',' + (c.y*CELL + CELL/2)).join(' ')}" class="move-trail" />`
      : '';
    host.innerHTML = `<svg class="tactical-board" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <g class="grid-lines">${gridLines.join('')}</g>
      <g class="terrain-overlay">${terrainHtml.join('')}</g>
      <g class="aoe-overlay">${aoeHtml}</g>
      <g class="move-trail-group">${trailHtml}</g>
      <g class="tokens">${tokensHtml}</g>
    </svg>`;
  }
  CrucibleViewer.renderSVG = renderSVG;

  function mount(host, trial) {
    const events = trial.events || [];
    const state = initialState(events[0] || null);
    const inst = {
      cursor: 0,
      playing: false,
      speedMs: 600,
      timer: null,
    };

    // Build a tiny legend so the per-PC colors are decodable at a glance.
    const pcs = state.combatants.filter(c => c.side === 'pc');
    const legendHtml = pcs.length
      ? '<div class="viewer-legend">' + pcs.map(c =>
          `<span class="viewer-legend-item">` +
            `<span class="viewer-legend-swatch" style="background:${c.color || '#7ec5c5'};"></span>` +
            `<span class="viewer-legend-name">${escapeText(c.name)}</span>` +
          `</span>`
        ).join('') + '</div>'
      : '';
    host.innerHTML = `<div class="viewer-flex">
      <div class="viewer-left">
        <div class="viewer-board"></div>
        <div class="viewer-controls">
          <button class="vc-back">◀</button>
          <button class="vc-playpause">▶</button>
          <button class="vc-forward">▶</button>
          <input type="range" min="0" max="${Math.max(0, events.length - 1)}" value="0" class="viewer-scrub" />
          <select class="viewer-speed">
            <option value="1200">0.5×</option>
            <option value="600" selected>1×</option>
            <option value="300">2×</option>
            <option value="150">4×</option>
          </select>
        </div>
        ${legendHtml}
      </div>
      <div class="viewer-log"></div>
    </div>`;
    const boardEl = host.querySelector('.viewer-board');
    const logEl   = host.querySelector('.viewer-log');
    const scrub   = host.querySelector('.viewer-scrub');
    const speed   = host.querySelector('.viewer-speed');
    const backBtn = host.querySelector('.vc-back');
    const ppBtn   = host.querySelector('.vc-playpause');
    const fwdBtn  = host.querySelector('.vc-forward');

    function rerender() {
      renderSVG(boardEl, state);
      updateLog();
    }
    function setCursor(idx) {
      idx = Math.max(0, Math.min(events.length - 1, idx));
      if (idx === inst.cursor) return;
      if (idx < inst.cursor) {
        Object.assign(state, initialState(events[0]));
      }
      const from = Math.max(1, idx < inst.cursor ? 1 : inst.cursor + 1);
      for (let i = from; i <= idx; i++) applyEvent(state, events[i]);
      inst.cursor = idx;
      rerender();
    }
    inst.stepForward = () => setCursor(inst.cursor + 1);
    inst.stepBack    = () => setCursor(inst.cursor - 1);
    inst.scrub       = idx => setCursor(idx);
    inst.play  = () => {
      if (inst.playing) return;
      inst.playing = true;
      inst.timer = setInterval(() => {
        if (inst.cursor >= events.length - 1) { inst.pause(); return; }
        inst.stepForward();
      }, inst.speedMs);
    };
    inst.pause = () => { inst.playing = false; if (inst.timer) clearInterval(inst.timer); inst.timer = null; };
    inst.setSpeed = ms => { inst.speedMs = ms; if (inst.playing) { inst.pause(); inst.play(); } };

    backBtn.onclick = () => inst.stepBack();
    ppBtn.onclick   = () => inst.playing ? inst.pause() : inst.play();
    fwdBtn.onclick  = () => inst.stepForward();
    scrub.oninput   = e => inst.scrub(parseInt(e.target.value, 10));
    speed.onchange  = e => inst.setSpeed(parseInt(e.target.value, 10));

    function updateLog() {
      const lines = events.slice(0, inst.cursor + 1).map((ev, i) =>
        `<div class="log-line log-${ev.type}${i === inst.cursor ? ' log-active' : ''}" data-idx="${i}">${escapeText(formatEvent(ev))}</div>`).join('');
      logEl.innerHTML = lines;
      Array.from(logEl.querySelectorAll('.log-line')).forEach(el => {
        el.onclick = () => inst.scrub(parseInt(el.dataset.idx, 10));
      });
      scrub.value = inst.cursor;
    }
    function escapeText(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
    function formatEvent(ev) {
      switch (ev.type) {
        case 'placement': return 'Placement: ' + ev.placements.length + ' combatants on ' + ev.map.width + '×' + ev.map.height;
        case 'move':      return 'R' + ev.round + ' · ' + ev.name + ' ' + (ev.reason === 'dash' ? 'dashes' : 'walks') + ' to (' + ev.to.x + ',' + ev.to.y + ')';
        case 'dash':      return 'R' + ev.round + ' · ' + ev.name + ' uses Dash (+' + ev.cells + ' cells)';
        case 'attack':    return 'R' + ev.round + ' · ' + ev.actor +
          (ev.thrown ? ' throws ' + ev.action + ' at ' + ev.target
                     : ' → ' + ev.target + ' · ' + ev.action) +
          ' (roll ' + ev.roll + ')' +
          (ev.cover ? ' vs ' + (ev.cover === 'three-quarters' ? '¾' : '½') + ' cover' : '') +
          ' → ' + (ev.hit ? 'hit ' + ev.damageDealt : 'miss');
        case 'damage':    return 'R' + ev.round + ' · ' + ev.target + ' takes ' + ev.amount + ' ' + ev.dmgType;
        case 'heal':      return 'R' + ev.round + ' · ' + ev.actor + ' heals ' + ev.target + ' +' + ev.amount + (ev.revived ? ' REVIVED' : '');
        case 'save':      return 'R' + ev.round + ' · ' + ev.actor + ' → ' + ev.target + ' · ' + ev.action
                               + (ev.cover === 'total' ? ' — blocked by total cover'
                                  : (ev.autoHit ? ' hits automatically' : ' save ' + (ev.passed ? 'passed' : 'failed'))
                                    + (ev.cover ? ' (' + (ev.cover === 'three-quarters' ? '¾' : '½') + ' cover)' : ''));
        case 'aoe':       return 'R' + ev.round + ' · AoE ' + ev.shape + ' @ (' + ev.center.x + ',' + ev.center.y + ') hits ' + ev.targets.length;
        case 'opportunity-attack': return 'R' + ev.round + ' · OoA ' + ev.attackerName + ' on ' + ev.targetName + ' → ' + (ev.hit ? 'hit ' + ev.damageDealt : 'miss');
        case 'feature':   return 'R' + ev.round + ' · ⚡ ' + (ev.what || '');
        case 'terrain-damage': return 'R' + ev.round + ' · ' + ev.name + ' takes ' + ev.amount + ' ' + ev.dmgType + ' (terrain)';
        case 'dodge':      return 'R' + ev.round + ' · ' + ev.name + ' takes the Dodge action';
        case 'disengage':  return 'R' + ev.round + ' · ' + ev.name + ' Disengages';
        case 'help':       return 'R' + ev.round + ' · ' + ev.name + ' Helps ' + ev.targetName;
        case 'hide':       return 'R' + ev.round + ' · ' + ev.name + (ev.success ? ' Hides (stealth ' + ev.roll + ' vs ' + ev.dc + ')' : ' fails to Hide' + (ev.reason === 'seen' ? ' (seen)' : ''));
        case 'grapple':    return 'R' + ev.round + ' · ' + ev.name + (ev.success ? ' grapples ' : ' fails to grapple ') + ev.targetName;
        case 'shove':      return 'R' + ev.round + ' · ' + ev.name + ' shoves ' + ev.targetName + ' → ' + ev.outcome;
        case 'stand-up':   return 'R' + ev.round + ' · ' + ev.name + ' stands up';
        case 'decision':   return 'R' + ev.round + ' · 🧠 ' + ev.name + ': ' + ev.choice + (ev.reason ? ' — ' + ev.reason : '');
        case 'condition-ended': return 'R' + ev.round + ' · ' + ev.name + ' is no longer ' + ev.condition + (ev.reason ? ' (' + ev.reason + ')' : '');
        case 'grapple-escape-failed': return 'R' + ev.round + ' · ' + ev.name + ' fails to escape the grapple';
        case 'condition-applied': return 'R' + ev.round + ' · ' + ev.targetName + ' is ' + ev.condition + ' (DC ' + ev.dc + ', ' + ev.duration + ' rd)';
        case 'push':      return 'R' + ev.round + ' · ' + ev.name + ' pushes ' + ev.targetName + ' ' + ev.cells + ' cell' + (ev.cells === 1 ? '' : 's');
        case 'buff':       return 'R' + ev.round + ' · ' + ev.name + ' grants ' + ev.grants + ' to ' + (ev.target === ev.who ? 'self' : ev.targetName);
        default:          return ev.type;
      }
    }

    rerender();
    return inst;
  }
  CrucibleViewer.mount = mount;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleViewer;
  } else {
    global.CrucibleViewer = CrucibleViewer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
