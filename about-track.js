/* About Us gatekeeper (client side).
 * - Locked-down player: no seeking / skipping, no speed changes, pauses when the tab is hidden.
 * - Sends a heartbeat (video position + tab visibility) to /api/about/beat every few seconds.
 * The SERVER decides what counts (functions/api/[[path]].js): only in-order playback at normal speed earns
 * credit, and time on page only accrues while the tab is visible. This file just keeps the viewer honest and
 * shows their progress; it cannot mark About Us complete by itself.
 */
(function () {
  "use strict";
  var HEARTBEAT_MS = 5000;
  var SEEK_TOLERANCE = 1.6; // seconds of normal playback jitter

  function fmt(s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
  function $(id) { return document.getElementById(id); }

  DFAuth.onReady(init);

  function init() {
    if (!window.DFAuth || !DFAuth.current()) return;
    var v = $("aboutVideo"), box = $("aboutTrack");
    if (!v || !box) return;

    var about = DFAuth.getAbout() || {};
    var settings = DFAuth.getSettings();
    var minSec = about.minSec || settings.aboutMinSec || 300;
    var gateOn = !!settings.aboutGate;

    var playBtn = $("apPlay"), muteBtn = $("apMute"), fullBtn = $("apFull");
    var fill = $("apFill"), timeTxt = $("apTime"), wrap = $("aboutPlayer");
    var statusEl = $("atStatus"), vidBar = $("atVid"), vidTxt = $("atVidTxt"), timeBar = $("atTime"), timeBarTxt = $("atTimeTxt"), msgEl = $("atMsg"), nextEl = $("atNext");
    var minutes = Math.max(1, Math.round(minSec / 60));
    $("atMin").textContent = minutes + (minutes === 1 ? " minute" : " minutes");

    var completed = !!about.completed;
    var serverPageSec = about.pageSec || 0;
    var videoPct = about.videoPct || 0;
    var beatAt = 0;
    var ready = false, failed = false, lastGood = 0;

    function msg(t, kind) { msgEl.textContent = t || ""; msgEl.className = "at-msg" + (kind ? " " + kind : ""); }

    function render() {
      var pageSec = serverPageSec;
      if (!completed && beatAt && document.visibilityState === "visible") pageSec += Math.min(20, (Date.now() - beatAt) / 1000);
      var vp = completed ? 100 : videoPct;
      var tp = completed ? 100 : Math.min(100, pageSec / minSec * 100);
      vidBar.style.width = vp + "%";
      vidTxt.textContent = vp + "%";
      timeBar.style.width = tp + "%";
      timeBarTxt.textContent = fmt(Math.min(pageSec, minSec)) + " / " + fmt(minSec);
      if (completed) {
        statusEl.textContent = "Complete ✓"; statusEl.className = "at-badge done";
        nextEl.style.display = "inline-flex";
      } else if (failed) {
        statusEl.textContent = "Video unavailable"; statusEl.className = "at-badge warn";
      } else {
        statusEl.textContent = gateOn ? "Required" : "In progress"; statusEl.className = "at-badge";
      }
      if (ready && v.duration) {
        fill.style.width = Math.min(100, v.currentTime / v.duration * 100) + "%";
        timeTxt.textContent = fmt(v.currentTime) + " / " + fmt(v.duration);
      }
    }

    function done() {
      completed = true;
      msg(gateOn ? "About Us complete. Your completion is recorded and the Modules are now unlocked." : "About Us complete. Your completion is recorded.", "ok");
      render();
    }

    function apply(r) {
      if (!r || r.error) { if (r && r.error) msg(r.error, "err"); return; }
      var a = r.about; if (!a) return;
      serverPageSec = a.pageSec; videoPct = a.videoPct; beatAt = Date.now();
      if (a.completed && !completed) done();
      render();
    }

    var lastSent = 0;
    function beat(keepalive) {
      if (completed || !ready || failed) return;
      lastSent = Date.now();
      DFAuth.aboutBeat({
        pos: v.currentTime,
        duration: v.duration,
        playing: !v.paused && !v.ended,
        visible: document.visibilityState === "visible",
        rate: v.playbackRate,
        ended: v.ended
      }, keepalive).then(apply);
    }

    /* ---- lock the player down ---- */
    v.controls = false;
    v.defaultPlaybackRate = 1;
    v.addEventListener("ratechange", function () { if (v.playbackRate !== 1) v.playbackRate = 1; });
    v.addEventListener("timeupdate", function () {
      if (!v.seeking && v.currentTime - lastGood > -0.5 && v.currentTime - lastGood <= SEEK_TOLERANCE) lastGood = v.currentTime;
      // playback events are not throttled like timers are, so they also drive the heartbeat while playing
      if (!v.paused && Date.now() - lastSent >= HEARTBEAT_MS - 600) beat();
      render();
    });
    v.addEventListener("seeking", function () {
      // any jump (skip ahead or back) is undone; the viewer must play the video through in order
      if (Math.abs(v.currentTime - lastGood) > SEEK_TOLERANCE) {
        v.currentTime = lastGood;
        msg("Skipping is disabled. Please play the video from where it stopped.", "warn");
      }
    });
    v.addEventListener("ended", function () { beat(); lastGood = 0; playBtn.textContent = "Replay"; });
    v.addEventListener("play", function () { playBtn.textContent = "Pause"; beat(); });
    v.addEventListener("pause", function () { if (!v.ended) playBtn.textContent = "Play"; beat(); });
    v.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    v.addEventListener("loadedmetadata", function () { ready = true; failed = false; render(); beat(); });
    function unavailable() {
      failed = true; ready = false; playBtn.disabled = true;
      wrap.classList.add("ap-missing");
      msg("The About Us video is not available yet. Please tell your administrator.", "err");
      render();
    }
    v.addEventListener("error", unavailable);
    var src = v.querySelector("source");
    if (src) src.addEventListener("error", unavailable);

    /* ---- custom controls (no seek bar on purpose) ---- */
    playBtn.addEventListener("click", function () { if (v.paused || v.ended) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
    muteBtn.addEventListener("click", function () { v.muted = !v.muted; muteBtn.textContent = v.muted ? "Unmute" : "Mute"; });
    fullBtn.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap.requestFullscreen) wrap.requestFullscreen();
    });

    /* ---- stay on the page: pause when the tab is hidden, count time only while visible ---- */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        if (!v.paused) { v.pause(); msg("Paused because this tab was hidden. Come back to this page to continue.", "warn"); }
        beat(true);
      } else { beatAt = Date.now(); }
    });
    window.addEventListener("pagehide", function () { beat(true); });

    setInterval(beat, HEARTBEAT_MS);
    setInterval(render, 1000);

    if (completed) done();
    else if (gateOn) msg("Watch the whole video, then keep this page open until the time bar is full.", "");
    render();
    if (v.readyState >= 1) { ready = true; render(); beat(); }
    if (v.error) unavailable();
  }
})();
