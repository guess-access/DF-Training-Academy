/* DealerFocus Training Academy — Auth + Roles + Progress (front-end v1)
 * Roles: admin (all backend functions, view/edit results/progress/usage) / user (own logs only)
 * Storage: localStorage (demo, no server). Swap to Supabase via supabase-schema.sql for production.
 * Keys: df_users_v1, df_session_v1, df_progress_<uid>, df_attempts_<uid>, df_usage_<uid>, df_settings_v1
 */
(function () {
  "use strict";
  var USERS_KEY = "df_users_v1";
  var SESSION_KEY = "df_session_v1";
  var SETTINGS_KEY = "df_settings_v1";
  var ADMIN_CODE = "DEALER-ADMIN-2026";
  var PASS_DEFAULT = 80;

  var MODULES = [
    { id: "m1", title: "Module 01 — All About the USA", href: "module-01-usa.html", quiz: "quiz_m1_usa" },
    { id: "m2", title: "Module 02 — Vehicle 101", href: "module-02-vehicle101.html", quiz: "quiz_m2_vehicle" },
    { id: "m3", title: "Module 03 — Program Software & Tools", href: "module-03-software-tools.html", quiz: "quiz_m3_tools" },
    { id: "m4", title: "Module 04 — CSR Fundamentals", href: "module-04-csr-fundamentals.html", quiz: "quiz_m4_csr" },
    { id: "m5", title: "Module 05 — Certification (Final)", href: "module-05-certification.html", quiz: "quiz_final" },
    { id: "m6", title: "Module 06 — Refresher Courses", href: "module-06-refresher-courses.html", quiz: "quiz_m6_refresh" }
  ];

  function loadJSON(k, fb) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function uid() { return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function nowISO() { return new Date().toISOString(); }

  async function sha256(str) {
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("df$" + str));
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) { return "plain$" + str; } // non-secure context fallback
  }

  function getSettings() {
    var s = loadJSON(SETTINGS_KEY, null);
    if (!s) { s = { passPct: PASS_DEFAULT, modules: MODULES }; saveJSON(SETTINGS_KEY, s); }
    return s;
  }
  function getUsers() { return loadJSON(USERS_KEY, []); }
  function saveUsers(u) { saveJSON(USERS_KEY, u); }

  async function seed() {
    var users = getUsers();
    if (users.length === 0) {
      users = [
        { id: uid(), name: "Site Admin", email: "admin@dealerfocus.com", pass: await sha256("Admin123!"), role: "admin", createdAt: nowISO(), logins: 0, lastActive: null },
        { id: uid(), name: "Demo Trainee", email: "user@dealerfocus.com", pass: await sha256("User123!"), role: "user", createdAt: nowISO(), logins: 0, lastActive: null }
      ];
      saveUsers(users);
    }
    getSettings();
    // migrate legacy single-browser cert progress into whoever logs in next (handled on login)
  }

  function currentUser() {
    var sid = loadJSON(SESSION_KEY, null);
    if (!sid) return null;
    var users = getUsers();
    for (var i = 0; i < users.length; i++) if (users[i].id === sid.uid) return users[i];
    return null;
  }

  function progressKey(id) { return "df_progress_" + id; }
  function attemptsKey(id) { return "df_attempts_" + id; }
  function usageKey(id) { return "df_usage_" + id; }

  function getProgress(id) { return loadJSON(progressKey(id), { modules: {}, quizzes: {} }); }
  function getAttempts(id) { return loadJSON(attemptsKey(id), []); }
  function getUsage(id) { return loadJSON(usageKey(id), { views: [], logins: [] }); }

  function migrateLegacy(user) {
    try {
      var raw = localStorage.getItem("dfCert_v1");
      if (!raw) return;
      var legacy = JSON.parse(raw);
      var p = getProgress(user.id);
      var map = { m1: "m1", m2: "m2", m3: "m3", m4: "m4" };
      Object.keys(map).forEach(function (k) { if (legacy.modules && legacy.modules[k]) p.modules[map[k]] = { done: true, at: nowISO() }; });
      if (legacy.written && legacy.written.score !== null && legacy.written.score !== undefined) {
        p.quizzes["quiz_final"] = { score: legacy.written.score, passed: legacy.written.score >= getSettings().passPct, at: nowISO() };
        var at = getAttempts(user.id);
        at.push({ id: uid(), quiz: "quiz_final", score: legacy.written.score, total: 100, passed: legacy.written.score >= getSettings().passPct, at: nowISO(), source: "migrated" });
        saveJSON(attemptsKey(user.id), at);
      }
      saveJSON(progressKey(user.id), p);
      localStorage.removeItem("dfCert_v1");
    } catch (e) {}
  }

  async function signup(name, email, password, adminCode) {
    email = (email || "").trim().toLowerCase();
    if (!name || !email || !password) return { error: "Name, email and password are required." };
    if (password.length < 6) return { error: "Password must be at least 6 characters." };
    var users = getUsers();
    for (var i = 0; i < users.length; i++) if (users[i].email === email) return { error: "Email already registered. Please log in." };
    var role = "user";
    if (adminCode && adminCode === ADMIN_CODE) role = "admin";
    else if (adminCode) return { error: "Invalid admin code. Leave it blank to register as User." };
    var u = { id: uid(), name: name.trim(), email: email, pass: await sha256(password), role: role, createdAt: nowISO(), logins: 0, lastActive: nowISO() };
    users.push(u);
    saveUsers(users);
    saveJSON(SESSION_KEY, { uid: u.id, at: nowISO() });
    touchLogin(u.id);
    migrateLegacy(u);
    return { user: strip(u) };
  }

  async function login(email, password) {
    email = (email || "").trim().toLowerCase();
    var users = getUsers();
    var h = await sha256(password);
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === email && users[i].pass === h) {
        saveJSON(SESSION_KEY, { uid: users[i].id, at: nowISO() });
        touchLogin(users[i].id);
        migrateLegacy(users[i]);
        return { user: strip(users[i]) };
      }
    }
    return { error: "Invalid email or password." };
  }

  function logout() { localStorage.removeItem(SESSION_KEY); location.href = "login.html"; }
  function strip(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }; }

  function touchLogin(id) {
    var users = getUsers();
    var usage = getUsage(id);
    for (var i = 0; i < users.length; i++) if (users[i].id === id) {
      users[i].logins = (users[i].logins || 0) + 1; users[i].lastActive = nowISO();
    }
    saveUsers(users);
    usage.logins.push({ at: nowISO(), ua: navigator.userAgent.slice(0, 120) });
    usage.logins = usage.logins.slice(-200);
    saveJSON(usageKey(id), usage);
  }

  function trackView(page) {
    var me = currentUser();
    if (!me) return;
    var usage = getUsage(me.id);
    usage.views.push({ at: nowISO(), page: page || location.pathname.split("/").pop() });
    usage.views = usage.views.slice(-500);
    saveJSON(usageKey(me.id), usage);
    var users = getUsers();
    for (var i = 0; i < users.length; i++) if (users[i].id === me.id) users[i].lastActive = nowISO();
    saveUsers(users);
  }

  function logDwell(page, sec) {
    var m = currentUser(); if (!m) return;
    var u = getUsage(m.id);
    u.dwell = u.dwell || {};
    u.dwell[page] = (u.dwell[page] || 0) + sec;
    saveJSON(usageKey(m.id), u);
  }

  function markModule(id, done) {
    var me = currentUser(); if (!me) return;
    var p = getProgress(me.id);
    if (done === undefined) done = true;
    if (done) p.modules[id] = { done: true, at: nowISO() };
    else delete p.modules[id];
    saveJSON(progressKey(me.id), p);
  }

  function logQuiz(quizId, score, total, extra) {
    var me = currentUser(); if (!me) return null;
    total = total || 100;
    var pct = Math.round((score / total) * 100);
    var passed = pct >= getSettings().passPct;
    var p = getProgress(me.id);
    var prev = p.quizzes[quizId];
    if (!prev || pct >= prev.score) p.quizzes[quizId] = { score: pct, passed: passed, at: nowISO() };
    saveJSON(progressKey(me.id), p);
    var at = getAttempts(me.id);
    var rec = { id: uid(), quiz: quizId, score: pct, raw: score, total: total, passed: passed, at: nowISO() };
    if (extra) rec.extra = extra;
    at.push(rec);
    saveJSON(attemptsKey(me.id), at.slice(-200));
    return rec;
  }

  /* ---- admin ops (guarded) ---- */
  function requireAdmin() { var me = currentUser(); return (me && me.role === "admin") ? me : null; }
  function adminListUsers() {
    if (!requireAdmin()) return { error: "Admin only." };
    return getUsers().map(function (u) {
      var p = getProgress(u.id), at = getAttempts(u.id), us = getUsage(u.id);
      var mods = Object.keys(p.modules || {}).length;
      var cert = isCertified(u.id);
      return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, logins: u.logins || us.logins.length, lastActive: u.lastActive, modulesDone: mods + "/6", attempts: at.length, best: bestScore(u.id), certified: cert };
    });
  }
  function bestScore(id) { var p = getProgress(id); var s = Object.keys(p.quizzes || {}).map(function (k) { return p.quizzes[k].score; }); return s.length ? Math.max.apply(null, s) : null; }
  function isCertified(id) {
    var p = getProgress(id); var s = getSettings();
    var need = ["m1", "m2", "m3", "m4"];
    var ok = need.every(function (m) { return p.modules && p.modules[m]; });
    var f = p.quizzes && p.quizzes["quiz_final"];
    return !!(ok && f && f.score >= s.passPct);
  }
  function adminGetUser(id) {
    if (!requireAdmin()) return { error: "Admin only." };
    var users = getUsers(); var u = null;
    users.forEach(function (x) { if (x.id === id) u = x; });
    if (!u) return { error: "Not found." };
    return { user: strip(u), progress: getProgress(id), attempts: getAttempts(id), usage: getUsage(id), certified: isCertified(id) };
  }
  function adminSetRole(id, role) {
    if (!requireAdmin()) return { error: "Admin only." };
    if (role !== "admin" && role !== "user") return { error: "Bad role." };
    var users = getUsers();
    for (var i = 0; i < users.length; i++) if (users[i].id === id) users[i].role = role;
    saveUsers(users); return { ok: true };
  }
  function adminResetProgress(id) {
    if (!requireAdmin()) return { error: "Admin only." };
    localStorage.removeItem(progressKey(id)); localStorage.removeItem(attemptsKey(id));
    return { ok: true };
  }
  function adminSetQuizScore(id, quiz, score) {
    if (!requireAdmin()) return { error: "Admin only." };
    score = Math.max(0, Math.min(100, Number(score)));
    var p = getProgress(id);
    p.quizzes[quiz] = { score: score, passed: score >= getSettings().passPct, at: nowISO(), editedByAdmin: true };
    saveJSON(progressKey(id), p);
    var at = getAttempts(id);
    at.push({ id: uid(), quiz: quiz, score: score, total: 100, passed: score >= getSettings().passPct, at: nowISO(), source: "admin-edit" });
    saveJSON(attemptsKey(id), at);
    return { ok: true };
  }
  function adminDeleteUser(id) {
    var me = requireAdmin(); if (!me) return { error: "Admin only." };
    if (me.id === id) return { error: "Cannot delete yourself." };
    saveUsers(getUsers().filter(function (u) { return u.id !== id; }));
    localStorage.removeItem(progressKey(id)); localStorage.removeItem(attemptsKey(id)); localStorage.removeItem(usageKey(id));
    return { ok: true };
  }

  function guardHTML() {
    // Entire site is private: every page requires an active login session.
    // Only login.html itself is public (otherwise nobody could sign in).
    var me = currentUser();
    var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (file === "" ) file = "index.html";
    var adminPages = ["admin-dashboard.html", "admin.html"];
    if (file === "login.html") {
      if (me) { var n = new URLSearchParams(location.search).get("next"); location.href = n || (me.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html"); }
      return;
    }
    if (!me) { location.href = "login.html?next=" + encodeURIComponent(file); return; }
    if (adminPages.indexOf(file) >= 0 && me.role !== "admin") { location.href = "user-dashboard.html"; return; }
  }

  function navHTML() {
    // Keep the original training-module nav identical on every page;
    // auth.js only appends the session link (Login / Dashboard + Logout).
    var me = currentUser();
    if (!me) return '<a href="login.html" style="font-weight:800">Login</a>';
    var dash = me.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html";
    var label = me.role === "admin" ? "Admin" : "My Progress";
    return '<a href="' + dash + '" style="font-weight:800">' + label + '</a>' +
      '<a href="#" id="dfLogout">Logout (' + esc(String(me.name).split(" ")[0]) + ')</a>';
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

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
    seed: seed, signup: signup, login: login, logout: logout, current: currentUser,
    trackView: trackView, markModule: markModule, logQuiz: logQuiz, logDwell: logDwell,
    getProgress: function () { var me = currentUser(); return me ? getProgress(me.id) : null; },
    getAttempts: function () { var me = currentUser(); return me ? getAttempts(me.id) : null; },
    getUsage: function () { var me = currentUser(); return me ? getUsage(me.id) : null; },
    isCertified: function () { var me = currentUser(); return me ? isCertified(me.id) : false; },
    getSettings: getSettings, MODULES: MODULES, ADMIN_CODE_HINT: "Ask admin for code",
    admin: { list: adminListUsers, get: adminGetUser, setRole: adminSetRole, reset: adminResetProgress, setScore: adminSetQuizScore, del: adminDeleteUser,
      saveSettings: function (s) { if (!requireAdmin()) return { error: "Admin only." }; saveJSON(SETTINGS_KEY, s); return { ok: true }; } },
    esc: esc
  };

  seed().then(function () {
    guardHTML();
    injectNav();
    try { trackView(); } catch (e) {}
    // Bridge: if this page has legacy cert code using dfCert_v1, mirror completions into per-user store
    try {
      var me = currentUser();
      if (me) {
        var orig = localStorage.setItem.bind(localStorage);
        // passive: on cert page, after legacy saves, also mark modules — handled by patch below
      }
    } catch (e) {}
    document.dispatchEvent(new Event("df:ready"));
  });
})();
