/* Mockup runtime: builds the shared shell and wires the state switcher, drawer, popovers and dialogs.
   Not product code. Pages stay readable without it only as content, not as navigation. */
(function () {
  var body = document.body;
  var q = new URLSearchParams(location.search);
  var page = body.dataset.page || "";
  var server = body.dataset.server || "smp";
  var worst = body.dataset.worst || "warn";

  if (q.get("theme")) document.documentElement.dataset.theme = q.get("theme");
  else document.documentElement.dataset.theme = document.documentElement.dataset.theme || "dark";
  if (q.get("lang")) document.documentElement.dataset.uiLang = q.get("lang");

  var lampShape = { ok: "ok", warn: "warn", bad: "bad", unknown: "unknown" };

  function lamp(k, lg) { return '<span class="lamp ' + lampShape[k] + (lg ? " lg" : "") + '" aria-hidden="true"></span>'; }

  var servers = [
    { key: "smp", state: "ok", label: "Online", meta: "3/20 players" },
    { key: "creative", state: "warn", label: "Not responding", meta: "11 min" }
  ];
  var cur = servers.filter(function (s) { return s.key === server; })[0] || servers[0];

  function navLink(href, text, id, extra) {
    var c = page === id ? ' aria-current="page"' : "";
    return '<a class="rail-link" href="' + href + '"' + c + "><span>" + text + "</span>" + (extra || "") + "</a>";
  }
  var stub = function (n) { return "stub.html?page=" + n; };

  var rail =
    '<nav class="rail" id="rail" aria-label="Main">' +
    '<div class="rail-group"><h2>Watch</h2>' +
    navLink("watch.html", "All servers", "watch", '<span class="rail-count warn" aria-label="3 items need you">3</span>') +
    "</div>" +
    '<div class="rail-group"><h2>Server <span class="mono">' + cur.key + "</span></h2>" +
    navLink(stub("console"), "Console", "console") +
    navLink("backups.html", "Backups", "backups") +
    navLink("mods.html", "Mods", "mods", '<span class="rail-count" aria-label="4 updates">4</span>') +
    navLink(stub("activity"), "Players and stats", "activity") +
    "</div>" +
    '<div class="rail-group"><h2>Bot</h2>' +
    navLink("config.html", "Settings", "config") +
    navLink(stub("guilds"), "Discord servers", "guilds") +
    navLink(stub("commands"), "Commands", "commands") +
    navLink(stub("history"), "Change history", "history") +
    "</div>" +
    '<div class="rail-foot">' +
    '<div class="jobs-tray" id="jobs-tray" hidden></div>' +
    '<div class="btn-row">' +
    '<button class="btn sm ghost" type="button" data-open="dlg-changed">What changed</button>' +
    '<a class="btn sm ghost" href="' + stub("classic") + '">Classic layout</a>' +
    '<button class="btn sm ghost" type="button" id="theme-toggle">Light theme</button>' +
    "</div></div></nav>";

  var top =
    '<a class="skip" href="#main">Skip to content</a>' +
    '<header class="topbar" role="banner">' +
    '<button class="btn icon-btn menu-btn" type="button" id="menu-btn" aria-expanded="false" aria-controls="rail" aria-label="Open navigation">' +
    '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" stroke-width="2"/></svg></button>' +
    '<a class="brand" href="watch.html" aria-label="mcbot, ' + (worst === "ok" ? "all servers fine" : "something needs attention") + '">' + lamp(worst, true) + "<span>mcbot</span></a>" +
    '<div class="pop-wrap"><button class="srv-btn" type="button" id="srv-btn" aria-haspopup="true" aria-expanded="false" aria-controls="srv-pop">' +
    lamp(cur.state) + '<span class="mono">' + cur.key + '</span><span class="caret" aria-hidden="true"></span></button>' +
    '<div class="pop" id="srv-pop" hidden role="menu" aria-label="Choose server">' +
    servers.map(function (s) {
      return '<a role="menuitem" href="' + (page === "watch" ? "mods.html" : location.pathname.split("/").pop() || "mods.html") + '?server=' + s.key + '">' + lamp(s.state) + '<span class="mono">' + s.key + '</span><span class="meta">' + s.label + "</span></a>";
    }).join("") +
    '<hr><a role="menuitem" href="watch.html"><span>All servers</span><span class="meta">Watch</span></a></div></div>' +
    '<span class="grow"></span>' +
    '<span class="badge ' + (q.get("bot") === "down" ? "bad" : "ok") + '" id="bot-chip">' + lamp(q.get("bot") === "down" ? "bad" : "ok") + "<span>" + (q.get("bot") === "down" ? "Bot not responding" : "Bot connected") + "</span></span>" +
    '<span class="user-name" style="color:var(--text-dim)">maya_k</span>' +
    "</header>" +
    '<div class="drawer-scrim" id="scrim"></div>';

  var main = document.getElementById("main");
  var shell = document.createElement("div");
  shell.className = "shell";
  main.parentNode.insertBefore(shell, main);
  shell.insertAdjacentHTML("beforeend", rail);
  shell.appendChild(main);
  body.insertAdjacentHTML("afterbegin", top);
  main.setAttribute("tabindex", "-1");

  var toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.setAttribute("role", "status");
  toasts.setAttribute("aria-live", "polite");
  body.appendChild(toasts);
  window.toast = function (title, text, bad) {
    var t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.innerHTML = "<strong></strong><span></span>";
    t.firstChild.textContent = title;
    t.lastChild.textContent = text || "";
    toasts.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  };

  /* jobs */
  var tray = document.getElementById("jobs-tray");
  window.setJobs = function (jobs) {
    if (!jobs || !jobs.length) { tray.hidden = true; tray.innerHTML = ""; return; }
    tray.hidden = false;
    tray.innerHTML = "<strong>Running now</strong>" + jobs.map(function (j) {
      return '<div><a href="' + j.href + '">' + j.label + '</a><div class="progress' + (j.pct == null ? " indet" : "") + '" style="margin-top:4px"><i style="--w:' + (j.pct || 0) + '%"></i></div></div>';
    }).join("");
  };

  /* drawer */
  var mbtn = document.getElementById("menu-btn");
  function drawer(open) {
    body.classList.toggle("drawer-open", open);
    mbtn.setAttribute("aria-expanded", String(open));
    if (open) document.querySelector(".rail a").focus(); else mbtn.focus();
  }
  mbtn.addEventListener("click", function () { drawer(!body.classList.contains("drawer-open")); });
  document.getElementById("scrim").addEventListener("click", function () { drawer(false); });

  /* server popover */
  var sb = document.getElementById("srv-btn");
  var sp = document.getElementById("srv-pop");
  function pop(open) { sp.hidden = !open; sb.setAttribute("aria-expanded", String(open)); }
  sb.addEventListener("click", function () { pop(sp.hidden); });
  document.addEventListener("click", function (e) { if (!sp.hidden && !sp.contains(e.target) && !sb.contains(e.target)) pop(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (!sp.hidden) { pop(false); sb.focus(); } if (body.classList.contains("drawer-open")) drawer(false); }
  });

  /* theme */
  var tt = document.getElementById("theme-toggle");
  function themeLabel() { tt.textContent = document.documentElement.dataset.theme === "light" ? "Dark theme" : "Light theme"; }
  themeLabel();
  tt.addEventListener("click", function () {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    themeLabel();
  });

  /* dialogs */
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var d = document.getElementById(o.dataset.open); if (d && d.showModal) { d.showModal(); var f = d.querySelector("[autofocus]"); if (f) f.focus(); } }
    var c = e.target.closest("[data-close]");
    if (c) { var dd = c.closest("dialog"); if (dd) dd.close(); }
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-confirm-match]"), function (inp) {
    var btn = document.getElementById(inp.dataset.confirmTarget);
    function sync() { var ok = inp.value.trim() === inp.dataset.confirmMatch; btn.disabled = !ok; btn.setAttribute("aria-disabled", String(!ok)); }
    inp.addEventListener("input", sync); sync();
  });

  /* what changed overlay */
  var changed = document.createElement("dialog");
  changed.className = "dlg";
  changed.id = "dlg-changed";
  changed.setAttribute("aria-labelledby", "dlg-changed-t");
  changed.innerHTML =
    '<form method="dialog"><h2 id="dlg-changed-t">What moved in the dashboard</h2>' +
    '<p class="lead">Nothing was removed. Every old tab has a new home.</p>' +
    '<dl class="ledger">' +
    "<dt>Overview, Servers</dt><dd>Now <strong>Watch</strong>. Start, stop and restart sit in each server's header.</dd>" +
    "<dt>Mod Config</dt><dd>A tab inside <strong>Mods</strong>.</dd>" +
    "<dt>Config, Audit Log</dt><dd><strong>Settings</strong> and <strong>Change history</strong> under Bot.</dd>" +
    "<dt>Console, Backups, Mods, Analytics</dt><dd>Under <strong>Server</strong>, for the server you picked at the top.</dd>" +
    "</dl>" +
    '<div class="btn-row"><a class="btn" href="' + stub("classic") + '">Use the classic layout</a><button class="btn primary" value="ok" autofocus>Got it</button></div></form>';
  body.appendChild(changed);
  if (page === "watch" && q.get("tour") === "1") changed.showModal();

  /* state switcher */
  var cfg = body.dataset.states;
  if (cfg) {
    var list = JSON.parse(cfg);
    var bar = document.createElement("div");
    bar.className = "mock-bar";
    bar.innerHTML = '<label>State <select id="state-sel"></select></label><span class="states-note" id="state-note"></span><span class="demo">Mockup with sample data. Fixed names, sizes and times are invented.</span>';
    body.insertBefore(bar, body.firstChild);
    var sel = bar.querySelector("select");
    list.forEach(function (s) { var op = document.createElement("option"); op.value = s[0]; op.textContent = s[1]; sel.appendChild(op); });
    function apply(v) {
      body.dataset.state = v; sel.value = v;
      Array.prototype.forEach.call(document.querySelectorAll("[data-for]"), function (el) {
        el.hidden = el.dataset.for.split(" ").indexOf(v) === -1 && el.dataset.for !== "*";
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-not]"), function (el) {
        el.hidden = el.dataset.not.split(" ").indexOf(v) !== -1;
      });
      if (window.onState) window.onState(v);
    }
    sel.addEventListener("change", function () { apply(sel.value); });
    document.addEventListener("DOMContentLoaded", function () { apply(q.get("state") || list[0][0]); });
  }
})();
