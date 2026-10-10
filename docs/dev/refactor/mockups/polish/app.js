/* Mockup-only behaviour: state switcher, drawer, dialogs, filters, search. Not product code. */
(function () {
  var q = new URLSearchParams(location.search);
  var body = document.body;

  function applyState(state) {
    body.dataset.state = state;
    document.querySelectorAll('[data-states]').forEach(function (el) {
      var list = el.getAttribute('data-states').split(' ');
      el.hidden = !(list.indexOf(state) > -1 || list.indexOf('*') > -1);
    });
    document.querySelectorAll('[data-not-states]').forEach(function (el) {
      el.hidden = el.getAttribute('data-not-states').split(' ').indexOf(state) > -1;
    });
    var sel = document.getElementById('state-select');
    if (sel && sel.value !== state) sel.value = state;
    document.querySelectorAll('[data-state-attr]').forEach(function (el) {
      var map = JSON.parse(el.getAttribute('data-state-attr'));
      var attr = map.attr;
      var v = map.values[state];
      if (v === undefined) v = map.values['*'];
      if (v === null || v === undefined) el.removeAttribute(attr); else el.setAttribute(attr, v);
    });
    var ro = state === 'readonly';
    document.querySelectorAll('.groups input, .groups select').forEach(function (el) { if (ro) { el.setAttribute('data-ro', '1'); el.disabled = true; } else if (el.getAttribute('data-ro')) { el.removeAttribute('data-ro'); el.disabled = false; } });
    document.querySelectorAll('[data-write]').forEach(function (el) { if (ro) { el.setAttribute('data-ro', '1'); el.disabled = true; el.title = 'Needs the write capability'; } else if (el.getAttribute('data-ro')) { el.removeAttribute('data-ro'); el.disabled = false; el.removeAttribute('title'); } });
    var dlg = document.getElementById('dlg-' + state);
    document.querySelectorAll('dialog[open]').forEach(function (d) { d.close(); });
    if (dlg && dlg.tagName === 'DIALOG' && dlg.hasAttribute('data-auto')) dlg.showModal();
  }

  var sel = document.getElementById('state-select');
  var initial = q.get('state') || (sel ? sel.options[0].value : '');
  if (sel) {
    sel.addEventListener('change', function () { applyState(sel.value); });
    applyState(initial);
  }

  var lang = q.get('lang') || 'en';
  function applyLang(l) {
    document.documentElement.lang = l;
    document.querySelectorAll('[data-lang-btn]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang-btn') === l)); });
  }
  document.querySelectorAll('[data-lang-btn]').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.getAttribute('data-lang-btn')); });
  });
  if (document.querySelector('[data-lang-btn]')) applyLang(lang);

  var menu = document.getElementById('menu-btn');
  var sidebar = document.getElementById('sidebar');
  function setNav(open) {
    body.classList.toggle('nav-open', open);
    if (menu) { menu.setAttribute('aria-expanded', String(open)); menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); }
    if (open && sidebar) { var a = sidebar.querySelector('a[aria-current], a'); if (a) a.focus(); }
    if (!open && menu) menu.focus();
  }
  if (menu) {
    menu.addEventListener('click', function () { setNav(!body.classList.contains('nav-open')); });
    var scrim = document.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', function () { setNav(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && body.classList.contains('nav-open')) setNav(false); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open-dialog]');
    if (t) { var d = document.getElementById(t.getAttribute('data-open-dialog')); if (d) d.showModal(); }
    var c = e.target.closest('[data-close]');
    if (c) { var dd = c.closest('dialog'); if (dd) dd.close(); }
    var tg = e.target.closest('[data-toggle]');
    if (tg && tg.type === 'checkbox') { applyFilters(); } else if (tg) { var on = tg.getAttribute('aria-pressed') !== 'true'; tg.setAttribute('aria-pressed', String(on)); applyFilters(); }
    var f = e.target.closest('[data-filter]');
    if (f) {
      var group = f.closest('[data-filter-group]');
      group.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === f)); });
      applyFilters();
    }
    var ss = e.target.closest('[data-set-state]');
    if (ss) { var st = ss.getAttribute('data-set-state'); applyState(st); document.querySelectorAll('[data-set-state]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === ss)); }); }
    var tt = e.target.closest('[data-toast]');
    if (tt) showToast(tt.getAttribute('data-toast'), tt.getAttribute('data-toast-sub'), tt.getAttribute('data-toast-kind'));
    var rv = e.target.closest('[data-reveal]');
    if (rv) { var inp = document.getElementById(rv.getAttribute('data-reveal')); var show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; rv.textContent = show ? 'Hide' : 'Show'; }
  });

  function showToast(title, sub, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    el.innerHTML = '<div><b></b><span></span></div>';
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = sub || '';
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }

  function applyFilters() {
    var chip = document.querySelector('[data-filter-group] [data-filter][aria-pressed="true"]');
    var want = chip ? chip.getAttribute('data-filter') : 'all';
    var bt = document.querySelector('[data-toggle="blockers"]'); var blockers = bt && bt.checked;
    var rows = document.querySelectorAll('[data-status]');
    var shown = 0;
    rows.forEach(function (r) {
      var s = r.getAttribute('data-status');
      var ok = (want === 'all' || s === want) && (!blockers || s === 'missing' || s === 'unknown');
      r.hidden = !ok; if (ok) shown++;
    });
    var none = document.getElementById('filter-none');
    if (none) none.hidden = shown > 0;
  }
  applyFilters();

  var search = document.getElementById('cfg-search');
  if (search) {
    var none = document.getElementById('search-none');
    var run = function () {
      var term = search.value.trim().toLowerCase();
      var hits = 0;
      document.querySelectorAll('details.group').forEach(function (g) {
        var any = 0;
        g.querySelectorAll('.cfg').forEach(function (f) {
          var m = !term || f.textContent.toLowerCase().indexOf(term) > -1 || (f.getAttribute('data-key') || '').toLowerCase().indexOf(term) > -1;
          f.hidden = !m; if (m) any++;
        });
        g.hidden = any === 0; if (term && any) g.open = true;
        hits += any;
      });
      if (none) { none.hidden = hits > 0 || !term; var s = none.querySelector('[data-term]'); if (s) s.textContent = search.value; }
    };
    search.addEventListener('input', run);
    var clr = document.getElementById('search-clear');
    if (clr) clr.addEventListener('click', function () { search.value = ''; run(); search.focus(); });
  }

  document.querySelectorAll('[data-typed]').forEach(function (inp) {
    var btn = document.getElementById(inp.getAttribute('data-typed'));
    var need = inp.getAttribute('data-need');
    inp.addEventListener('input', function () { btn.disabled = inp.value !== need; });
  });
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('close', function () { var t = d.querySelector('[data-typed]'); if (t) { t.value = ''; document.getElementById(t.getAttribute('data-typed')).disabled = true; } });
  });
})();
