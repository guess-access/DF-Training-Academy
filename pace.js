/* Module pacing: a "Next" / forward move unlocks only once the CURRENT page is at least 50% complete.
 *
 *   page completion = the smaller of (a) how far down the page the learner has scrolled and
 *                                    (b) time spent on the page vs. its estimated reading time (~220 words/min)
 *
 * so scrolling to the bottom in a second does not count. Backward moves are always free. Staff only: admins are exempt.
 * Finished pages are remembered in this browser (localStorage). This is a pacing aid in the page; the About Us video
 * check is the part enforced on the server.
 *
 * Works for: Module 1 (Next buttons + sidebar + Assessment), Module 2 (Next buttons + tabs + Assessment), Module 4 CSR (Next + section menu).
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
    return vis / r.height;
  }
  function key(id) { return file + ":" + id; }
  function isDone(id) { return !!done[key(id)]; }
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
      "#dfPace.ok{background:#11663d;}#dfPace.shake{transform:translateX(6px);}#dfPace.hide{opacity:0;pointer-events:none;}";
    document.head.appendChild(css);
    pill = document.createElement("div");
    pill.id = "dfPace"; pill.setAttribute("role", "status"); pill.setAttribute("aria-live", "polite");
    document.body.appendChild(pill);
    return pill;
  }
  function showPill(id, flash) {
    var p = ensurePill(), pr = progress(id), pct = Math.round(pr * 100);
    clearTimeout(pillTimer);
    p.classList.remove("hide");
    if (isDone(id)) {
      p.className = "ok"; p.innerHTML = "✓ Page complete. Next is unlocked.";
      pillTimer = setTimeout(function () { p.classList.add("hide"); }, 3500);
    } else {
      p.className = "";
      p.innerHTML = "<div>" + (flash ? "Finish reading this page first. " : "") + "Page progress " + pct + "% • Next unlocks at 50%</div>" +
        "<div class=\"bar\"><i style=\"width:" + Math.min(100, pr / UNLOCK * 100) + "%\"></i><b></b></div>";
      if (flash) { p.classList.add("shake"); setTimeout(function () { p.classList.remove("shake"); }, 250); }
    }
  }

  /* ---- core ---- */
  function track(id, el) {
    var k = key(id), m = mem[k];
    if (!m) m = mem[k] = { depth: 0, dwell: 0, need: readSeconds(el) };
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
    // keep the hint visible while locked; once complete, say so only once per page
    if (!isDone(cur.id)) showPill(cur.id, false);
    else if (!announced[key(cur.id)]) { announced[key(cur.id)] = true; if (wasLocked[key(cur.id)]) showPill(cur.id, false); }
    if (!isDone(cur.id)) wasLocked[key(cur.id)] = true;
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
    [].slice.call(document.querySelectorAll(".sidebar a.nav-btn, .actions a.btn")).forEach(function (n) {
      n.addEventListener("click", function (e) {
        var from = curIdx();
        if (!allowForward(pages, from, pages.length)) { e.preventDefault(); e.stopPropagation(); blocked(pages[from].id); }
      }, true);
    });
    return {
      current: function () { return pages[curIdx()]; },
      el: function (p) { return p.el; },
      paint: function (cur, ok) {
        var from = curIdx();
        navs.forEach(function (n, i) {
          var lock = !allowForward(pages, from, i > pages.length - 1 ? pages.length : i) && i > from;
          n.classList.toggle("df-locked", lock); n.setAttribute("aria-disabled", lock ? "true" : "false");
        });
        [].slice.call(cur.el.querySelectorAll(".actions .btn")).forEach(function (b) {
          b.classList.toggle("df-locked", !ok); b.setAttribute("aria-disabled", ok ? "false" : "true");
        });
      }
    };
  }
  function adapterM2() { // Module 2 interactive: .tab-btn / .tab-content, showTab(name)
    if (typeof window.showTab !== "function" || !document.querySelector(".tab-btn")) return null;
    var pages = [].slice.call(document.querySelectorAll(".tab-content")).map(function (p) { return { id: p.id, el: p }; });
    var btns = [].slice.call(document.querySelectorAll(".tab-btn"));
    var links = [].slice.call(document.querySelectorAll("a.assessment-btn, .tab-next a"));
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
      current: function () { return pages[idx()]; },
      el: function () { return document.getElementById("content"); },
      paint: function (c, ok) {
        var b = document.querySelector("#content .nav.next");
        if (b) { b.classList.toggle("df-locked", !ok); b.setAttribute("aria-disabled", ok ? "false" : "true"); }
      }
    };
  }

  function start() {
    var me = DFAuth.current();
    if (!me || me.role === "admin") return;   // staff only
    uid = me.id; loadDone();
    adapter = adapterM1() || adapterM2() || adapterCSR();
    if (!adapter) return;
    window.addEventListener("scroll", evaluate, true);
    window.addEventListener("resize", evaluate);
    document.addEventListener("click", function () { setTimeout(evaluate, 60); }, true);
    setInterval(tick, 1000);
    setTimeout(evaluate, 200);
    window.DFPace = { progress: function () { var c = adapter.current(); return c ? progress(c.id) : 0; }, isDone: isDone };
  }
  DFAuth.onReady(start);
})();
