/* Module pacing: a "Next" / forward move unlocks only once the CURRENT page is at least 50% complete.
 *
 *   page completion = the smaller of (a) how far down the page the learner has scrolled and
 *                                    (b) time spent on the page vs. its estimated reading time (~220 words/min)
 *
 * so scrolling to the bottom in a second does not count. Backward moves are always free. Staff only: admins are exempt.
 * Finished pages are remembered in this browser (localStorage). This is a pacing aid in the page; the About Us video
 * check is the part enforced on the server.
 *
 * Works for: Module 1 (Next buttons + sidebar + Assessment), Module 2 (Next buttons + tabs + Assessment), Module 4 CSR (Next + section menu), Modules 3, 5, 6 (Next Module link).
 * Loaded AFTER bridge.js so its wrappers sit outside bridge's tracking hooks (a blocked click records nothing).
 */
(function () {
  "use strict";
  if (!window.DFAuth) return;

  var UNLOCK = 0.5;          // 50% complete
  var WPM = 220;             // reading speed used to estimate how long a page takes
  var MIN_READ = 10, MAX_READ = 180; // seconds, clamp
  var file = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
  var uid = "anon";
  var done = {};             // pageKey -> true (persisted)
  var mem = {};              // pageKey -> { depth, dwell, need }
  var announced = {}, wasLocked = {}; // so "page complete" is announced once, and only for pages that were locked
  var adapter = null;
  var curKey = null;
  var pill = null, pillTimer = null;
  var MOD = { "module-01-usa-interactive-training": "m1", "module-02-vehicle101-interactive-training": "m2", "module-03-software-tools": "m3", "csr_fundamentals": "m4", "module-05-certification": "m5", "module-06-refresher-courses": "m6" }[file];
  var sent = {};             // pageKey -> highest read % the server already has

  function loadDone() { try { done = JSON.parse(localStorage.getItem("df_pace_v1_" + uid) || "{}"); } catch (e) { done = {}; } }
  function saveDone() { try { localStorage.setItem("df_pace_v1_" + uid, JSON.stringify(done)); } catch (e) {} }

  function readSeconds(el) {
    var w = ((el.innerText || el.textContent || "").trim().split(/\s+/).filter(Boolean)).length;
    return Math.max(MIN_READ, Math.min(MAX_READ, Math.round(w / WPM * 60)));
  }
  function clipBottom(el) {
    var b = window.innerHeight;
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if (/(auto|scroll|hidden)/.test(oy) && p.scrollHeight > p.clientHeight + 1) b = Math.min(b, p.getBoundingClientRect().bottom);
    }
    return b;
  }
  function depthOf(el) {
    var r = el.getBoundingClientRect();
    if (r.height <= 0) return 0;
    var vis = Math.min(r.height, Math.max(0, clipBottom(el) - r.top));
    var f = vis / r.height;
    return f >= 0.98 ? 1 : f;
  }
  function key(id) { return file + ":" + id; }
  function isDone(id) { return !!done[key(id)]; }
  /** How much of the page has really been read, 0..1 (unlike progress(), a page unlocked at 50% does not count as 1). */
  function raw(id) { var m = mem[key(id)]; return m ? Math.min(m.depth, m.dwell / m.need, 1) : (sent[key(id)] || 0) / 100; }
  function report(id, force) {
    if (!MOD) return;
    var k = key(id), pct = Math.round(raw(id) * 100), had = sent[k] || 0;
    if (pct <= had || (!force && pct < 100 && pct - had < 10)) return;
    sent[k] = pct;
    DFAuth.paceReport({ module: MOD, page: id, pct: pct, total: adapter.total() });
  }
  function progress(id) { var m = mem[key(id)]; if (!m) return isDone(id) ? 1 : 0; return isDone(id) ? 1 : Math.min(m.depth, m.dwell / m.need, 1); }

  /* ---- hint pill (bottom-left) ---- */
  function ensurePill() {
    if (pill) return pill;
    var css = document.createElement("style");
    css.textContent =
      ".df-locked{opacity:.45 !important;cursor:not-allowed !important;filter:grayscale(.5);}" +
      "#dfPace{position:fixed;left:16px;bottom:16px;z-index:99998;background:#050141;color:#fff;border-radius:14px;padding:10px 14px;font:700 13px Arial,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.3);max-width:290px;transition:opacity .4s,transform .2s;}" +
      "#dfPace .bar{height:6px;border-radius:99px;background:rgba(255,255,255,.25);margin-top:7px;overflow:hidden;position:relative;}" +
      "#dfPace .bar i{display:block;height:100%;background:#19c7ff;border-radius:99px;transition:width .5s;}" +
      "#dfPace .bar b{position:absolute;left:50%;top:-1px;width:2px;height:8px;background:#fff;}" +
      "#dfPace.ok{background:#11663d;}#dfPace.shake{transform:translateX(6px);}#dfPace.hide{opacity:0;pointer-events:none;}" +
      "@media(max-width:640px){#dfPace{left:12px;right:12px;bottom:calc(var(--df-track-h,0px) + 20px);max-width:none;}.df-next-row{margin-bottom:240px !important;}.controls,.actions{margin-bottom:150px !important;}}";
    document.head.appendChild(css);
    pill = document.createElement("div");
    pill.id = "dfPace"; pill.setAttribute("role", "status"); pill.setAttribute("aria-live", "polite");
    document.body.appendChild(pill);
    return pill;
  }
  function showPill(id, flash) {
    var p = ensurePill(), r = raw(id), pct = Math.round(r * 100);
    clearTimeout(pillTimer);
    p.classList.remove("hide");
    if (r >= 1) {
      p.className = "ok"; p.innerHTML = "✓ Page complete (100%).";
      pillTimer = setTimeout(function () { p.classList.add("hide"); }, 3500);
      return;
    }
    p.className = "";
    var line = isDone(id) ? "Next is unlocked • Page progress " + pct + "% • Read to 100% to count toward completion" :
      (flash ? "Finish reading this page first. " : "") + "Page progress " + pct + "% • Next unlocks at 50%";
    p.innerHTML = "<div>" + line + "</div><div class=\"bar\"><i style=\"width:" + pct + "%\"></i><b></b></div>";
    if (flash) { p.classList.add("shake"); setTimeout(function () { p.classList.remove("shake"); }, 250); }
  }

  /* ---- core ---- */
  function track(id, el) {
    var k = key(id), m = mem[k];
    if (!m) {
      var need = readSeconds(el), had = (sent[k] || 0) / 100;   // carry on from what the server already recorded
      m = mem[k] = { depth: had, dwell: need * had, need: need };
    }
    var d = depthOf(el); if (d > m.depth) m.depth = d;
    return m;
  }
  function evaluate() {
    var cur = adapter.current(); if (!cur) return;
    var el = adapter.el(cur);
    if (!el) return;
    var m = track(cur.id, el);
    if (curKey !== key(cur.id)) { curKey = key(cur.id); m.need = readSeconds(el); }
    if (!isDone(cur.id) && progress(cur.id) >= UNLOCK) { done[key(cur.id)] = true; saveDone(); }
    adapter.paint(cur, isDone(cur.id));
    paintModuleLinks();
    report(cur.id, false);
    // keep the hint visible until the page reaches 100%; then say so once
    if (raw(cur.id) < 1) { showPill(cur.id, false); wasLocked[key(cur.id)] = true; }
    else if (!announced[key(cur.id)]) { announced[key(cur.id)] = true; if (wasLocked[key(cur.id)]) showPill(cur.id, false); }
  }
  function tick() {
    var cur = adapter.current(); if (!cur) return;
    var m = mem[key(cur.id)];
    if (m && document.visibilityState === "visible") m.dwell += 1;
    evaluate();
  }

  /** Is a forward move from page index `from` to index `to` allowed? Every page from `from` up to `to-1` must be complete. */
  function allowForward(pages, from, to) {
    if (to <= from) return true;
    for (var i = from; i < to && i < pages.length; i++) if (!isDone(pages[i].id)) return false;
    return true;
  }
  function blocked(id) { showPill(id, true); }
  /** Share of this module's lessons that are complete: "Next Module" unlocks at 50%. */
  function shareDone(pages) { var n = 0; pages.forEach(function (p) { if (isDone(p.id)) n++; }); return pages.length ? n / pages.length : 0; }
  function paintModuleLinks() {
    if (!adapter || !adapter.moduleProgress) return;
    var open = adapter.moduleProgress() >= UNLOCK;
    [].slice.call(document.querySelectorAll("[data-df-next-module]")).forEach(function (b) {
      b.classList.toggle("df-locked", !open); b.setAttribute("aria-disabled", open ? "false" : "true");
    });
  }
  function blockedModule() {
    var p = ensurePill(); clearTimeout(pillTimer);
    p.className = "shake";
    p.textContent = "Next Module unlocks at 50% of this module. You are at " + Math.round(adapter.moduleProgress() * 100) + "%.";
    setTimeout(function () { p.classList.remove("shake"); }, 250);
    pillTimer = setTimeout(function () { p.classList.add("hide"); }, 4000);
  }

  /* ---- adapters ---- */
  function adapterM1() { // Module 1 interactive: sections .page, sidebar .nav-btn, "Start Training" in .actions
    if (typeof window.showPage !== "function" || !document.querySelector(".sidebar .nav-btn")) return null;
    var pages = [].slice.call(document.querySelectorAll("main .page")).filter(function (p) { return p.id !== "assessment"; }).map(function (p) { return { id: p.id, el: p }; });
    var navs = [].slice.call(document.querySelectorAll(".sidebar .nav-btn"));
    function curIdx() { for (var i = 0; i < pages.length; i++) if (!pages[i].el.classList.contains("hidden")) return i; return 0; }
    var orig = window.showPage;
    window.showPage = function (id, btn) {
      var from = curIdx(), to = -1;
      for (var i = 0; i < pages.length; i++) if (pages[i].id === id) to = i;
      if (to > from && !allowForward(pages, from, to)) { blocked(pages[from].id); return; }
      return orig.apply(this, arguments);
    };
    // the Assessment link is an <a> that opens a form: treat it as "after the last lesson"
    [].slice.call(document.querySelectorAll(".sidebar a.nav-btn, .actions a.btn:not([data-df-next-module])")).forEach(function (n) {
      n.addEventListener("click", function (e) {
        var from = curIdx();
        if (!allowForward(pages, from, pages.length)) { e.preventDefault(); e.stopPropagation(); blocked(pages[from].id); }
      }, true);
    });
    return {
      moduleProgress: function () { return shareDone(pages); },
      total: function () { return pages.length; },
      current: function () { return pages[curIdx()]; },
      el: function (p) { return p.el; },
      paint: function (cur, ok) {
        var from = curIdx();
        navs.forEach(function (n, i) {
          var lock = !allowForward(pages, from, i > pages.length - 1 ? pages.length : i) && i > from;
          n.classList.toggle("df-locked", lock); n.setAttribute("aria-disabled", lock ? "true" : "false");
        });
        [].slice.call(cur.el.querySelectorAll(".actions .btn:not([data-df-next-module])")).forEach(function (b) {
          b.classList.toggle("df-locked", !ok); b.setAttribute("aria-disabled", ok ? "false" : "true");
        });
      }
    };
  }
  function adapterM2() { // Module 2 interactive: .tab-btn / .tab-content, showTab(name)
    if (typeof window.showTab !== "function" || !document.querySelector(".tab-btn")) return null;
    var pages = [].slice.call(document.querySelectorAll(".tab-content")).map(function (p) { return { id: p.id, el: p }; });
    var btns = [].slice.call(document.querySelectorAll(".tab-btn"));
    var links = [].slice.call(document.querySelectorAll("a.assessment-btn, .tab-next a:not([data-df-next-module])"));
    links.forEach(function (n) {
      n.addEventListener("click", function (e) {
        var from = curIdx();
        if (!allowForward(pages, from, pages.length)) { e.preventDefault(); e.stopPropagation(); blocked(pages[from].id); }
      }, true);
    });
    function curIdx() { for (var i = 0; i < pages.length; i++) if (pages[i].el.classList.contains("active")) return i; return 0; }
    var orig = window.showTab;
    window.showTab = function (name) {
      var from = curIdx(), to = -1;
      for (var i = 0; i < pages.length; i++) if (pages[i].id === name) to = i;
      if (to > from && !allowForward(pages, from, to)) { blocked(pages[from].id); return; }
      return orig.apply(this, arguments);
    };
    return {
      moduleProgress: function () { return shareDone(pages); },
      total: function () { return pages.length; },
      current: function () { return pages[curIdx()]; },
      el: function (p) { return p.el; },
      paint: function (cur, ok) {
        var from = curIdx();
        function set(b, lock) { b.classList.toggle("df-locked", lock); b.setAttribute("aria-disabled", lock ? "true" : "false"); }
        btns.forEach(function (b, i) { set(b, i > from && !allowForward(pages, from, i)); });
        links.forEach(function (b) { set(b, !allowForward(pages, from, pages.length)); });
        [].slice.call(cur.el.querySelectorAll(".tab-next button")).forEach(function (b) { set(b, !ok); });
      }
    };
  }
  function adapterCSR() { // Module 4 CSR fundamentals: P[] pages, cur index, next(), goModule(m)
    if (typeof window.next !== "function" || typeof window.render !== "function" || !document.getElementById("content") || typeof P === "undefined") return null;
    function ids() { return P.map(function (p, i) { return { id: "p" + i }; }); }
    var pages = ids();
    function idx() { return typeof cur === "number" ? cur : 0; }
    var origNext = window.next, origGo = window.goModule;
    window.next = function () {
      var i = idx();
      if (i < P.length - 1 && !isDone("p" + i)) { blocked("p" + i); return; }
      if (i === P.length - 1 && !isDone("p" + i)) { blocked("p" + i); return; } // "Finish" counts too
      return origNext.apply(this, arguments);
    };
    if (typeof origGo === "function") window.goModule = function (m) {
      var to = P.findIndex(function (x) { return x.m === m; }), from = idx();
      if (to > from && !allowForward(pages, from, to)) { blocked("p" + from); return; }
      return origGo.apply(this, arguments);
    };
    return {
      moduleProgress: function () { return shareDone(pages); },
      total: function () { return pages.length; },
      current: function () { return pages[idx()]; },
      el: function () { return document.getElementById("content"); },
      paint: function (c, ok) {
        var b = document.querySelector("#content .nav.next");
        if (b) { b.classList.toggle("df-locked", !ok); b.setAttribute("aria-disabled", ok ? "false" : "true"); }
      }
    };
  }

  function adapterSingle() { // Modules 3, 5, 6: one page with a "Next Module" link marked data-df-next
    var links = [].slice.call(document.querySelectorAll("[data-df-next]"));
    var main = document.querySelector("main");
    if (!links.length || !main) return null;
    var page = { id: "page", el: main };
    links.forEach(function (n) {
      n.addEventListener("click", function (e) {
        if (!isDone("page")) { e.preventDefault(); e.stopPropagation(); blocked("page"); }
      }, true);
    });
    return {
      total: function () { return 1; },
      current: function () { return page; },
      el: function (p) { return p.el; },
      paint: function (cur, ok) {
        links.forEach(function (b) { b.classList.toggle("df-locked", !ok); b.setAttribute("aria-disabled", ok ? "false" : "true"); });
      }
    };
  }

  function start() {
    var me = DFAuth.current();
    if (!me || me.role === "admin") return;   // staff only
    uid = me.id; loadDone();
    var server = MOD ? (DFAuth.getCompletion() || {})[MOD] : null;
    if (server) Object.keys(server.pages).forEach(function (id) {   // progress follows the user to any device
      sent[key(id)] = server.pages[id];
      if (server.pages[id] >= UNLOCK * 100) done[key(id)] = true;
    });
    adapter = adapterM1() || adapterM2() || adapterCSR() || adapterSingle();
    if (!adapter) return;
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-df-next-module]");
      if (a && adapter.moduleProgress && adapter.moduleProgress() < UNLOCK) { e.preventDefault(); e.stopPropagation(); blockedModule(); }
    }, true);
    window.addEventListener("scroll", evaluate, true);
    window.addEventListener("resize", evaluate);
    window.addEventListener("pagehide", function () { var c = adapter.current(); if (c) report(c.id, true); });
    document.addEventListener("click", function () { setTimeout(evaluate, 60); }, true);
    setInterval(tick, 1000);
    setTimeout(evaluate, 200);
    window.DFPace = { progress: function () { var c = adapter.current(); return c ? progress(c.id) : 0; }, isDone: isDone };
  }
  DFAuth.onReady(start);
})();
