/* DealerFocus Training Academy — Auth + Roles + Progress (Cloudflare backend)
 * Roles: admin (sees/edits ALL users' results, progress and usage) / user (own progress only)
 * Storage: Cloudflare D1 via /api/* (see functions/api/[[path]].js). The server enforces who can see what;
 * this file only keeps an in-memory copy of the signed-in user's own data so pages can read it synchronously.
 * Pages wait for the "df:ready" event (fired once the session + data are loaded).
 */
(function () {
  "use strict";
  var PASS_DEFAULT = 80;

  var MODULES = [
    { id: "m1", title: "Module 01 — All About the USA", href: "module-01-usa.html", quiz: "quiz_m1_usa" },
    { id: "m2", title: "Module 02 — Vehicle 101", href: "module-02-vehicle101.html", quiz: "quiz_m2_vehicle" },
    { id: "m3", title: "Module 03 — Program Software & Tools", href: "module-03-software-tools.html", quiz: "quiz_m3_tools" },
    { id: "m4", title: "Module 04 — CSR Fundamentals", href: "module-04-csr-fundamentals.html", quiz: "quiz_m4_csr" },
    { id: "m5", title: "Module 05 — Certification (Final)", href: "module-05-certification.html", quiz: "quiz_final" },
    { id: "m6", title: "Module 06 — Refresher Courses", href: "module-06-refresher-courses.html", quiz: "quiz_m6_refresh" }
  ];

  /* ---- in-memory copy of the signed-in user's data (source of truth is the server) ---- */
  var S = emptyState();
  function emptyState() {
    return {
      user: null,
      progress: { modules: {}, quizzes: {} },
      attempts: [],
      usage: { views: [], logins: [], dwell: {} },
      settings: { passPct: PASS_DEFAULT }
    };
  }
  function applyState(r) {
    var e = emptyState();
    S = {
      user: r.user || null,
      progress: r.progress || e.progress,
      attempts: r.attempts || e.attempts,
      usage: r.usage || e.usage,
      settings: r.settings || e.settings
    };
    S.usage.views = S.usage.views || []; S.usage.logins = S.usage.logins || []; S.usage.dwell = S.usage.dwell || {};
  }

  function nowISO() { return new Date().toISOString(); }
  function uid() { return "a_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---- API ---- */
  var pending = [];
  function api(method, path, body, keepalive) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    if (keepalive) opts.keepalive = true;
    return fetch("/api/" + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok && !j.error) j.error = "Request failed (" + r.status + ").";
        return j;
      });
    }).catch(function () { return { error: "Network error. Check your connection and try again." }; });
  }
  function write(path, body) {
    var p = api("POST", path, body, true);
    pending.push(p);
    p.then(function () { var i = pending.indexOf(p); if (i >= 0) pending.splice(i, 1); });
    return p;
  }
  /** Resolves once every progress/score write started so far has reached the server. */
  function flush() { return Promise.all(pending.slice()); }

  function getSettings() { return { passPct: S.settings.passPct, modules: MODULES }; }
  function currentUser() { return S.user; }

  function strip(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }; }

  /* ---- signup / login / logout ---- */
  async function signup(name, email, password, adminCode) {
    name = (name || "").trim(); email = (email || "").trim().toLowerCase();
    if (!name || !email || !password) return { error: "Name, email and password are required." };
    if (password.length < 6) return { error: "Password must be at least 6 characters." };
    var r = await api("POST", "signup", { name: name, email: email, password: password, adminCode: adminCode || "" });
    if (r.error) return r;
    applyState(r);
    await migrateLegacy();
    return { user: strip(S.user) };
  }

  async function login(email, password) {
    var r = await api("POST", "login", { email: (email || "").trim().toLowerCase(), password: password || "" });
    if (r.error) return r;
    applyState(r);
    await migrateLegacy();
    return { user: strip(S.user) };
  }

  function logout() {
    api("POST", "logout", {}).then(function () { S = emptyState(); location.href = "login.html"; });
  }

  /* one-time: move completions from the old single-browser cert tracker (dfCert_v1) into the signed-in account */
  async function migrateLegacy() {
    try {
      var raw = localStorage.getItem("dfCert_v1");
      if (!raw || !S.user) return;
      var legacy = JSON.parse(raw);
      ["m1", "m2", "m3", "m4"].forEach(function (k) { if (legacy.modules && legacy.modules[k]) markModule(k, true); });
      if (legacy.written && legacy.written.score !== null && legacy.written.score !== undefined) logQuiz("quiz_final", legacy.written.score, 100, { source: "migrated" });
      await flush();
      localStorage.removeItem("dfCert_v1");
    } catch (e) {}
  }

  /* ---- usage ---- */
  function trackView(page) {
    if (!S.user) return;
    page = page || location.pathname.split("/").pop() || "index.html";
    S.usage.views.push({ at: nowISO(), page: page });
    write("usage", { kind: "view", page: page });
  }
  function logDwell(page, sec) {
    if (!S.user) return;
    S.usage.dwell[page] = (S.usage.dwell[page] || 0) + sec;
    write("usage", { kind: "dwell", page: page, sec: sec });
  }

  /* ---- progress ---- */
  function markModule(id, done) {
    if (!S.user) return;
    if (done === undefined) done = true;
    var has = !!S.progress.modules[id];
    if (done === has) return; // nothing changed — avoid needless writes
    if (done) S.progress.modules[id] = { done: true, at: nowISO() };
    else delete S.progress.modules[id];
    write("module", { id: id, done: done });
  }

  function logQuiz(quizId, score, total, extra) {
    if (!S.user) return null;
    total = total || 100;
    var pct = Math.round((score / total) * 100);
    var passed = pct >= S.settings.passPct;
    var prev = S.progress.quizzes[quizId];
    if (!prev || pct >= prev.score) S.progress.quizzes[quizId] = { score: pct, passed: passed, at: nowISO() };
    var rec = { id: uid(), quiz: quizId, score: pct, raw: score, total: total, passed: passed, at: nowISO() };
    if (extra) rec.extra = extra;
    S.attempts.push(rec);
    write("quiz", { quiz: quizId, raw: score, total: total, extra: extra || null });
    return rec;
  }

  function isCertified() {
    var p = S.progress;
    var ok = ["m1", "m2", "m3", "m4"].every(function (m) { return p.modules[m]; });
    var f = p.quizzes.quiz_final;
    return !!(ok && f && f.score >= S.settings.passPct);
  }

  /* ---- admin ops (the server rejects non-admins; these are just thin wrappers) ---- */
  var admin = {
    list: function () { return api("GET", "admin/users"); },
    get: function (id) { return api("GET", "admin/user?id=" + encodeURIComponent(id)); },
    setRole: function (id, role) { return api("POST", "admin/role", { id: id, role: role }); },
    reset: function (id) { return api("POST", "admin/reset", { id: id }); },
    setScore: function (id, quiz, score) { return api("POST", "admin/score", { id: id, quiz: quiz, score: Number(score) }); },
    del: function (id) { return api("POST", "admin/delete", { id: id }); },
    saveSettings: function (s) {
      return api("POST", "admin/settings", { passPct: s.passPct }).then(function (r) {
        if (!r.error) S.settings.passPct = Math.round(Number(s.passPct));
        return r;
      });
    }
  };

  /* ---- page guard + nav ---- */
  function guardHTML() {
    // Entire site is private: every page requires an active login session.
    // Only login.html itself is public (otherwise nobody could sign in).
    var me = S.user;
    var file = (location.pathname.split("/").pop() || "index.html").toLowerCase().replace(/\.html$/, "");
    if (file === "") file = "index";
    var adminPages = ["admin-dashboard", "admin"];
    if (file === "login") {
      if (me) { var n = new URLSearchParams(location.search).get("next"); location.href = n || (me.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html"); }
      return;
    }
    if (!me) { location.href = "login.html?next=" + encodeURIComponent(file + ".html"); return; }
    if (adminPages.indexOf(file) >= 0 && me.role !== "admin") { location.href = "user-dashboard.html"; return; }
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function navHTML() {
    var me = S.user;
    if (!me) return '<a href="login.html" style="font-weight:800">Login</a>';
    var dash = me.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html";
    var label = me.role === "admin" ? "Admin" : "My Progress";
    return '<a href="' + dash + '" style="font-weight:800">' + label + '</a>' +
      '<a href="#" id="dfLogout">Logout (' + esc(String(me.name).split(" ")[0]) + ')</a>';
  }

  function injectNav() {
    try {
      var nav = document.querySelector("nav.site-nav");
      if (nav && !document.getElementById("dfAuthLink") && !document.getElementById("dfLogout")) {
        var span = document.createElement("span");
        span.id = "dfAuthLink";
        span.innerHTML = navHTML();
        nav.appendChild(span);
        var lo = document.getElementById("dfLogout");
        if (lo) lo.addEventListener("click", function (e) { e.preventDefault(); logout(); });
      }
    } catch (e) {}
  }

  window.DFAuth = {
    signup: signup, login: login, logout: logout, current: currentUser,
    trackView: trackView, markModule: markModule, logQuiz: logQuiz, logDwell: logDwell, flush: flush,
    getProgress: function () { return S.user ? S.progress : null; },
    getAttempts: function () { return S.user ? S.attempts : null; },
    getUsage: function () { return S.user ? S.usage : null; },
    isCertified: function () { return S.user ? isCertified() : false; },
    getSettings: getSettings, MODULES: MODULES,
    admin: admin, esc: esc
  };

  // remove credential data left in this browser by the old localStorage-only version
  try { localStorage.removeItem("df_users_v1"); localStorage.removeItem("df_session_v1"); } catch (e) {}

  api("GET", "state").then(function (r) {
    applyState(r.error ? {} : r);
    guardHTML();
    injectNav();
    try { trackView(); } catch (e) {}
    document.dispatchEvent(new Event("df:ready"));
  });
})();
