/* Parbat dealer admin panel */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const CFG = JSON.parse($("#cfg").dataset.cfg || "{}");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let DEALERS = [], SALESMEN = [], TOWNS = [], SEL = new Set();
  const F = { q: "", sm: "", st: "" };

  async function call(method, url, body, raw) {
    const opt = { method, headers: { "X-Requested-With": "parbat-admin" } };
    if (body !== undefined && !raw) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    if (raw) { opt.headers["Content-Type"] = "application/octet-stream"; Object.assign(opt.headers, raw.headers || {}); opt.body = body; }
    const r = await fetch(url, opt);
    if (r.status === 401) { location.href = "/admin/login"; throw new Error("signed out"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "Request failed"); e.data = j; e.status = r.status; throw e; }
    return j;
  }
  function toast(t) { const x = $("#toast"); x.textContent = t; x.hidden = false; clearTimeout(x._t); x._t = setTimeout(() => x.hidden = true, 2600); }
  function modal(html) { $("#mbox").innerHTML = html; $("#modal").hidden = false; return $("#mbox"); }
  function closeModal() { $("#modal").hidden = true; $("#mbox").innerHTML = ""; }
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  function confirmBox(title, text, ok, danger) { return new Promise(res => { const b = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row-end"><button class="btn" data-x="0">Cancel</button><button class="btn ${danger ? "danger" : "call"}" data-x="1">${esc(ok)}</button></div>`); b.querySelectorAll("[data-x]").forEach(x => x.addEventListener("click", () => { closeModal(); res(x.dataset.x === "1"); })); }); }

  /* ---------- load ---------- */
  async function load() {
    [DEALERS, SALESMEN, TOWNS] = await Promise.all([call("GET", "/api/admin/dealers"), call("GET", "/api/admin/salesmen"), call("GET", "/api/admin/towns")]);
    const s = await call("GET", "/api/admin/stats");
    const c = (n, l, w) => `<div class="stat-c ${w && n ? "warn" : ""}"><b>${n || 0}</b><span>${l}</span></div>`;
    $("#stats").innerHTML = c(s.total, "Dealers") + c(s.published, "On website") + c(s.no_gps, "Missing GPS", 1) + c(s.unverified, "GPS not verified", 1) + c(s.no_mobile, "Missing mobile", 1) + c(s.no_salesman, "No salesman", 1);
  }
  async function refresh() { await load(); route(); }

  /* ---------- tabs ---------- */
  const TABS = ["dealers", "import", "salesmen", "settings", "log", "account"];
  function route() { const t = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "dealers";
    for (const x of TABS) $("#t-" + x).hidden = x !== t;
    document.querySelectorAll("#tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.t === t ? "page" : "false"));
    ({ dealers: tDealers, import: tImport, salesmen: tSalesmen, settings: tSettings, log: tLog, account: tAccount })[t]();
  }
  window.addEventListener("hashchange", route);

  /* ---------- dealers ---------- */
  function filtered() {
    const q = F.q.toUpperCase(), qd = F.q.replace(/\D/g, "");
    return DEALERS.filter(d => {
      if (F.sm === "none" ? d.salesman_id : F.sm && String(d.salesman_id) !== F.sm) return false;
      if (F.st === "pub" && !d.published) return false; if (F.st === "hid" && d.published) return false;
      if (F.st === "nogps" && d.lat != null) return false; if (F.st === "unv" && (d.lat == null || d.gps_verified)) return false;
      if (F.st === "nomob" && d.mobile) return false;
      if (q && !((d.name + " " + d.area + " " + d.street + " " + d.address + " " + d.town).toUpperCase().includes(q) || (qd.length >= 4 && d.mobile.replace(/\D/g, "").includes(qd)))) return false;
      return true;
    });
  }
  function tDealers() {
    const el = $("#t-dealers");
    if (!el.dataset.ready) {
      el.innerHTML = `<div class="box2"><div class="tb">
        <input type="search" id="fq" placeholder="Search name, area, mobile…" style="flex:1;min-width:200px">
        <select id="fsm"><option value="">All salesmen</option><option value="none">No salesman</option>${SALESMEN.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
        <select id="fst"><option value="">All dealers</option><option value="pub">On website</option><option value="hid">Hidden</option><option value="nogps">Missing GPS</option><option value="unv">GPS not verified</option><option value="nomob">Missing mobile</option></select>
        <span class="sp"></span><button class="btn call" id="addD">+ Add dealer</button><a class="btn" href="/api/admin/export.xlsx">Export Excel</a></div>
        <div class="tb" id="bulk" hidden><b id="selN"></b><button class="btn" data-b="publish">Show on website</button><button class="btn" data-b="hide">Hide</button><button class="btn" data-b="verify">Mark GPS verified</button>
        <select id="bsm"><option value="">Assign salesman…</option>${SALESMEN.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><button class="btn danger" data-b="delete">Delete</button></div>
        <div class="tw"><table class="t" id="dt"></table></div><p class="hint" id="dcount" style="color:var(--muted);font-size:13px"></p></div>`;
      el.dataset.ready = 1;
      $("#fq").addEventListener("input", e => { F.q = e.target.value.trim(); drawTable(); });
      $("#fsm").addEventListener("change", e => { F.sm = e.target.value; drawTable(); });
      $("#fst").addEventListener("change", e => { F.st = e.target.value; drawTable(); });
      $("#addD").addEventListener("click", () => editDealer(null));
      $("#bulk").addEventListener("click", async e => { const b = e.target.closest("[data-b]"); if (!b) return; const act = b.dataset.b;
        if (act === "delete" && !(await confirmBox("Delete dealers?", `${SEL.size} dealers will be removed permanently.`, "Delete", true))) return;
        const r = await call("POST", "/api/admin/dealers/bulk", { ids: [...SEL], action: act }); toast(`${r.changed} dealers updated`); SEL.clear(); refresh(); });
      $("#bsm").addEventListener("change", async e => { if (!e.target.value) return; const r = await call("POST", "/api/admin/dealers/bulk", { ids: [...SEL], action: "salesman", salesman_id: e.target.value }); toast(`${r.changed} dealers moved`); SEL.clear(); e.target.value = ""; refresh(); });
      $("#dt").addEventListener("click", async e => {
        const ed = e.target.closest("[data-ed]"); if (ed) return editDealer(+ed.dataset.ed);
        const pub = e.target.closest("[data-pub]"); if (pub) { const d = DEALERS.find(x => x.id === +pub.dataset.pub); if (!d.lat && !d.published) { toast("Add GPS before showing this dealer on the website"); return; } await call("PUT", "/api/admin/dealers/" + d.id, { published: !d.published }); toast(d.published ? "Hidden from website" : "Shown on website"); refresh(); }
      });
      $("#dt").addEventListener("change", e => { const c = e.target.closest("[data-cb]"); if (c) { c.checked ? SEL.add(+c.dataset.cb) : SEL.delete(+c.dataset.cb); bulkBar(); } if (e.target.id === "cbAll") { const ids = filtered().slice(0, 500).map(d => d.id); ids.forEach(id => e.target.checked ? SEL.add(id) : SEL.delete(id)); drawTable(); } });
    }
    drawTable();
  }
  function bulkBar() { $("#bulk").hidden = !SEL.size; $("#selN").textContent = `${SEL.size} selected`; }
  function drawTable() {
    const list = filtered(), shown = list.slice(0, 500);
    $("#dt").innerHTML = `<tr><th><input type="checkbox" id="cbAll" aria-label="Select all"></th><th>Dealer</th><th>Salesman</th><th>Area</th><th>Mobile</th><th>GPS</th><th>Products</th><th>Website</th><th></th></tr>` +
      shown.map(d => `<tr><td><input type="checkbox" data-cb="${d.id}" ${SEL.has(d.id) ? "checked" : ""} aria-label="Select"></td><td><b>${esc(d.name)}</b>${d.code ? `<br><small style="color:var(--muted)">Code ${esc(d.code)}</small>` : ""}</td>
        <td>${d.salesman ? `<span class="dot" style="background:${esc(d.color)}"></span>${esc(d.salesman)}` : '<span class="tag no">none</span>'}</td><td>${esc(d.area)}</td>
        <td>${d.mobile ? esc(d.mobile) + (d.show_mobile ? "" : ' <span class="tag gr">hidden</span>') : '<span class="tag no">missing</span>'}</td>
        <td>${d.lat == null ? '<span class="tag no">missing</span>' : d.gps_verified ? '<span class="tag ok">verified</span>' : '<span class="tag mid">check</span>'}</td>
        <td>${[d.has_atta && "Atta", d.has_maida && "Maida", d.has_choker && "Choker"].filter(Boolean).join(", ") || "—"}</td>
        <td><button class="btn" data-pub="${d.id}">${d.published ? "✓ Shown" : "Hidden"}</button></td><td><button class="btn" data-ed="${d.id}">Edit</button></td></tr>`).join("");
    $("#dcount").textContent = `${list.length} dealers${list.length > 500 ? " (first 500 shown, narrow the search)" : ""}`;
    bulkBar();
  }

  /* ---------- edit dealer + GPS verify map ---------- */
  let mapsLoading = null;
  function loadMaps() { if (!CFG.mapsKey) return Promise.reject(); if (window.google && google.maps) return Promise.resolve(); if (mapsLoading) return mapsLoading;
    mapsLoading = new Promise((res, rej) => { window.__admMaps = res; const s = document.createElement("script"); s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.mapsKey)}&v=weekly&loading=async&callback=__admMaps`; s.async = true; s.onerror = rej; document.head.append(s); }); return mapsLoading; }
  function editDealer(id) {
    const d = id ? DEALERS.find(x => x.id === id) : { name: "", code: "", contact_person: "", mobile: "", show_mobile: 1, address: "", town: "Multan", area: "", street: "", salesman_id: "", lat: null, lng: null, gps_verified: 0, has_atta: 1, has_maida: 0, has_choker: 0, published: 0, notes: "" };
    const opt = (arr, v, key = "id", lab = "name") => arr.map(x => `<option value="${esc(x[key])}" ${String(x[key]) === String(v) ? "selected" : ""}>${esc(x[lab])}</option>`).join("");
    const b = modal(`<h2>${id ? "Edit dealer" : "Add dealer"}</h2><form class="form" id="df">
      <label class="wide">Dealer / shop name *<input name="name" required value="${esc(d.name)}"></label>
      <label>Contact person<input name="contact_person" value="${esc(d.contact_person)}"></label>
      <label>Mobile (0300-1234567)<input name="mobile" inputmode="tel" value="${esc(d.mobile)}"></label>
      <label>Party code (ERP)<input name="code" value="${esc(d.code || "")}"></label>
      <label>Salesman *<select name="salesman_id" required><option value="">Choose…</option>${opt(SALESMEN, d.salesman_id)}</select></label>
      <label class="wide">Complete shop address<input name="address" value="${esc(d.address)}"></label>
      <label>Street<input name="street" value="${esc(d.street)}"></label>
      <label>Area<input name="area" value="${esc(d.area)}" list="areas"></label>
      <label>Town<input name="town" value="${esc(d.town)}" list="towns"></label>
      <datalist id="areas">${[...new Set(DEALERS.map(x => x.area).filter(Boolean))].sort().map(a => `<option value="${esc(a)}">`).join("")}</datalist>
      <datalist id="towns">${TOWNS.map(t => `<option value="${esc(t.name)}">`).join("")}</datalist>
      <label>Latitude<input name="lat" inputmode="decimal" value="${d.lat ?? ""}"></label>
      <label>Longitude<input name="lng" inputmode="decimal" value="${d.lng ?? ""}"></label>
      <label class="wide">Paste a Google Maps link or "lat, lng"<input id="paste" placeholder="https://maps.google.com/?q=30.19,71.47"></label>
      <div class="wide" id="emap"></div>
      <p class="wide" style="margin:-4px 0 0;font-size:12.5px;color:var(--muted)" id="mapHint">${CFG.mapsKey ? "Drag the pin to the exact shop location, or click on the map." : "Add the Google Maps key to see the location here."}${d.lat != null ? ` <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}">Open in Google Maps ↗</a>` : ""}</p>
      <label class="chk"><input type="checkbox" name="gps_verified" ${d.gps_verified ? "checked" : ""}> GPS location verified</label>
      <label class="chk"><input type="checkbox" name="show_mobile" ${d.show_mobile ? "checked" : ""}> Show mobile on website</label>
      <label class="chk"><input type="checkbox" name="has_atta" ${d.has_atta ? "checked" : ""}> Atta available</label>
      <label class="chk"><input type="checkbox" name="has_maida" ${d.has_maida ? "checked" : ""}> Maida available</label>
      <label class="chk"><input type="checkbox" name="has_choker" ${d.has_choker ? "checked" : ""}> Choker available</label>
      <label class="chk"><input type="checkbox" name="published" ${d.published ? "checked" : ""}> Show on public website</label>
      <label class="wide">Internal notes (never shown publicly)<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
      <div class="wide" id="dmsg"></div>
      <div class="wide row-end">${id ? '<button type="button" class="btn danger" id="del">Delete</button><span style="flex:1"></span>' : ""}<button type="button" class="btn" id="cx">Cancel</button><button class="btn call" type="submit">${id ? "Save" : "Add dealer"}</button></div></form>`);
    const f = $("#df");
    $("#cx").addEventListener("click", closeModal);
    $("#paste").addEventListener("input", e => { const m = /(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{1,3}\.\d{3,})/.exec(decodeURIComponent(e.target.value)); if (m) { f.lat.value = m[1]; f.lng.value = m[2]; placePin(); } });
    if ($("#del")) $("#del").addEventListener("click", async () => { if (await confirmBox("Delete dealer?", `${d.name} will be removed permanently.`, "Delete", true)) { await call("DELETE", "/api/admin/dealers/" + id); toast("Deleted"); refresh(); } });
    let gm, pin;
    function placePin() { if (!gm) return; const la = +f.lat.value, ln = +f.lng.value; if (!la || !ln) return; const p = { lat: la, lng: ln }; if (!pin) { pin = new google.maps.Marker({ map: gm, position: p, draggable: true }); pin.addListener("dragend", ev => { f.lat.value = ev.latLng.lat().toFixed(7); f.lng.value = ev.latLng.lng().toFixed(7); }); } else pin.setPosition(p); gm.setCenter(p); gm.setZoom(18); }
    loadMaps().then(() => { gm = new google.maps.Map($("#emap"), { center: d.lat ? { lat: d.lat, lng: d.lng } : { lat: 30.1984, lng: 71.4687 }, zoom: d.lat ? 18 : 12, mapTypeId: "hybrid", streetViewControl: false, mapTypeControl: true });
      gm.addListener("click", ev => { f.lat.value = ev.latLng.lat().toFixed(7); f.lng.value = ev.latLng.lng().toFixed(7); placePin(); }); placePin(); }).catch(() => { $("#emap").remove(); });
    f.lat.addEventListener("change", placePin); f.lng.addEventListener("change", placePin);
    let force = false;
    f.addEventListener("submit", async e => {
      e.preventDefault(); const fd = new FormData(f), body = {};
      for (const k of ["name", "contact_person", "mobile", "code", "salesman_id", "address", "street", "area", "town", "lat", "lng", "notes"]) body[k] = fd.get(k);
      for (const k of ["gps_verified", "show_mobile", "has_atta", "has_maida", "has_choker", "published"]) body[k] = f[k].checked;
      if (body.published && !(body.lat && body.lng)) { $("#dmsg").innerHTML = '<div class="msg err">Add GPS latitude and longitude before showing this dealer on the website.</div>'; return; }
      if (force) body.force = true;
      try { await call(id ? "PUT" : "POST", id ? "/api/admin/dealers/" + id : "/api/admin/dealers", body); closeModal(); toast(id ? "Saved" : "Dealer added"); refresh(); }
      catch (err) { if (err.status === 409) { force = true; $("#dmsg").innerHTML = `<div class="msg warn">${esc(err.message)} Press the button again to add anyway.</div>`; } else $("#dmsg").innerHTML = `<div class="msg err">${esc(err.message)}</div>`; }
    });
  }

  /* ---------- import ---------- */
  let IMP = null;
  function tImport() {
    const el = $("#t-import");
    el.innerHTML = `<div class="box2"><h2>Import dealers from Excel or CSV</h2>
      <p style="color:var(--muted);margin-top:0">Upload the dealer GPS workbook, the Parties List, a Kobo export or any sheet with dealer names. Columns are matched automatically and you can correct them. Dealers are matched by party code, then by name, so the same dealer is never added twice. Empty cells never erase existing data.</p>
      <div class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xls,.csv" hidden><b>Drop the file here</b><br>or click to choose (.xlsx, .xls, .csv)</div><div id="imp"></div></div>`;
    const drop = $("#drop"), inp = $("#file");
    drop.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => inp.files[0] && upload(inp.files[0]));
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); });
  }
  async function upload(file, mapping) {
    $("#imp").innerHTML = '<p class="msg">Reading file…</p>';
    const buf = await file.arrayBuffer();
    try { IMP = await call("POST", "/api/admin/import/preview", buf, { headers: { "X-File-Name": encodeURIComponent(file.name), ...(mapping ? { "X-Mapping": JSON.stringify(mapping) } : {}) } }); IMP.fileObj = file; drawImport(); }
    catch (e) { if (e.data && e.data.mapping) { IMP = Object.assign(e.data, { fileObj: file, items: [], summary: null }); drawImport(e.message); } else $("#imp").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  }
  function drawImport(errMsg) {
    const p = IMP, lab = { new: '<span class="tag ok">new</span>', update: '<span class="tag mid">update</span>', same: '<span class="tag gr">no change</span>', check: '<span class="tag mid">check name</span>', duplicate: '<span class="tag gr">duplicate in file</span>' };
    const fname = { code: "Code", name: "Name", contact_person: "Contact", mobile: "Mobile", address: "Address", town: "Town", area: "Area", street: "Street", salesman_id: "Salesman", lat: "Latitude", lng: "Longitude", has_atta: "Atta", has_maida: "Maida", has_choker: "Choker", published: "Published" };
    const smName = id => (SALESMEN.find(s => s.id === +id) || {}).name || id;
    const val = (k, v) => k === "salesman_id" ? smName(v) : v;
    $("#imp").innerHTML = `<h2 style="margin-top:18px">${esc(decodeURIComponent(p.file || ""))}${p.sheet ? ` · sheet "${esc(p.sheet)}"` : ""}</h2>
      <details ${errMsg ? "open" : ""}><summary><b>Column matching</b> (change if a column is wrong)</summary><div class="mapgrid" style="margin-top:10px">${p.fields.map(([k, l]) => `<span>${esc(l)}</span><select data-map="${k}"><option value="-1">— not in file —</option>${p.header.map((h, i) => `<option value="${i}" ${p.mapping[k] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>`).join("")}</div><div class="row-end" style="justify-content:flex-start"><button class="btn" id="remap">Check again with these columns</button></div></details>
      ${errMsg ? `<div class="msg err">${esc(errMsg)}</div>` : ""}
      ${p.summary ? `<div class="stats" style="margin-top:12px">${[["Rows", p.summary.rows], ["Will update", p.summary.update], ["New dealers", p.summary.new], ["Check names", p.summary.check], ["No change", p.summary.same], ["Duplicates in file", p.summary.duplicate]].map(([l, n]) => `<div class="stat-c"><b>${n}</b><span>${l}</span></div>`).join("")}</div>
      ${p.summary.warnings ? `<div class="msg warn">${p.summary.warnings} rows have values that were ignored (bad mobile, GPS outside Pakistan or unknown salesman). They are listed below.</div>` : ""}
      <div class="tw" style="max-height:460px;overflow:auto"><table class="t"><tr><th>Row</th><th>Dealer in file</th><th>Status</th><th>Matched / changes</th><th>Action</th></tr>
      ${p.items.map((it, i) => `<tr><td>${it.row}</td><td>${esc(it.name)}${it.warn.length ? `<br><small style="color:#B45309">${esc(it.warn.join("; "))}</small>` : ""}</td><td>${lab[it.status]}</td>
        <td>${it.match ? `${esc(it.match.name)}${it.match.score ? ` (${it.match.score}% similar)` : ""}` : ""}${it.changes ? "<br><small>" + Object.entries(it.changes).map(([k, [a, b]]) => `${esc(fname[k] || k)}: ${esc(val(k, a)) || "—"} → <b>${esc(val(k, b))}</b>`).join("<br>") + "</small>" : ""}</td>
        <td>${it.status === "check" ? `<select data-dec="${i}"><option value="match" ${it.decision === "match" ? "selected" : ""}>Same dealer, update</option><option value="new" ${it.decision === "new" ? "selected" : ""}>Different, add new</option><option value="skip" ${it.decision === "skip" ? "selected" : ""}>Skip</option></select>` : it.status === "new" ? `<select data-dec="${i}"><option value="new">Add</option><option value="skip">Skip</option></select>` : it.status === "update" ? `<select data-dec="${i}"><option value="match">Update</option><option value="skip">Skip</option></select>` : ""}</td></tr>`).join("")}</table></div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="pubNew"> Show new dealers with GPS on the website right away</label>
      <div class="row-end"><button class="btn call" id="applyImp">Apply import</button></div>` : ""}`;
    $("#remap").addEventListener("click", () => { const m = {}; document.querySelectorAll("[data-map]").forEach(s => m[s.dataset.map] = +s.value); upload(IMP.fileObj, m); });
    const ap = $("#applyImp"); if (ap) ap.addEventListener("click", async () => {
      const dec = {}; document.querySelectorAll("[data-dec]").forEach(s => dec[s.dataset.dec] = s.value);
      ap.disabled = true;
      try { const r = await call("POST", "/api/admin/import/apply", { token: IMP.token, decisions: dec, publishNew: $("#pubNew").checked }); $("#imp").innerHTML = `<div class="msg ok">Import finished: ${r.updated} dealers updated, ${r.added} added, ${r.skipped} unchanged or skipped.</div>`; load(); }
      catch (e) { ap.disabled = false; $("#imp").insertAdjacentHTML("afterbegin", `<div class="msg err">${esc(e.message)}</div>`); }
    });
  }

  /* ---------- salesmen & towns ---------- */
  function tSalesmen() {
    $("#t-salesmen").innerHTML = `<div class="box2"><h2>Salesmen</h2><p style="color:var(--muted);margin-top:0">Each salesman is a filter on the website with its own marker colour. Turn one off to hide that salesman's dealers from the public map.</p>
      ${SALESMEN.map(s => `<div class="sm-row" data-id="${s.id}"><input type="color" value="${esc(s.color)}" aria-label="Colour"><input class="nm" value="${esc(s.name)}" aria-label="Name" style="font:inherit;padding:7px 9px;border:1.5px solid var(--line2);border-radius:9px"><label><input type="checkbox" class="ac" ${s.active ? "checked" : ""}> On website</label><span>${s.dealers} dealers</span><span><button class="btn sv">Save</button> ${s.dealers ? "" : '<button class="btn danger rm">Remove</button>'}</span></div>`).join("")}
      <div class="tb" style="margin-top:12px"><input id="nsm" placeholder="New salesman name"><input type="color" id="nsc" value="#0EA5E9"><button class="btn call" id="asm">Add salesman</button></div></div>
      <div class="box2"><h2>Towns</h2><p>${TOWNS.map(t => `${esc(t.name)} (${t.dealers})`).join(" · ")}</p><div class="tb"><input id="nt" placeholder="New town, e.g. Shujabad"><button class="btn call" id="at">Add town</button></div></div>`;
    $("#t-salesmen").querySelectorAll(".sm-row").forEach(r => { const id = r.dataset.id;
      r.querySelector(".sv").addEventListener("click", async () => { try { await call("PUT", "/api/admin/salesmen/" + id, { name: r.querySelector(".nm").value, color: r.querySelector("input[type=color]").value, active: r.querySelector(".ac").checked }); toast("Saved"); refresh(); } catch (e) { toast(e.message); } });
      const rm = r.querySelector(".rm"); if (rm) rm.addEventListener("click", async () => { try { await call("DELETE", "/api/admin/salesmen/" + id); toast("Removed"); refresh(); } catch (e) { toast(e.message); } }); });
    $("#asm").addEventListener("click", async () => { try { await call("POST", "/api/admin/salesmen", { name: $("#nsm").value, color: $("#nsc").value }); toast("Salesman added"); refresh(); } catch (e) { toast(e.message); } });
    $("#at").addEventListener("click", async () => { try { await call("POST", "/api/admin/towns", { name: $("#nt").value }); toast("Town added"); refresh(); } catch (e) { toast(e.message); } });
  }

  /* ---------- settings ---------- */
  async function tSettings() {
    const { settings: s, mapsKeySet } = await call("GET", "/api/admin/settings");
    const L = [["site_name", "Website name"], ["company_address", "Company address"], ["company_phone", "Company phone"], ["company_whatsapp", "Company WhatsApp"], ["company_email", "Company email"], ["office_hours", "Office hours"], ["map_center_lat", "Map start latitude"], ["map_center_lng", "Map start longitude"], ["map_zoom", "Map start zoom (10–16)"]];
    $("#t-settings").innerHTML = `<div class="box2"><h2>Website settings</h2>${mapsKeySet ? '<div class="msg ok">Google Maps key is set.</div>' : '<div class="msg warn">Google Maps key is not set. Add GOOGLE_MAPS_API_KEY to the server settings (.env) and restart.</div>'}
      <form class="form" id="sf">${L.map(([k, l]) => `<label class="${k === "company_address" ? "wide" : ""}">${l}<input name="${k}" value="${esc(s[k])}"></label>`).join("")}<div class="wide row-end"><button class="btn call">Save settings</button></div></form></div>`;
    $("#sf").addEventListener("submit", async e => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); await call("PUT", "/api/admin/settings", b); toast("Settings saved"); });
  }
  async function tLog() {
    const rows = await call("GET", "/api/admin/audit");
    const det = s => { try { const o = JSON.parse(s); return typeof o === "string" ? esc(o) : Object.entries(o).map(([k, v]) => `${esc(k)}: ${Array.isArray(v) ? esc(v[0] ?? "") + " → <b>" + esc(v[1] ?? "") + "</b>" : esc(JSON.stringify(v))}`).join("<br>"); } catch (_) { return esc(s); } };
    $("#t-log").innerHTML = `<div class="box2"><h2>Activity log</h2><p style="color:var(--muted);margin-top:0">Every change in the admin panel, newest first.</p><div class="tw"><table class="t"><tr><th>When (PKT)</th><th>Admin</th><th>Action</th><th>Dealer</th><th>Details</th></tr>${rows.map(r => `<tr><td style="white-space:nowrap">${esc(r.at)}</td><td>${esc(r.admin)}</td><td>${esc(r.action)}</td><td>${esc(r.dealer || "")}</td><td style="font-size:12.5px">${det(r.details)}</td></tr>`).join("")}</table></div></div>`;
  }
  function tAccount() {
    $("#t-account").innerHTML = `<div class="box2"><h2>Account</h2><p>Signed in as <b>${esc(CFG.user)}</b>.</p>
      <form class="form" id="pf" style="max-width:520px"><label class="wide">Current password<input type="password" name="current" autocomplete="current-password" required></label><label class="wide">New password (10+ characters)<input type="password" name="next" autocomplete="new-password" minlength="10" required></label><div class="wide" id="pmsg"></div><div class="wide row-end" style="justify-content:flex-start"><button class="btn call">Change password</button><button type="button" class="btn" id="lo">Sign out</button></div></form></div>
      <div class="box2"><h2>Backup</h2><p style="color:var(--muted)">Download a full backup every month and keep it safe. It holds every dealer with GPS and mobile, salesmen, towns, settings and the activity log.</p><div class="tb"><a class="btn" href="/api/admin/backup.xlsx">Download full backup</a><a class="btn" href="/api/admin/export.xlsx">Download Excel</a></div></div>`;
    $("#pf").addEventListener("submit", async e => { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); try { await call("POST", "/api/admin/password", b); location.href = "/admin/login"; } catch (err) { $("#pmsg").innerHTML = `<div class="msg err">${esc(err.message)}</div>`; } });
    $("#lo").addEventListener("click", async () => { await call("POST", "/api/admin/logout", {}); location.href = "/admin/login"; });
  }

  refresh().catch(e => { if (e.message !== "signed out") $("#t-dealers").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; });
})();
