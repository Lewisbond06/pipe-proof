(() => {
  const CFG = window.PIPEPROOF_CONFIG;
  const $ = id => document.getElementById(id);
  const screens = ["Form", "Camera", "Sign", "Review", "Result", "History"];

  // ---- state ----
  let details = null;      // form values for the current test
  let stream = null;
  let pos = null;          // latest GPS fix
  let addr = "";           // reverse-geocoded address (best effort)
  let watchId = null;
  let lastGeocode = 0;
  let shot = null;         // { dataUrl, takenAt, lat, lon, acc, address }
  let current = null;      // finished record
  let sigDirty = false;
  let pending = null;      // record awaiting confirmation on the review screen
  let reviewUrl = null;

  // ---- navigation ----
  function show(name) {
    screens.forEach(s => $("screen" + s).classList.toggle("active", s === name));
    $("navNew").classList.toggle("active", name !== "History");
    $("navHistory").classList.toggle("active", name === "History");
    if (name !== "Camera") stopCamera();
    window.scrollTo(0, 0);
  }

  // ---- form setup ----
  function fill(name, items) {
    const sel = document.querySelector(`select[name=${name}]`);
    sel.innerHTML = items.map(i => `<option>${i}</option>`).join("");
  }
  fill("pipe1", CFG.pipework); fill("conf1", CFG.confirmed);
  fill("pipe2", ["", ...CFG.pipework]); fill("conf2", ["", ...CFG.confirmed]);

  // remember plumber + site between tests
  const f = $("detailsForm");
  try {
    const saved = JSON.parse(localStorage.getItem("pipeproof.last") || "{}");
    ["site", "plumber"].forEach(k => { if (saved[k]) f.elements[k].value = saved[k]; });
  } catch (e) {}

  f.addEventListener("submit", e => {
    e.preventDefault();
    details = Object.fromEntries(new FormData(f).entries());
    const second = [details.pipe2, details.bar2, details.conf2].filter(Boolean).length;
    if (second && second < 3) { alert("Please complete all three second-test fields, or clear them."); return; }
    details.hasSecond = second === 3;
    try { localStorage.setItem("pipeproof.last", JSON.stringify({ site: details.site, plumber: details.plumber })); } catch (e) {}
    show("Camera");
    startCamera();
  });

  // ---- camera + GPS ----
  async function startCamera() {
    $("camError").hidden = true;
    $("shutter").disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
      });
      $("video").srcObject = stream;
    } catch (err) {
      $("camError").textContent = "Camera unavailable: " + err.message + ". This app needs camera and location permission, and must be opened over HTTPS.";
      $("camError").hidden = false;
    }
    if (!navigator.geolocation) { $("gpsStatus").textContent = "Location not supported on this device."; return; }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
  function onPos(p) {
    pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    $("gpsStatus").textContent = `Location locked (±${Math.round(pos.acc)} m)`;
    $("gpsStatus").classList.add("good");
    if (stream) $("shutter").disabled = false;
    if (Date.now() - lastGeocode > 30000) { lastGeocode = Date.now(); reverseGeocode(pos.lat, pos.lon); }
  }
  function onPosErr(err) {
    $("gpsStatus").classList.remove("good");
    $("gpsStatus").textContent = "Location error: " + err.message + ". Allow location access to take a verified photo.";
  }
  async function reverseGeocode(lat, lon) {
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`, { signal: ctl.signal });
      const j = await r.json(), a = j.address || {};
      const street = [a.house_number, a.road].filter(Boolean).join(" ");
      const place = a.town || a.village || a.city || a.suburb || "";
      const clean = [street, place, a.postcode].filter(Boolean).join(", ");
      if (clean) addr = clean; else if (j.display_name) addr = j.display_name.split(", ").slice(0, 4).join(", ");
    } catch (e) { /* offline: coordinates alone still stamp */ }
  }

  const fmtTime = d => d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  const confTxt = v => (v === "Yes" ? "CONFIRMED" : "NOT CONFIRMED");
  const testLine = (n, pipe, bar, conf) => `Test ${n}: ${pipe} ${bar} bar - ${confTxt(conf)}`;
  const stampLines = (d, p, a) => [
    `PLOT ${details.plot} - ${details.site}`,
    testLine(1, details.pipe1, details.bar1, details.conf1),
    details.hasSecond ? testLine(2, details.pipe2, details.bar2, details.conf2) : "",
    fmtTime(d),
    p ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} (+/-${Math.round(p.acc)} m)` : "No GPS fix",
    a || ""
  ].filter(Boolean);

  // live preview overlay, updates each second
  setInterval(() => {
    if ($("screenCamera").classList.contains("active") && details) $("liveOverlay").textContent = stampLines(new Date(), pos, addr).join("\n");
  }, 1000);

  $("camBack").onclick = () => show("Form");

  $("shutter").onclick = async () => {
    const v = $("video");
    if (!v.videoWidth || !pos) return;
    const takenAt = new Date();
    const snap = { ...pos }, snapAddr = addr;
    const scale = Math.min(1, 1600 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, c.width, c.height);
    // burn the stamp into the pixels
    const lines = stampLines(takenAt, snap, snapAddr);
    ctx.font = "100px ui-monospace, Menlo, monospace";
    const longest = Math.max(...lines.map(t => ctx.measureText(t).width));
    const fs = Math.max(14, Math.min(Math.round(c.width / 26), Math.floor(100 * (c.width * 0.94) / longest))), lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.7);
    const h = lines.length * lh + pad * 2;
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(0, c.height - h, c.width, h);
    ctx.fillStyle = "#fff"; ctx.font = `${fs}px ui-monospace, Menlo, monospace`; ctx.textBaseline = "top";
    lines.forEach((t, i) => ctx.fillText(t, pad, c.height - h + pad + i * lh, c.width - pad * 2));
    shot = { dataUrl: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height, takenAt, lat: snap.lat, lon: snap.lon, acc: snap.acc, address: snapAddr };
    $("previewImg").src = shot.dataUrl;
    clearSig();
    show("Sign");
  };

  // ---- signature pad ----
  const pad = $("sigPad"), pctx = pad.getContext("2d");
  function clearSig() { pctx.fillStyle = "#fff"; pctx.fillRect(0, 0, pad.width, pad.height); sigDirty = false; }
  let drawing = false;
  const pt = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener("pointerdown", e => { drawing = true; pad.setPointerCapture(e.pointerId); const [x, y] = pt(e); pctx.beginPath(); pctx.moveTo(x, y); });
  pad.addEventListener("pointermove", e => { if (!drawing) return; const [x, y] = pt(e); pctx.lineWidth = 3; pctx.lineCap = "round"; pctx.strokeStyle = "#0f172a"; pctx.lineTo(x, y); pctx.stroke(); sigDirty = true; });
  ["pointerup", "pointercancel"].forEach(ev => pad.addEventListener(ev, () => { drawing = false; }));
  $("sigClear").onclick = clearSig;
  $("retake").onclick = () => { show("Camera"); startCamera(); };

  // ---- record creation ----
  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  $("makeRecord").onclick = async () => {
    const repName = $("repName").value.trim();
    if (!repName) { alert("Please enter the builder's representative name."); return; }
    if (!sigDirty) { alert("The builder's representative needs to sign."); return; }
    const signature = pad.toDataURL("image/png");
    const meta = { ...details, repName, takenAt: shot.takenAt.toISOString(), lat: shot.lat, lon: shot.lon, acc: shot.acc, address: shot.address };
    const hash = await sha256(shot.dataUrl + JSON.stringify(meta));
    pending = { id: hash.slice(0, 12).toUpperCase(), hash, w: shot.w, h: shot.h, ...meta, photo: shot.dataUrl, signature, createdAt: Date.now() };
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    reviewUrl = URL.createObjectURL(buildPdf(pending).output("blob"));
    show("Review");
    renderPreview(reviewUrl);
  };
  // draw page 1 of the PDF onto a canvas so the whole page fits the screen with no scrolling
  async function renderPreview(url) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      const data = await (await fetch(url)).arrayBuffer();
      const page = await (await pdfjsLib.getDocument({ data }).promise).getPage(1);
      const vp = page.getViewport({ scale: 2.2 });
      const cv = $("pdfCanvas");
      cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    } catch (e) {
      window.open(url, "_blank"); // fall back to the phone's own PDF viewer
    }
  }
  $("openFull").onclick = () => window.open(reviewUrl, "_blank");
  $("reviewBack").onclick = () => show("Sign");
  $("confirmSave").onclick = async () => {
    current = pending;
    await dbPut(current);
    $("resultId").textContent = `Record ${current.id}\nSHA-256 ${current.hash}`;
    $("resultImg").src = current.photo;
    show("Result");
  };

  // ---- PDF ----
  const buildPdf = r => window.PipePdf.build(r, CFG.company);
  const pdfBlob = async r => buildPdf(r).output("blob");
  const fileName = r => `pipe-test_plot-${r.plot}_${r.takenAt.slice(0, 10)}_${r.id}.pdf`.replace(/\s+/g, "-");
  function saveBlob(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function sharePdf(r) {
    const blob = await pdfBlob(r), name = fileName(r);
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Pipe test - Plot ${r.plot}` }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    saveBlob(blob, name);
  }
  $("sharePdf").onclick = () => sharePdf(current);
  $("downloadPhoto").onclick = async () => saveBlob(await (await fetch(current.photo)).blob(), `plot-${current.plot}_${current.id}.jpg`);
  $("another").onclick = () => { ["plot", "notes", "bar1", "bar2"].forEach(k => f.elements[k].value = ""); f.elements.pipe2.value = ""; f.elements.conf2.value = ""; $("repName").value = ""; show("Form"); };

  // ---- history (IndexedDB) ----
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const q = indexedDB.open("pipeproof", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("records", { keyPath: "id" });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("records", mode); const r = fn(t.objectStore("records")); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); }); };
  const dbPut = r => tx("readwrite", s => s.put(r));
  const dbAll = () => tx("readonly", s => s.getAll());

  async function renderHistory() {
    const list = (await dbAll()).sort((a, b) => b.createdAt - a.createdAt);
    const el = $("historyList");
    if (!list.length) { el.innerHTML = '<div class="empty">No tests yet.</div>'; return; }
    el.innerHTML = list.map(r => `
      <div class="card" data-id="${r.id}">
        <img src="${r.photo}" alt="">
        <div class="meta"><b>Plot ${esc(r.plot)}</b><br>
          ${esc(r.site)}<br>${esc(r.pipe1)} ${esc(r.bar1)} bar${r.hasSecond ? " + " + esc(r.pipe2) + " " + esc(r.bar2) + " bar" : ""}<br>${fmtTime(new Date(r.takenAt))}</div>
        <button>PDF</button>
      </div>`).join("");
    el.querySelectorAll(".card").forEach(c => c.querySelector("button").onclick = async () => {
      const r = list.find(x => x.id === c.dataset.id); sharePdf(r);
    });
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  $("navNew").onclick = () => show("Form");
  $("navHistory").onclick = () => { renderHistory(); show("History"); };

  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
