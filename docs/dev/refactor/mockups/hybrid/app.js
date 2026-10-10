/* Mockup behaviour only: density, drawer, state switcher, dialogs, tabs, toggles. */
(function () {
  var root = document.documentElement;
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var density = store("hybrid-density"); if (density) root.setAttribute("data-density", density);
  var qs = new URLSearchParams(location.search);
  if (qs.get("density")) root.setAttribute("data-density", qs.get("density"));

  function syncSeg() {
    document.querySelectorAll("[data-seg]").forEach(function (seg) {
      var key = seg.getAttribute("data-seg");
      var cur = root.getAttribute("data-" + key) || "comfortable";
      seg.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-val") === cur)); });
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-seg] button"); if (!b) return;
    var key = b.parentElement.getAttribute("data-seg"), val = b.getAttribute("data-val");
    root.setAttribute("data-" + key, val);
    store("hybrid-" + key, val);
    syncSeg();
  });
  syncSeg();

  var menu = document.querySelector("[data-menu]");
  if (menu) {
    menu.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      menu.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("nav-open")) { document.body.classList.remove("nav-open"); menu.setAttribute("aria-expanded", "false"); menu.focus(); } });
    document.addEventListener("click", function (e) { if (document.body.classList.contains("nav-open") && !e.target.closest(".side") && !e.target.closest("[data-menu]")) { document.body.classList.remove("nav-open"); menu.setAttribute("aria-expanded", "false"); } });
  }

  var sel = document.getElementById("state");
  function applyState(v) {
    document.body.setAttribute("data-state", v);
    document.querySelectorAll("[data-show]").forEach(function (el) {
      el.hidden = el.getAttribute("data-show").split(/\s+/).indexOf(v) === -1;
    });
    document.querySelectorAll("[data-hide]").forEach(function (el) {
      el.hidden = el.getAttribute("data-hide").split(/\s+/).indexOf(v) !== -1;
    });
    document.querySelectorAll("dialog[data-open-in]").forEach(function (d) {
      var on = d.getAttribute("data-open-in").split(/\s+/).indexOf(v) !== -1;
      if (on && !d.open && d.showModal) d.showModal(); else if (!on && d.open) d.close();
    });
    document.querySelectorAll("[data-disable-in]").forEach(function(c){var off=c.getAttribute("data-disable-in").split(/\s+/).indexOf(v)!==-1;c.querySelectorAll("input,select,textarea,button.js-edit").forEach(function(x){x.disabled=off;});});
    document.querySelectorAll("[data-edge-map]").forEach(function(e){var m={};e.getAttribute("data-edge-map").split(/\s+/).forEach(function(p){var a=p.split(":");m[a[0]]=a[1];});e.classList.remove("is-dirty","is-failed","is-pending","is-running");void e.offsetWidth;if(m[v])e.classList.add(m[v]);});
    var srv = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].getAttribute("data-server") : null; var sv = document.getElementById("srvval"); if (sv) { sv.innerHTML = srv === "offline" ? "<span class=\"dot dot--offline\" aria-hidden=\"true\"></span><span class=\"mono\">smp</span><span class=\"dim small\">stopped</span>" : "<span class=\"dot dot--online\" aria-hidden=\"true\"></span><span class=\"mono\">smp</span><span class=\"dim small\">online, 3 players</span>"; }
    var demo = document.querySelector(".mock-bar .demo");
    if (demo && sel) { var opt = sel.options[sel.selectedIndex]; demo.textContent = opt && opt.getAttribute("data-note") ? opt.getAttribute("data-note") : ""; }
    if (history.replaceState) { var u = new URL(location.href); u.searchParams.set("state", v); history.replaceState(null, "", u); }
  }
  if (sel) {
    var initial = qs.get("state"); if (initial && Array.prototype.some.call(sel.options, function (o) { return o.value === initial; })) sel.value = initial;
    sel.addEventListener("change", function () { applyState(sel.value); });
    applyState(sel.value);
  }

  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var d = document.getElementById(o.getAttribute("data-open")); if (d && d.showModal) { d.showModal(); var f = d.querySelector("[data-autofocus]"); if (f) f.focus(); } }
    var c = e.target.closest("[data-close]");
    if (c) { var dd = c.closest("dialog"); if (dd) dd.close(); }
    var t = e.target.closest("[role=tab]");
    if (t) {
      var list = t.closest("[role=tablist]");
      list.querySelectorAll("[role=tab]").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
      var panels = document.querySelectorAll("[data-tabpanel]");
      panels.forEach(function (p) { if (p.getAttribute("data-tabgroup") === list.getAttribute("data-tabgroup")) p.hidden = p.getAttribute("data-tabpanel") !== t.getAttribute("data-tab"); });
    }
    var tg = e.target.closest("[data-toggle-pressed]");
    if (tg) { tg.setAttribute("aria-pressed", String(tg.getAttribute("aria-pressed") !== "true")); var tid = tg.getAttribute("data-toggle-pressed"); if (tid) document.querySelectorAll(tid).forEach(function (x) { x.hidden = tg.getAttribute("aria-pressed") === "true"; }); }
    var rv = e.target.closest("[data-reveal]");
    if (rv) { var inp = document.getElementById(rv.getAttribute("data-reveal")); var show = inp.type === "password"; inp.type = show ? "text" : "password"; rv.textContent = show ? "Hide" : "Reveal"; rv.setAttribute("aria-pressed", String(show)); }
    var ex = e.target.closest("[data-expand]");
    if (ex) { var tgt = document.getElementById(ex.getAttribute("data-expand")); var open = ex.getAttribute("aria-expanded") !== "true"; ex.setAttribute("aria-expanded", String(open)); tgt.hidden = !open; }
    var dismiss = e.target.closest("[data-dismiss]");
    if (dismiss) { var tt = dismiss.closest(".toast"); if (tt) tt.remove(); }
    var gl = e.target.closest("[data-lang-set]");
    if (gl) { document.body.setAttribute("data-lang", gl.getAttribute("data-lang-set")); document.querySelectorAll("[data-lang-set]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === gl)); }); document.documentElement.lang = gl.getAttribute("data-lang-set"); }
  });

  document.addEventListener("input", function (e) {
    var m = e.target.closest("[data-confirm-match]");
    if (m) { var btn = m.closest("dialog").querySelector("[data-confirm-btn]"); var ok = m.value.trim() === m.getAttribute("data-confirm-match"); btn.disabled = !ok; btn.setAttribute("aria-disabled", String(!ok)); }
    var fs = e.target.closest("[data-filter-input]");
    if (fs) {
      var q = fs.value.toLowerCase(); var sc = document.querySelector(fs.getAttribute("data-filter-input")); if (!sc) return;
      var shown = 0; sc.querySelectorAll("[data-filter-item]").forEach(function (it) { var hit = it.getAttribute("data-filter-item").toLowerCase().indexOf(q) !== -1; it.classList.toggle("is-filtered", !hit); if (hit && !it.hidden) shown++; });
      sc.querySelectorAll("[data-group]").forEach(function (g) { var any = g.querySelector("[data-filter-item]:not(.is-filtered):not([hidden])"); g.classList.toggle("is-filtered", !any); });
      var cnt = document.querySelector("[data-filter-count]"); if (cnt) cnt.textContent = shown;
      var none = document.querySelector("[data-filter-none]"); if (none) none.hidden = shown !== 0;
    }
  });

  var gs = document.querySelector("[data-groupselect]");
  if (gs) gs.addEventListener("change", function () { var el = document.getElementById(gs.value); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); });
  document.querySelectorAll(".groupnav a").forEach(function (a) {
    a.addEventListener("click", function () { document.querySelectorAll(".groupnav a").forEach(function (x) { x.removeAttribute("aria-current"); }); a.setAttribute("aria-current", "true"); });
  });
  if (!document.body.hasAttribute("data-lang")) document.body.setAttribute("data-lang", "en");
})();
