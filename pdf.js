// PDF test record. Pure function of a record object, so it can be rendered outside the browser for testing.
(function (root) {
  const C = {
    navy: [15, 23, 42], accent: [14, 165, 233], panel: [241, 245, 249], line: [214, 222, 232],
    text: [30, 41, 59], muted: [100, 116, 139], green: [22, 163, 74], red: [220, 38, 38], white: [255, 255, 255]
  };
  const W = 210, M = 14, GAP = 6;
  const LW = 88, RX = M + LW + GAP, RW = W - M - RX; // left column / right column

  const dateStr = d => d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = d => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

  function build(r, brand) {
    const company = typeof brand === "string" ? brand : brand.company, logo = typeof brand === "string" ? null : brand.logo;
    const doc = new root.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const when = new Date(r.takenAt);
    const fill = c => doc.setFillColor(...c), draw = c => doc.setDrawColor(...c), ink = c => doc.setTextColor(...c);
    const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };
    const label = (t, x, y) => { font("bold", 6.5); ink(C.muted); doc.text(t.toUpperCase(), x, y); };
    const value = (t, x, y, maxW, size = 10.5) => {
      font("bold", size); ink(C.text);
      const lines = doc.splitTextToSize(String(t), maxW);
      doc.text(lines, x, y);
      return lines.length;
    };
    const card = (x, y, w, h) => { fill(C.panel); draw(C.line); doc.setLineWidth(0.25); doc.roundedRect(x, y, w, h, 2, 2, "FD"); };
    const badge = (text, ok, rightX, y) => {
      font("bold", 7); const w = doc.getTextWidth(text) + 7, x = rightX - w;
      fill(ok ? C.green : C.red); doc.roundedRect(x, y, w, 6, 3, 3, "F");
      ink(C.white); doc.text(text, x + w / 2, y + 4.1, { align: "center" });
    };

    // ---- header ----
    fill(C.navy); doc.rect(0, 0, W, 34, "F");
    fill(C.accent); doc.rect(0, 34, W, 1.4, "F");
    let tx = M;
    if (logo) {
      const lh = 26, lw = lh * logo.w / logo.h;
      doc.addImage(logo.data, "JPEG", M, 4, lw, lh);
      tx = M + lw + 7;
    }
    ink(C.white); font("bold", 19); doc.text("PIPE PRESSURE TEST", tx, 16);
    font("normal", 9.5); ink([148, 163, 184]); doc.text("Test record", tx, 23);
    font("bold", 10); ink(C.white); doc.text(company, W - M, 13, { align: "right" });
    font("normal", 8.5); ink([148, 163, 184]);
    doc.text("Record " + r.id, W - M, 19.5, { align: "right" });
    doc.text(dateStr(when), W - M, 25, { align: "right" });

    // ---- left column: job details card ----
    let y = 42;
    const ly0 = y;
    font("bold", 12);
    const nSite = doc.splitTextToSize(String(r.site), LW - 10).length, cardH = 50 + (nSite - 1) * 5;
    card(M, y, LW, cardH);
    label("Site", M + 5, y + 7);
    const siteLines = value(r.site, M + 5, y + 12.5, LW - 10, 12);
    let yy = y + 12.5 + (siteLines - 1) * 5;
    label("Plot", M + 5, yy + 9); label("Plumber", M + 38, yy + 9);
    value(r.plot, M + 5, yy + 15, 28, 13); value(r.plumber, M + 38, yy + 15, LW - 43, 10.5);
    label("Builder's representative", M + 5, yy + 24);
    value(r.repName, M + 5, yy + 30, LW - 10, 10.5);
    y += cardH + 5;

    // ---- test cards ----
    const testCard = (n, pipe, bar, conf, done) => {
      card(M, y, LW, 34);
      label(n + " test", M + 5, y + 7);
      if (!done) {
        font("normal", 10); ink(C.muted); doc.text("Not carried out", M + 5, y + 20);
      } else {
        value(pipe, M + 5, y + 14, 50, 10.5);
        font("bold", 26); ink(C.accent); doc.text(String(bar), M + 5, y + 28);
        const bw = doc.getTextWidth(String(bar));
        font("bold", 10); ink(C.muted); doc.text("bar", M + 6.5 + bw, y + 28);
        badge(conf === "Yes" ? "CONFIRMED" : "NOT CONFIRMED", conf === "Yes", M + LW - 5, y + 5);
      }
      y += 34 + 5;
    };
    testCard("First", r.pipe1, r.bar1, r.conf1, true);
    testCard("Second", r.pipe2, r.bar2, r.conf2, !!r.hasSecond);
    const leftEnd = y - 5;

    // ---- right column: photo ----
    const ratio = r.h / r.w, maxH = leftEnd - ly0;
    let pw = RW, ph = pw * ratio;
    if (ph > maxH) { ph = maxH; pw = ph / ratio; }
    const px = RX + (RW - pw) / 2;
    doc.addImage(r.photo, "JPEG", px, ly0, pw, ph);
    draw(C.line); doc.setLineWidth(0.3); doc.roundedRect(px, ly0, pw, ph, 1.5, 1.5, "S");

    // ---- location panel ----
    y = Math.max(leftEnd, ly0 + ph) + 7;
    const notes = r.notes && r.notes.trim();
    const locH = 28;
    card(M, y, W - 2 * M, locH);
    label("Address", M + 5, y + 7);
    value(r.address || "Not available", M + 5, y + 12.5, 100, 10);
    label("GPS coordinates", M + 118, y + 7);
    value(`${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`, M + 118, y + 12.5, 60, 9.5);
    label("Date", M + 5, y + 20); value(dateStr(when), M + 5, y + 25, 50, 9.5);
    label("Time", M + 60, y + 20); value(timeStr(when), M + 60, y + 25, 50, 9.5);
    label("GPS accuracy", M + 118, y + 20); value(`+/- ${Math.round(r.acc)} m`, M + 118, y + 25, 50, 9.5);
    y += locH + 5;

    if (notes) {
      label("Notes", M, y + 2);
      font("normal", 9.5); ink(C.text);
      const nl = doc.splitTextToSize(notes, W - 2 * M);
      doc.text(nl, M, y + 7);
      y += 7 + nl.length * 4.5 + 3;
    }

    // ---- signature ----
    const sy = Math.max(y, 232);
    label("Builder's representative signature", M, sy);
    fill(C.white); draw(C.line); doc.setLineWidth(0.3); doc.roundedRect(M, sy + 2.5, 66, 24, 2, 2, "FD");
    doc.addImage(r.signature, "PNG", M + 2, sy + 4, 62, 20);
    value(r.repName, M + 74, sy + 12, 90, 10.5);
    font("normal", 8.5); ink(C.muted);
    doc.text(dateStr(when), M + 74, sy + 18);

    // ---- footer ----
    draw(C.line); doc.setLineWidth(0.3); doc.line(M, 278, W - M, 278);
    font("bold", 7); ink(C.muted); doc.text("INTEGRITY ID " + r.id, M, 283);
    font("normal", 6.3); doc.text("SHA-256 " + r.hash, M, 287);
    font("normal", 6.3);
    doc.text("Time and location recorded by the device at the moment of capture. Any change to the photo or details alters the hash above.", M, 291);
    font("bold", 7); doc.text("PipeProof", W - M, 283, { align: "right" });
    return doc;
  }

  root.PipePdf = { build };
  if (typeof module !== "undefined") module.exports = root.PipePdf;
})(typeof window !== "undefined" ? window : globalThis);
