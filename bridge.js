/* DealerFocus bridge v2: one connected pipeline — every module records process + scores into the per-user log (progress page). Loads after auth.js. */
(function () {
  var MAP = [
    { match: /module-01-usa-interactive/i, module: "m1", quiz: "quiz_m1_usa", title: "Module 01" },
    { match: /module-01-usa\.html/i, module: "m1", quiz: "quiz_m1_usa", title: "Module 01" },
    { match: /module-02-vehicle101-interactive/i, module: "m2", quiz: "quiz_m2_vehicle", title: "Module 02" },
    { match: /module-02-vehicle101\.html/i, module: "m2", quiz: "quiz_m2_vehicle", title: "Module 02" },
    { match: /module-03-software/i, module: "m3", quiz: "quiz_m3_tools", title: "Module 03" },
    { match: /module-04-csr/i, module: "m4", quiz: "quiz_m4_csr", title: "Module 04" },
    { match: /csr_fundamentals/i, module: "m4", quiz: "quiz_m4_csr", title: "Module 04" },
    { match: /module-05-certification/i, module: "m5", quiz: "quiz_final", title: "Module 05" },
    { match: /module-06-refresher/i, module: "m6", quiz: "quiz_m6_refresh", title: "Module 06" }
  ];
  function detect() {
    var f = (location.pathname.split("/").pop() || "index.html");
    for (var i = 0; i < MAP.length; i++) if (MAP[i].match.test(f)) return MAP[i];
    return null;
  }
  function DF() { return window.DFAuth; }
  function me() { return DF() && DF().current(); }
  function passPct() { try { return DF().getSettings().passPct; } catch (e) { return 80; } }

  /* ---- process recording: dwell time on every module page ---- */
  var t0 = Date.now();
  function sendDwell() {
    try {
      if (!me()) return;
      var s = Math.round((Date.now() - t0) / 1000);
      if (s >= 5) DF().logDwell(location.pathname.split("/").pop(), s);
      t0 = Date.now();
    } catch (e) {}
  }
  window.addEventListener("pagehide", sendDwell);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sendDwell(); });

  /* ---- Module 01: final quiz ---- */
  function hookGradeQuiz(ctx) {
    try {
      if (typeof window.gradeQuiz === "function" && !window.gradeQuiz.__df) {
        var orig = window.gradeQuiz;
        window.gradeQuiz = function () {
          var r = orig.apply(this, arguments);
          try {
            if (typeof questions !== "undefined" && questions.length && me()) {
              var score = 0;
              questions.forEach(function (q, i) {
                var sel = document.querySelector('input[name="q' + i + '"]:checked');
                if (sel && Number(sel.value) === q[2]) score++;
              });
              DF().logQuiz(ctx.quiz, score, questions.length, { page: location.pathname });
              if (Math.round(score / questions.length * 100) >= passPct()) DF().markModule(ctx.module, true);
            }
          } catch (e) {}
          return r;
        };
        window.gradeQuiz.__df = true;
      }
    } catch (e) {}
  }

  /* ---- Module 02 interactive: tab visits ---- */
  var m2tabs = {};
  function hookM2(ctx) {
    try {
      if (typeof window.showTab === "function" && !window.showTab.__df) {
        var orig = window.showTab;
        window.showTab = function (name) {
          var r = orig.apply(this, arguments);
          try {
            if (me() && name) {
              m2tabs[name] = true;
              if (Object.keys(m2tabs).length >= 2) DF().markModule(ctx.module, true);
            }
          } catch (e) {}
          return r;
        };
        window.showTab.__df = true;
      }
    } catch (e) {}
  }

  /* ---- Module 04 (csr_fundamentals): knowledge checks + quality form + finish ---- */
  var csr = { ok: 0, n: 0 };
  function csrLog(ctx) {
    try {
      if (!me() || !csr.n) return;
      var pct = Math.round(csr.ok / csr.n * 100);
      DF().logQuiz(ctx.quiz, csr.ok, csr.n, { page: "csr_fundamentals", live: true });
      if (csr.n >= 3 && pct >= passPct()) DF().markModule(ctx.module, true);
    } catch (e) {}
  }
  function hookCSR(ctx) {
    try {
      if (typeof window.ans === "function" && !window.ans.__df) {
        var oAns = window.ans;
        window.ans = function (btn, i, a, w) {
          var r = oAns.apply(this, arguments);
          try { csr.n++; if (i === a) csr.ok++; csrLog(ctx); } catch (e) {}
          return r;
        };
        window.ans.__df = true;
      }
      if (typeof window.sp === "function" && !window.sp.__df) {
        var oSp = window.sp;
        window.sp = function (btn, ok) {
          var r = oSp.apply(this, arguments);
          try { csr.n++; if (ok) csr.ok++; csrLog(ctx); } catch (e) {}
          return r;
        };
        window.sp.__df = true;
      }
      if (typeof window.updateQualityScore === "function" && !window.updateQualityScore.__df) {
        var oQ = window.updateQualityScore;
        window.updateQualityScore = function () {
          var r = oQ.apply(this, arguments);
          try {
            var el = document.getElementById("qscore");
            var m = el ? el.textContent.match(/(\d+)\s*\/\s*(\d+)/) : null;
            if (m && me()) {
              var sc = Number(m[1]), tot = Number(m[2]) || 100;
              DF().logQuiz(ctx.quiz, sc, tot, { page: "csr_fundamentals", source: "quality-form" });
              if (Math.round(sc / tot * 100) >= passPct()) DF().markModule(ctx.module, true);
            }
          } catch (e) {}
          return r;
        };
        window.updateQualityScore.__df = true;
      }
      if (typeof window.next === "function" && !window.next.__df) {
        var oN = window.next;
        window.next = function () {
          var r = oN.apply(this, arguments);
          try {
            if (me() && typeof cur !== "undefined" && typeof P !== "undefined" && cur >= P.length - 1) {
              if (csr.n === 0 || Math.round(csr.ok / Math.max(1, csr.n) * 100) >= passPct()) DF().markModule(ctx.module, true);
            }
          } catch (e) {}
          return r;
        };
        window.next.__df = true;
      }
    } catch (e) {}
  }

  /* ---- Module 05 certification: two-way sync with per-user log ---- */
  var certReverseDone = false;
  function syncCertToUser() {
    try {
      if (!me()) return;
      if (!/module-05-certification/i.test(location.pathname)) return;
      var checks = document.querySelectorAll("#moduleList .cert-check");
      var ids = ["m1", "m2", "m3", "m4"];
      checks.forEach(function (c, i) { if (ids[i]) DF().markModule(ids[i], c.classList.contains("done")); });
      if (DF().isCertified()) DF().markModule("m5", true);
    } catch (e) {}
  }
  function syncUserToCert() {
    // If modules were completed in their own trainings, reflect them on the cert checklist.
    try {
      if (certReverseDone || !me()) return;
      if (!/module-05-certification/i.test(location.pathname)) return;
      var p = DF().getProgress();
      if (!p || !p.modules) return;
      var btns = document.querySelectorAll('#moduleList [data-toggle]');
      if (!btns.length) return; // legacy list not rendered yet
      certReverseDone = true;
      var ids = ["m1", "m2", "m3", "m4"];
      var checks = document.querySelectorAll("#moduleList .cert-check");
      checks.forEach(function (c, i) {
        if (ids[i] && p.modules[ids[i]] && !c.classList.contains("done")) {
          var b = document.querySelector('#moduleList [data-toggle="' + ids[i] + '"]');
          if (b) b.click();
        }
      });
    } catch (e) {}
  }
  function hookCert() {
    try {
      if (typeof window.submitQuiz === "function" && !window.submitQuiz.__df) {
        var orig = window.submitQuiz;
        window.submitQuiz = function (kind) {
          var r = orig.apply(this, arguments);
          try {
            if (me()) {
              setTimeout(function () {
                try {
                  var el = document.getElementById("writtenScoreDisplay");
                  var m = el ? el.textContent.match(/(\d+)%/) : null;
                  if (m) {
                    DF().logQuiz("quiz_final", Number(m[1]), 100, { page: "certification" });
                    if (Number(m[1]) >= passPct()) syncCertToUser();
                  }
                } catch (e) {}
              }, 300);
            }
          } catch (e) {}
          return r;
        };
        window.submitQuiz.__df = true;
      }
    } catch (e) {}
    try { setInterval(syncCertToUser, 2500); } catch (e) {}
    try { setTimeout(syncUserToCert, 1200); setTimeout(syncUserToCert, 3500); } catch (e) {}
  }

  /* ---- floating tracker: same module pipeline, links to progress page ---- */
  function widget(ctx) {
    try {
      if (!me()) return;
      if (document.getElementById("dfTrack")) return;
      var user = me();
      var div = document.createElement("div");
      div.id = "dfTrack";
      div.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#050141;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 12px 34px rgba(0,0,0,.3);font-family:Arial,sans-serif;max-width:300px";
      var p = DF().getProgress();
      var done = p.modules && p.modules[ctx.module];
      var q = p.quizzes && p.quizzes[ctx.quiz];
      var dash = user.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html";
      div.innerHTML =
        '<div style="font-size:12px;font-weight:800;opacity:.8">' + DF().esc(ctx.title.toUpperCase()) + ' • ' + DF().esc(user.name.toUpperCase()) + '</div>' +
        '<div style="font-weight:800;margin:4px 0">' + (done ? '✓ Done — recorded' : 'In progress — auto-recorded') + (q ? ' • Best: ' + q.score + '%' : '') + '</div>' +
        '<div style="font-size:12px;opacity:.75">Quiz + activity feed your progress page automatically.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
        '<button id="dfDone" style="border:0;border-radius:8px;padding:8px 12px;font-weight:800;cursor:pointer;background:#19c7ff;color:#04222e">' + (done ? 'Mark not done' : 'Mark done') + '</button>' +
        '<button id="dfScore" style="border:0;border-radius:8px;padding:8px 12px;font-weight:800;cursor:pointer;background:#fff;color:#050141">Log score</button>' +
        '<a href="' + dash + '" style="border-radius:8px;padding:8px 12px;font-weight:800;background:transparent;color:#fff;border:1px solid #fff;text-decoration:none;font-size:13px">My progress</a>' +
        '</div>';
      document.body.appendChild(div);
      document.getElementById("dfDone").onclick = function () { DF().markModule(ctx.module, !done); location.reload(); };
      document.getElementById("dfScore").onclick = function () {
        var v = prompt("Enter your quiz score 0-100 for " + ctx.quiz + ":");
        if (v === null) return;
        v = Number(v);
        if (!(v >= 0 && v <= 100)) { alert("Enter 0-100"); return; }
        DF().logQuiz(ctx.quiz, v, 100, { page: location.pathname, manual: true });
        if (v >= passPct()) DF().markModule(ctx.module, true);
        location.reload();
      };
    } catch (e) {}
  }

  document.addEventListener("df:ready", function () {
    var ctx = detect();
    if (!ctx) return;
    hookGradeQuiz(ctx);
    hookM2(ctx);
    hookCSR(ctx);
    if (/module-05-certification/i.test(location.pathname)) hookCert();
    widget(ctx);
  });
})();
