/* Graduation certificate: drawn on a canvas so the on-screen certificate, the PNG and the PDF are identical.
 * No external libraries. DFCertificate.render(canvas, data) -> Promise; then downloadPNG(canvas, data) / downloadPDF(canvas, data).
 * data = { name, score, date, certNo, trainer, trainerTitle, logoUrl }
 */
(function () {
  "use strict";
  var W = 1056, H = 816, SCALE = 3;           // 11 x 8.5 in at 288 dpi
  var NAVY = "#050141", GOLD = "#c99b25", GREY = "#4a4a68";
  var SERIF = "'Playfair Display', Georgia, serif", SANS = "Inter, Arial, sans-serif";

  function spaced(ctx, text, cx, y, spacing) {  // centred text with letter spacing
    var widths = text.split("").map(function (c) { return ctx.measureText(c).width; });
    var total = widths.reduce(function (a, b) { return a + b + spacing; }, -spacing);
    var x = cx - total / 2, align = ctx.textAlign;
    ctx.textAlign = "left";
    text.split("").forEach(function (c, i) { ctx.fillText(c, x, y); x += widths[i] + spacing; });
    ctx.textAlign = align;
  }

  function seal(ctx, cx, cy, size) {
    var s = size / 160, i, a, r;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(s, s);
    var g = ctx.createLinearGradient(0, 0, 160, 160);
    g.addColorStop(0, "#f4d67a"); g.addColorStop(0.55, "#d9a92e"); g.addColorStop(1, "#b98a18");
    ctx.beginPath();
    for (i = 0; i < 64; i++) { a = i / 64 * Math.PI * 2; r = i % 2 ? 66 : 72; ctx.lineTo(80 + r * Math.cos(a), 80 + r * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(80, 80, 58, 0, Math.PI * 2); ctx.fillStyle = NAVY; ctx.fill();
    ctx.beginPath(); ctx.arc(80, 80, 55, 0, Math.PI * 2); ctx.strokeStyle = "#d9a92e"; ctx.lineWidth = 1.2; ctx.stroke();

    // ring text, clockwise from the left
    var text = "DEALERFOCUS  ★  CERTIFIED GRADUATE  ★  ", radius = 46.5;
    ctx.font = "700 9.6px " + SANS; ctx.fillStyle = "#f4d67a"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    var chars = text.split(""), ws = chars.map(function (c) { return ctx.measureText(c).width; });
    var sum = ws.reduce(function (p, v) { return p + v; }, 0), gap = (Math.PI * 2 * radius - sum) / chars.length, theta = Math.PI;
    chars.forEach(function (c, n) {
      var step = (ws[n] + gap) / radius, mid = theta + step / 2;
      ctx.save();
      ctx.translate(80 + radius * Math.cos(mid), 80 + radius * Math.sin(mid));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillText(c, 0, 0);
      ctx.restore();
      theta += step;
    });

    // graduation cap
    ctx.translate(46, 56); ctx.scale(0.567, 0.567);
    ctx.fillStyle = "#d9a92e"; ctx.fill(new Path2D("M26 40v20c0 9 15 15 34 15s34-6 34-15V40L60 54z"));
    ctx.fillStyle = "#f4d67a"; ctx.fill(new Path2D("M60 4L119 27L60 50L1 27Z"));
    ctx.fillStyle = NAVY; ctx.beginPath(); ctx.arc(60, 27, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(new Path2D("M60 27L103 36V63"));
    ctx.fillStyle = "#fff"; ctx.fill(new Path2D("M98 61h10l2 17H96z"));
    ctx.restore();
  }

  function paragraph(ctx, words, cx, y, maxW, lh) {  // centred wrapped text; words = [{t, bold}]
    var font = function (b) { return (b ? "700" : "400") + " 17px " + SANS; };
    var lines = [[]], lineW = 0;
    var space = (ctx.font = font(false), ctx.measureText(" ").width);
    words.forEach(function (w) {
      ctx.font = font(w.bold);
      var wW = ctx.measureText(w.t).width;
      if (lineW && lineW + space + wW > maxW) { lines.push([]); lineW = 0; }
      lineW += (lineW ? space : 0) + wW;
      lines[lines.length - 1].push({ t: w.t, bold: w.bold, w: wW });
    });
    ctx.textAlign = "left";
    lines.forEach(function (ln, i) {
      var total = ln.reduce(function (a, w, k) { return a + w.w + (k ? space : 0); }, 0), x = cx - total / 2;
      ln.forEach(function (w) {
        ctx.font = font(w.bold); ctx.fillStyle = w.bold ? NAVY : "#2b2b4a";
        ctx.fillText(w.t, x, y + i * lh); x += w.w + space;
      });
    });
    ctx.textAlign = "center";
  }

  function loadImage(src) {
    return new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = src; });
  }
  function fontSheet() {   // pages that show a certificate may not load these fonts themselves
    return new Promise(function (ok) {
      if (document.getElementById("dfCertFonts")) return ok();
      var l = document.createElement("link");
      l.id = "dfCertFonts"; l.rel = "stylesheet"; l.onload = ok; l.onerror = ok;
      l.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,500&family=Inter:wght@400;600;700&display=swap";
      document.head.appendChild(l);
      setTimeout(ok, 4000);
    });
  }
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return fontSheet().then(function () { return Promise.all(["700 62px 'Playfair Display'", "italic 500 54px 'Playfair Display'", "400 17px Inter", "600 17px Inter", "700 13px Inter"]
      .map(function (f) { return document.fonts.load(f); })); }).catch(function () {});
  }

  function render(canvas, d) {
    return Promise.all([loadImage(d.logoUrl), loadFonts()]).then(function (res) {
      canvas.width = W * SCALE; canvas.height = H * SCALE;
      var ctx = canvas.getContext("2d"), cx = W / 2;
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = NAVY; ctx.lineWidth = 8; ctx.strokeRect(26, 26, W - 52, H - 52);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.strokeRect(36, 36, W - 72, H - 72);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";

      ctx.drawImage(res[0], cx - 77.5, 78, 155, 62);
      ctx.fillStyle = NAVY; ctx.font = "700 13px " + SANS; spaced(ctx, "DEALERFOCUS TRAINING ACADEMY", cx, 170, 4.2);
      ctx.font = "700 62px " + SERIF; ctx.fillText("Certificate of Graduation", cx, 252);
      ctx.fillStyle = GOLD; ctx.fillRect(cx - 60, 272, 120, 3);
      ctx.fillStyle = GREY; ctx.font = "400 16px " + SANS; ctx.fillText("This certificate is proudly presented to", cx, 322);

      // name shrinks to fit long names
      var size = 54; ctx.font = "italic 500 " + size + "px " + SERIF;
      while (ctx.measureText(d.name).width > 780 && size > 26) { size -= 2; ctx.font = "italic 500 " + size + "px " + SERIF; }
      ctx.fillStyle = NAVY; ctx.fillText(d.name, cx, 388);
      var lineW = Math.max(560, ctx.measureText(d.name).width + 80);
      ctx.fillStyle = GOLD; ctx.fillRect(cx - lineW / 2, 408, lineW, 1.5);

      var words = "for successfully completing all required modules of the DealerFocus Training Academy and passing the Final Certification Assessment with a score of".split(" ").map(function (t) { return { t: t, bold: false }; });
      words.push({ t: d.score + "%.", bold: true });
      paragraph(ctx, words, cx, 452, 720, 27);

      // footer: date, seal, trainer
      var left = 264.5, right = 791.5, colW = 317, lineY = 690;
      ctx.fillStyle = NAVY; ctx.font = "600 17px " + SANS;
      ctx.fillText(d.date, left, lineY - 9); ctx.fillText(d.trainer, right, lineY - 9);
      ctx.fillRect(left - colW / 2, lineY, colW, 1); ctx.fillRect(right - colW / 2, lineY, colW, 1);
      ctx.fillStyle = GREY; ctx.font = "600 11.5px " + SANS;
      spaced(ctx, "DATE AWARDED", left, lineY + 21, 1.4); spaced(ctx, (d.trainerTitle || "DF Trainer").toUpperCase(), right, lineY + 21, 1.4);
      seal(ctx, cx, 646, 138);
      ctx.fillStyle = "#6b6b85"; ctx.font = "400 11px " + SANS; spaced(ctx, "Certificate No. " + d.certNo, cx, 748, 0.9);
    });
  }

  function latin1(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

  /** One-page 11 x 8.5 in PDF holding the certificate as a high-quality JPEG. */
  function pdfFromJpeg(jpeg, pxW, pxH) {
    var parts = [], offsets = [], pos = 0;
    function add(b) { if (typeof b === "string") b = latin1(b); parts.push(b); pos += b.length; }
    function obj(n, body, stream) {
      offsets[n] = pos;
      add(n + " 0 obj\n" + body + "\n");
      if (stream) { add("stream\n"); add(stream); add("\nendstream\n"); }
      add("endobj\n");
    }
    add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    var content = "q 792 0 0 612 0 0 cm /Im0 Do Q";
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    obj(4, "<< /Type /XObject /Subtype /Image /Width " + pxW + " /Height " + pxH + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>", jpeg);
    obj(5, "<< /Length " + content.length + " >>", latin1(content));
    var xref = pos, table = "xref\n0 6\n0000000000 65535 f \n";
    for (var i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    add(table + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  function toBlob(canvas, type, q) { return new Promise(function (ok) { canvas.toBlob(ok, type, q); }); }
  function pngBlob(canvas) { return toBlob(canvas, "image/png"); }
  function pdfBlob(canvas) {
    return toBlob(canvas, "image/jpeg", 0.95).then(function (b) { return b.arrayBuffer(); })
      .then(function (buf) { return pdfFromJpeg(new Uint8Array(buf), canvas.width, canvas.height); });
  }
  function save(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function fileName(d, ext) { return "DealerFocus-Graduation-Certificate-" + String(d.name).trim().replace(/[^A-Za-z0-9]+/g, "-") + "." + ext; }

  /** Show a saved certificate { name, score, certNo, issuedAt } in el, with download buttons. */
  function mount(el, cert) {
    var d = {
      name: cert.name, score: cert.score, certNo: cert.certNo,
      date: new Date(cert.issuedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
      trainer: "Jessica Milisa Gomez", trainerTitle: "DF Trainer", logoUrl: "assets/logo-dealerfocus.png"
    };
    var btn = "border:0;border-radius:9px;padding:12px 22px;font:700 15px Inter,Arial,sans-serif;cursor:pointer;";
    el.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px">' +
      '<button type="button" disabled style="' + btn + 'background:#050141;color:#fff" data-cert="png">Download PNG</button>' +
      '<button type="button" disabled style="' + btn + 'background:#fff;color:#050141;box-shadow:inset 0 0 0 1.5px #050141" data-cert="pdf">Download PDF</button></div>' +
      '<canvas role="img" style="display:block;width:100%;height:auto;box-shadow:0 8px 28px rgba(5,1,65,.16)"></canvas>';
    var c = el.querySelector("canvas"), png = el.querySelector('[data-cert="png"]'), pdf = el.querySelector('[data-cert="pdf"]');
    c.setAttribute("aria-label", "Certificate of Graduation for " + cert.name);
    return render(c, d).then(function () {
      png.disabled = pdf.disabled = false;
      png.onclick = function () { downloadPNG(c, d); };
      pdf.onclick = function () { downloadPDF(c, d); };
    });
  }
  function downloadPNG(c, d) { return pngBlob(c).then(function (b) { save(b, fileName(d, "png")); }); }
  function downloadPDF(c, d) { return pdfBlob(c).then(function (b) { save(b, fileName(d, "pdf")); }); }

  window.DFCertificate = {
    mount: mount, render: render, pngBlob: pngBlob, pdfBlob: pdfBlob,
    downloadPNG: downloadPNG, downloadPDF: downloadPDF
  };
})();
