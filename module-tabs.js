/* Module lesson buttons: each button under the header opens a panel inside the white box.
 * Button: .mod-tabs [data-tab="name"] (optional data-panel="panel-name" when several buttons share one panel)
 * Panel:  [data-tab-panel="panel-name"]      Any element with data-open-tab="name" works like that button.
 * An <iframe data-src> inside a panel loads the first time its panel opens (?embed=1, plus ?preview=1 in the Trainer view).
 * Pages listen for "dftab" events ({detail: {tab, panel}}) to drive an embedded lesson app. */
(function () {
  "use strict";
  var preview = /[?&]preview=1(&|$)/.test(location.search);
  function $$(sel) { return [].slice.call(document.querySelectorAll(sel)); }
  function panelOf(tab) { var b = document.querySelector('.mod-tabs [data-tab="' + tab + '"]'); return (b && b.getAttribute("data-panel")) || tab; }
  function loadFrames(panel) {
    [].slice.call(panel.querySelectorAll("iframe[data-src]")).forEach(function (f) {
      if (f.getAttribute("src")) return;
      var src = f.getAttribute("data-src");
      if (!/^https?:/i.test(src)) src += (src.indexOf("?") < 0 ? "?" : "&") + "embed=1" + (preview ? "&preview=1" : "");
      f.setAttribute("src", src);
    });
  }
  function show(tab, opts) {
    var panel = panelOf(tab), target = null;
    $$("[data-tab-panel]").forEach(function (p) {
      var on = p.getAttribute("data-tab-panel") === panel;
      p.hidden = !on; if (on) target = p;
    });
    if (!target) return;
    $$(".mod-tabs [data-tab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); });
    loadFrames(target);
    if (!(opts && opts.noScroll)) {
      var bar = document.querySelector(".mod-tabs");
      if (bar && bar.getBoundingClientRect().top < 0) window.scrollTo({ top: Math.max(0, bar.getBoundingClientRect().top + window.scrollY - 12), behavior: "smooth" });
    }
    document.dispatchEvent(new CustomEvent("dftab", { detail: { tab: tab, panel: panel } }));
  }
  /** mark a button active without switching panels (used when an embedded app changes lesson by itself) */
  function mark(tab) { $$(".mod-tabs [data-tab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === tab); }); }
  window.DFTabs = { show: show, mark: mark };
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(".mod-tabs [data-tab], [data-open-tab]");
    if (!t) return;
    if (t.tagName === "A" && t.getAttribute("target") === "_blank") return;   // e.g. an assessment form
    e.preventDefault();
    if (t.classList.contains("df-locked")) return;
    show(t.getAttribute("data-open-tab") || t.getAttribute("data-tab"));
  });
  document.addEventListener("DOMContentLoaded", function () { if (document.querySelector("[data-tab-panel]")) show("welcome", { noScroll: true }); });
})();
