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

  /* ---- Module 04 (csr_fundamentals): each knowledge check counts once, on its first answer.
     The score is recorded when every check has been answered, then a new attempt can start. ---- */
  function csrKey() { return "df_csr_v1_" + me().id; }
  function csrMarks() { try { return JSON.parse(localStorage.getItem(csrKey())) || {}; } catch (e) { return {}; } }
  function csrPages() {
    var out = [];
    P.forEach(function (p, i) { if (p.q || (p.b && p.b.indexOf("sp(this") >= 0)) out.push(i); });
    return out;
  }
  function csrResult(ctx, right, total) {
    var pct = Math.round(right / total * 100), pass = pct >= passPct();
    var fb = document.getElementById("fb") || document.getElementById("sf");
    if (!fb) return;
    var box = document.createElement("div");
    box.style.cssText = "margin-top:12px;font-weight:800";
    box.textContent = "Knowledge checks finished: " + right + " of " + total + " correct (" + pct + "%). " + (pass ? "Passed." : "You need " + passPct() + "% to pass. ");
    if (!pass) {
      var again = document.createElement("button");
      again.type = "button"; again.className = "nav"; again.textContent = "Retake the checks";
      again.onclick = function () { cur = csrPages()[0]; answered = false; window.render(); window.scrollTo(0, 0); };
      box.appendChild(again);
    }
    fb.appendChild(box);
  }
  function csrMark(ctx, ok) {
    try {
      if (!me() || typeof cur === "undefined" || typeof P === "undefined") return;
      var pages = csrPages(), marks = csrMarks();
      if (pages.indexOf(cur) < 0 || marks[cur] !== undefined) return;
      marks[cur] = !!ok;
      if (pages.some(function (i) { return marks[i] === undefined; })) {
        localStorage.setItem(csrKey(), JSON.stringify(marks));
        return;
      }
      localStorage.removeItem(csrKey());
      var right = pages.filter(function (i) { return marks[i]; }).length;
      DF().logQuiz(ctx.quiz, right, pages.length, { page: "csr_fundamentals" });
      csrResult(ctx, right, pages.length);
      refreshWidget(ctx);
    } catch (e) {}
  }
  function hookCSR(ctx) {
    try {
      if (typeof window.ans === "function" && !window.ans.__df) {
        var oAns = window.ans;
        window.ans = function (btn, i, a, w) {
          var r = oAns.apply(this, arguments);
          csrMark(ctx, i === a);
          return r;
        };
        window.ans.__df = true;
      }
      if (typeof window.sp === "function" && !window.sp.__df) {
        var oSp = window.sp;
        window.sp = function (btn, ok) {
          var r = oSp.apply(this, arguments);
          csrMark(ctx, ok);
          return r;
        };
        window.sp.__df = true;
      }
    } catch (e) {}
  }

  /* ---- floating tracker: same module pipeline, links to progress page ---- */
  function widget(ctx) {
    try {
      if (!me()) return;
      if (document.getElementById("dfTrack")) return;
      var user = me();
      if (!document.getElementById("dfTrackCss")) {
        var css = document.createElement("style");
        css.id = "dfTrackCss";
        css.textContent = "@media(max-width:640px){#dfTrack{left:12px;right:12px !important;bottom:12px !important;max-width:none !important;padding:10px 12px !important;}#dfTrack .df-hint{display:none;}}";
        document.head.appendChild(css);
      }
      var div = document.createElement("div");
      div.id = "dfTrack";
      div.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;background:#050141;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 12px 34px rgba(0,0,0,.3);font-family:Arial,sans-serif;max-width:300px";
      var p = DF().getProgress();
      var done = p.modules && p.modules[ctx.module];
      var q = p.quizzes && p.quizzes[ctx.quiz];
      var dash = user.role === "admin" ? "admin-dashboard.html" : "user-dashboard.html";
      div.innerHTML =
        '<div style="font-size:12px;font-weight:800;opacity:.8">' + DF().esc(ctx.title.toUpperCase()) + ' • ' + DF().esc(user.name.toUpperCase()) + '</div>' +
        '<div style="font-weight:800;margin:4px 0">' + (done ? '✓ Completed' : 'In progress — auto-recorded') + (q ? ' • Best: ' + q.score + '%' : '') + '</div>' +
        '<div class="df-hint" style="font-size:12px;opacity:.75">Quiz + activity feed your progress page automatically.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
        (ctx.module === "m1" || ctx.module === "m2" ? '<button id="dfScore" style="border:0;border-radius:8px;padding:8px 12px;font-weight:800;cursor:pointer;background:#fff;color:#050141">Log score</button>' : '') +
        '<a href="' + dash + '" style="border-radius:8px;padding:8px 12px;font-weight:800;background:transparent;color:#fff;border:1px solid #fff;text-decoration:none;font-size:13px">My progress</a>' +
        '</div>';
      document.body.appendChild(div);
      document.documentElement.style.setProperty("--df-track-h", div.offsetHeight + "px");
      var logBtn = document.getElementById("dfScore");
      if (logBtn) logBtn.onclick = function () {
        var v = prompt("Enter your quiz score 0-100 for " + ctx.quiz + ":");
        if (v === null) return;
        v = Number(v);
        if (!(v >= 0 && v <= 100)) { alert("Enter 0-100"); return; }
        DF().logQuiz(ctx.quiz, v, 100, { page: location.pathname, manual: true });
        if (v >= passPct()) DF().markModule(ctx.module, true);
        DF().flush().then(function () { location.reload(); });
      };
    } catch (e) {}
  }

  /* show a newly earned score or Completed flag without a page reload */
  function refreshWidget(ctx) {
    DF().reloadState().then(function () {
      var old = document.getElementById("dfTrack");
      if (old) old.remove();
      widget(ctx);
    }).catch(function () {});
  }

  DF().onReady(function () {
    var ctx = detect();
    if (!ctx) return;
    document.addEventListener("df:module-read", function (e) { if (e.detail === ctx.module) refreshWidget(ctx); });
    hookGradeQuiz(ctx);
    hookM2(ctx);
    hookCSR(ctx);
    widget(ctx);
  });
})();
