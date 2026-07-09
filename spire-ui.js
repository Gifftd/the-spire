// ═══════════════════════════════════════════════════════════════
//  spire-ui.js — shared UI kit (toast, confirm dialog, escaping,
//  page header). Styled entirely by theme.css classes.
//
//  Load AFTER auth.js + theme.css:
//    <link rel="stylesheet" href="theme.css?v=2">
//    <script src="auth.js?v=2"></script>
//    <script src="spire-ui.js?v=1"></script>
//
//  Exposes window.UI:
//    escapeHtml(s)                    — canonical HTML escaper (& < > ")
//    toast(msg, kind)                 — kind: 'info' | 'success' | 'error'
//    confirmDialog(message, opts)     — Promise<boolean>; opts:
//                                       { confirmLabel, cancelLabel, danger }
//    mountHeader(opts)                — inject the shared .topbar header;
//                                       returns { el, actionsEl }
// ═══════════════════════════════════════════════════════════════
(function () {

  function escapeHtml(s) {
    return (s ?? '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Toast ──────────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(msg, kind) {
    let el = document.getElementById('spire-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'spire-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = `toast is-visible${kind === 'error' ? ' toast--error' : kind === 'success' ? ' toast--success' : ''}`;
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.classList.remove('is-visible'); }, 2800);
  }

  // ── Confirm dialog ─────────────────────────────────────────────
  // Async replacement for native confirm(). Escape/backdrop = cancel,
  // Enter = confirm, focus lands on Cancel by default (safer).
  function confirmDialog(message, opts) {
    const { confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = opts || {};
    return new Promise(resolve => {
      let overlay = document.getElementById('spire-confirm');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'spire-confirm';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal modal--confirm" role="dialog" aria-modal="true">
            <div class="modal-sub spire-confirm-msg" style="margin-bottom:0"></div>
            <div class="modal-actions">
              <button class="btn btn--ghost btn--sm spire-confirm-cancel" type="button"></button>
              <button class="btn btn--sm spire-confirm-ok" type="button"></button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }
      const okBtn = overlay.querySelector('.spire-confirm-ok');
      const cancelBtn = overlay.querySelector('.spire-confirm-cancel');
      overlay.querySelector('.spire-confirm-msg').textContent = message;
      okBtn.textContent = confirmLabel;
      cancelBtn.textContent = cancelLabel;
      okBtn.className = `btn btn--sm spire-confirm-ok ${danger ? 'btn--danger' : 'btn--primary'}`;
      overlay.classList.add('is-visible');
      const cleanup = (val) => {
        overlay.classList.remove('is-visible');
        okBtn.onclick = cancelBtn.onclick = overlay.onclick = null;
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      };
      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => cancelBtn.focus(), 30);
    });
  }

  // ── Page header ────────────────────────────────────────────────
  // Injects <header class="topbar"> as the first body child (or into
  // opts.into). Owns identity + navigation only — page-specific tool
  // ribbons belong below it, or appended into the returned actionsEl.
  //   opts: { title, accent: 'brass'|'teal', actions: Node|html string,
  //           into: Element, homeHref }
  function mountHeader(opts) {
    const { title = 'The Spire', accent, actions, into, homeHref = 'home.html' } = opts || {};
    const id = (window.Auth && Auth.identity()) || { role: 'anonymous', display: 'Visitor' };
    const chipClass = id.role === 'dm' ? 'chip--dm' : id.role === 'player' ? 'chip--player' : 'chip--anon';

    const el = document.createElement('header');
    el.className = 'topbar';
    el.innerHTML = `
      <span class="topbar-title${accent === 'brass' ? ' topbar-title--brass' : ''}">${escapeHtml(title)}</span>
      <span class="topbar-spacer"></span>
      <div class="topbar-actions"></div>
      <span class="chip ${chipClass}">${escapeHtml(id.display)}</span>
      <a class="btn btn--ghost btn--sm" href="${escapeHtml(homeHref)}">Home</a>
      ${id.role !== 'anonymous' ? '<button class="btn btn--ghost btn--sm spire-signout" type="button">Sign out</button>' : ''}`;

    const actionsEl = el.querySelector('.topbar-actions');
    if (actions instanceof Node) actionsEl.appendChild(actions);
    else if (typeof actions === 'string') actionsEl.innerHTML = actions;

    const signout = el.querySelector('.spire-signout');
    if (signout) signout.addEventListener('click', () => {
      Auth.logout();
      window.location.href = homeHref;
    });

    if (into) into.appendChild(el);
    else document.body.insertBefore(el, document.body.firstChild);
    return { el, actionsEl };
  }

  window.UI = { escapeHtml, toast, confirmDialog, mountHeader };
})();
