/* Parbat Flour Mills – Find a Dealer (public). Uses only public dealer fields from /api/public/dealers. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const CFG = JSON.parse($("#cfg").dataset.cfg || "{}");
  const S = { q: "", sm: new Set(), prod: "", town: "", area: "", street: "", me: null, sel: null, limit: 150 };
  let DEALERS = [], SALESMEN = [], COLOR = {}, FILTERED = [];
  let map, info, clusterer, meMarker, MARKERS = new Map(), mapReady = false;
  const isTouch = matchMedia("(pointer:coarse)").matches;
  const LEAF = !CFG.mapsKey; // no Google key: free OpenStreetMap map (Leaflet)

  const norm = s => String(s || "").toUpperCase().replace(/KERYANA|KIRYANA|KRYANA/g, "KARYANA").replace(/[^A-Z0-9]/g, "");
  const digits = s => String(s || "").replace(/\D/g, "");
  const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === "class") e.className = attrs[k]; else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const telHref = m => "tel:" + digits(m);
  const waHref = m => { let d = digits(m); if (d.startsWith("0")) d = "92" + d.slice(1); return "https://wa.me/" + d + "?text=" + encodeURIComponent("Assalam o Alaikum, I found your shop on the Parbat Flour Mills dealer website."); };
  const dirHref = d => `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;
  const photoSrc = (d, small) => `/photo/${d.id}?${small ? "s=t&" : ""}v=${d.photo}`;
  const placeHref = d => `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}`;
  const addrLine = d => { const parts = [...String(d.address || "").split(/\s*[,\-–]\s*/), d.street, d.area, d.town].map(x => String(x || "").trim()).filter(Boolean);
    const out = []; for (const v of parts) { const k = norm(v); if (!k || out.some(x => norm(x) === k || norm(x).includes(k))) continue; for (let i = out.length - 1; i >= 0; i--) if (k.includes(norm(out[i]))) out.splice(i, 1); out.push(v); } return out.join(", "); };
  const ICON = {
    call: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>',
    wa: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>',
    dir: '<svg viewBox="0 0 24 24"><path d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5z"/></svg>',
  };
  const btn = (cls, href, label, icon, blank) => { const a = el("a", { class: "btn " + cls, href, ...(blank ? { target: "_blank", rel: "noopener" } : {}) }); a.innerHTML = ICON[icon]; a.append(label); return a; };
  const actions = d => el("div", { class: "acts" },
    d.mobile ? btn("call", telHref(d.mobile), "Call Now", "call") : null,
    d.mobile ? btn("wa", waHref(d.mobile), "WhatsApp", "wa", true) : null,
    btn("dir", dirHref(d), "Get Directions", "dir", true));
  const prodPills = d => d.products.map(p => el("span", { class: "pp " + p }, p));

  /* ---------- data ---------- */
  function loadDealers(tries) {
  fetch("/api/public/dealers").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => {
    DEALERS = j.dealers; SALESMEN = j.salesmen; COLOR = Object.fromEntries(SALESMEN.map(s => [s.name, s.color]));
    for (const d of DEALERS) d._k = norm([d.name, d.area, d.street, d.town, d.address, d.contact].join(" ")), d._m = digits(d.mobile);
    buildFilters(); apply();
    if (mapReady) buildMarkers();
    openFromHash();
  }).catch(() => { if (tries < 6) { $("#resCount").textContent = "Loading dealers…"; setTimeout(() => loadDealers(tries + 1), 4000); } else $("#resCount").textContent = "Dealers could not be loaded. Please refresh the page."; });
  }
  loadDealers(0);

  /* ---------- filters ---------- */
  function buildFilters() {
    const chips = $("#smChips"); chips.innerHTML = "";
    for (const s of SALESMEN) chips.append(el("button", { type: "button", class: "chip", "aria-pressed": "false", "data-sm": s.name, onclick: e => { const b = e.currentTarget; S.sm.has(s.name) ? S.sm.delete(s.name) : S.sm.add(s.name); b.setAttribute("aria-pressed", S.sm.has(s.name)); apply(); } }, el("i", { style: `background:${s.color}` }), s.name));
    const towns = [...new Set(DEALERS.map(d => d.town).filter(Boolean))].sort();
    $("#town").innerHTML = '<option value="">All towns</option>' + towns.map(t => `<option>${escH(t)}</option>`).join("");
    if (towns.length === 1) { $("#town").value = towns[0]; S.town = ""; }
    fillAreas();
  }
  const escH = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function fillAreas() {
    const areas = [...new Set(DEALERS.filter(d => !S.town || d.town === S.town).map(d => d.area).filter(Boolean))].sort();
    const cur = S.area; $("#area").innerHTML = '<option value="">All areas</option>' + areas.map(a => `<option ${a === cur ? "selected" : ""}>${escH(a)}</option>`).join("");
    if (!areas.includes(cur)) S.area = "";
  }
  let t1; $("#q").addEventListener("input", e => { clearTimeout(t1); t1 = setTimeout(() => { S.q = e.target.value.trim(); apply(); }, 150); });
  $("#searchForm").addEventListener("submit", e => { e.preventDefault(); S.q = $("#q").value.trim(); apply(); document.getElementById("find").scrollIntoView(); });
  let t2; $("#street").addEventListener("input", e => { clearTimeout(t2); t2 = setTimeout(() => { S.street = e.target.value.trim(); apply(); }, 150); });
  $("#town").addEventListener("change", e => { S.town = e.target.value; fillAreas(); apply(); });
  $("#area").addEventListener("change", e => { S.area = e.target.value; apply(); });
  $("#prodSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.prod = b.dataset.p; for (const x of $("#prodSeg").children) x.setAttribute("aria-pressed", x === b); apply(); });
  $("#clearAll").addEventListener("click", () => { Object.assign(S, { q: "", prod: "", town: "", area: "", street: "" }); S.sm.clear(); $("#q").value = ""; $("#street").value = ""; $("#town").value = ""; fillAreas(); for (const x of $("#prodSeg").children) x.setAttribute("aria-pressed", x.dataset.p === ""); for (const c of $("#smChips").children) c.setAttribute("aria-pressed", "false"); apply(); });
  $("#fab").addEventListener("click", () => $("#panel").scrollIntoView({ behavior: "smooth" }));

  function matches(d) {
    if (S.sm.size && !S.sm.has(d.salesman)) return false;
    if (S.prod === "AttaMaida") { if (!(d.products.includes("Atta") && d.products.includes("Maida"))) return false; }
    else if (S.prod && !d.products.includes(S.prod)) return false;
    if (S.town && d.town !== S.town) return false;
    if (S.area && d.area !== S.area) return false;
    if (S.street && !norm(d.street + " " + d.address + " " + d.area).includes(norm(S.street))) return false;
    if (S.q) { const q = norm(S.q), qd = digits(S.q); if (!(d._k.includes(q) || (qd.length >= 4 && d._m.includes(qd.replace(/^92/, "0"))))) return false; }
    return true;
  }
  function apply() {
    if (S.me) for (const d of DEALERS) d._dist = km(S.me, d);
    FILTERED = DEALERS.filter(matches).sort((a, b) => S.me ? a._dist - b._dist : a.name.localeCompare(b.name));
    const any = S.q || S.sm.size || S.prod || S.town || S.area || S.street;
    $("#clearAll").hidden = !any;
    $("#resCount").textContent = FILTERED.length ? `${FILTERED.length} dealer${FILTERED.length > 1 ? "s" : ""} found${S.me ? " · nearest first" : ""}` : "No dealer found";
    S.limit = 150; renderList(); updateMarkers();
  }

  /* ---------- list ---------- */
  function card(d) {
    const li = el("li", { class: "card" + (S.sel === d.id ? " sel" : ""), "data-id": d.id, tabindex: "0" },
      el("div", { class: "top" }, el("span", { class: "pin", style: `background:${COLOR[d.salesman] || "#1E7B3C"}` }),
        el("div", { style: "min-width:0;flex:1" }, el("h3", null, d.name), el("p", { class: "addr" }, addrLine(d)),
          el("div", { class: "meta" }, prodPills(d), d._dist != null && S.me ? el("span", { class: "dist" }, d._dist < 1 ? Math.round(d._dist * 1000) + " m" : d._dist.toFixed(1) + " km") : null)),
        d.photo ? el("img", { class: "thumb", src: photoSrc(d, true), alt: "", loading: "lazy", width: "64", height: "64" }) : null),
      actions(d));
    li.addEventListener("click", e => { if (e.target.closest("a")) return; select(d, true); });
    li.addEventListener("keydown", e => { if (e.key === "Enter") select(d, true); });
    return li;
  }
  function renderList() {
    const ol = $("#list"); ol.innerHTML = "";
    if (!FILTERED.length) { ol.append(el("li", { class: "empty" }, "No dealer matches your search. Try another area or clear the filters.")); return; }
    for (const d of FILTERED.slice(0, S.limit)) ol.append(card(d));
    if (FILTERED.length > S.limit) ol.append(el("li", { class: "empty" }, el("button", { class: "btn", type: "button", onclick: () => { S.limit += 200; renderList(); } }, `Show ${Math.min(200, FILTERED.length - S.limit)} more`)));
  }

  /* ---------- near me ---------- */
  $("#nearBtn").addEventListener("click", () => {
    const b = $("#nearBtn");
    if (!navigator.geolocation) { alertMsg("Your browser cannot share your location. Search by area instead."); return; }
    b.setAttribute("aria-busy", "true");
    navigator.geolocation.getCurrentPosition(p => {
      b.removeAttribute("aria-busy");
      S.me = { lat: p.coords.latitude, lng: p.coords.longitude }; apply();
      document.getElementById("find").scrollIntoView({ behavior: "smooth" });
      if (mapReady && LEAF) {
        if (meMarker) meMarker.remove();
        meMarker = L.circleMarker([S.me.lat, S.me.lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#2563EB", fillOpacity: 1 }).addTo(map).bindTooltip("You are here");
        map.fitBounds(L.latLngBounds([[S.me.lat, S.me.lng], ...FILTERED.slice(0, 5).map(d => [d.lat, d.lng])]), { padding: [60, 60] });
      } else if (mapReady) {
        if (meMarker) meMarker.setMap(null);
        meMarker = new google.maps.Marker({ position: S.me, map, title: "You are here", zIndex: 9999, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#2563EB", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } });
        const b2 = new google.maps.LatLngBounds(); b2.extend(S.me); FILTERED.slice(0, 5).forEach(d => b2.extend(d)); map.fitBounds(b2, 60);
      }
    }, err => { b.removeAttribute("aria-busy"); alertMsg(err.code === 1 ? "Location permission was not given. Allow location for this site, or search by your area." : "Your location could not be found. Search by your area instead."); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  function alertMsg(t) { const c = $("#resCount"); c.textContent = t; setTimeout(() => apply(), 5000); }

  /* ---------- map ---------- */
  window.__parbatInitMap = function () {
    map = new google.maps.Map($("#map"), {
      center: { lat: CFG.center[0], lng: CFG.center[1] }, zoom: CFG.zoom, mapId: CFG.mapId || undefined,
      mapTypeControl: true, mapTypeControlOptions: { mapTypeIds: ["roadmap", "hybrid"], position: google.maps.ControlPosition.TOP_LEFT, style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR },
      streetViewControl: false, fullscreenControl: true, gestureHandling: isTouch ? "cooperative" : "greedy", clickableIcons: false,
    });
    info = new google.maps.InfoWindow({ maxWidth: 320 });
    info.addListener("closeclick", () => { S.sel = null; highlight(); });
    mapReady = true;
    if (DEALERS.length) { buildMarkers(); openFromHash(); }
  };
  if (CFG.mapsKey) {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.mapsKey)}&v=weekly&loading=async&callback=__parbatInitMap${CFG.mapId ? "&libraries=marker" : ""}`;
    s.async = true; s.onerror = () => showMapMsg("The map could not load. Check your internet connection. You can still use the list and open any shop in Google Maps.");
    document.head.append(s);
    window.gm_authFailure = () => showMapMsg("The map is not available right now. You can still use the list and open any shop in Google Maps.");
  } else {
    const css = h => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = h; document.head.append(l); };
    const js = src => new Promise((res, rej) => { const x = document.createElement("script"); x.src = src; x.onload = res; x.onerror = rej; document.head.append(x); });
    css("/assets/vendor/leaflet/leaflet.css"); css("/assets/vendor/leaflet/MarkerCluster.css");
    js("/assets/vendor/leaflet/leaflet.js").then(() => js("/assets/vendor/leaflet/leaflet.markercluster.js")).then(initLeaflet)
      .catch(() => showMapMsg("The map could not load. You can still use the list and open any shop in Google Maps."));
  }
  function initLeaflet() {
    map = L.map($("#map"), { center: CFG.center, zoom: CFG.zoom, zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const road = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" });
    L.control.layers({ "Map": road, "Satellite": sat }, null, { position: "topleft", collapsed: false }).addTo(map);
    map.on("popupclose", e => { if (e.popup._dealerId === S.sel) { S.sel = null; highlight(); } });
    mapReady = true;
    if (DEALERS.length) { buildMarkers(); openFromHash(); }
  }
  const pinSvg = (color, s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s * 1.3}" viewBox="0 0 24 31"><path d="M12 30s10-10.3 10-18A10 10 0 0 0 2 12c0 7.7 10 18 10 18z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>`;
  function buildLeafletMarkers() {
    MARKERS.clear();
    for (const d of DEALERS) {
      const m = L.marker([d.lat, d.lng], { title: d.name, icon: L.divIcon({ className: "lpin", html: pinSvg(COLOR[d.salesman] || "#1E7B3C", 26), iconSize: [26, 34], iconAnchor: [13, 34] }) });
      m.on("click", () => select(d, false));
      MARKERS.set(d.id, m);
    }
    clusterer = L.markerClusterGroup({ maxClusterRadius: 60, disableClusteringAtZoom: 16, showCoverageOnHover: false,
      iconCreateFunction: c => { const n = c.getChildCount(), z = n < 20 ? 40 : n < 80 ? 48 : 56; return L.divIcon({ className: "", html: `<div class="lc" style="width:${z}px;height:${z}px">${n}</div>`, iconSize: [z, z] }); } });
    map.addLayer(clusterer);
    updateMarkers(true);
  }
  function showMapMsg(t) { const m = $("#mapMsg"); m.hidden = false; m.innerHTML = ""; m.append(el("div", null, t)); }

  function pinIcon(color, big) { const s = big ? 34 : 26; return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s * 1.3}" viewBox="0 0 24 31"><path d="M12 30s10-10.3 10-18A10 10 0 0 0 2 12c0 7.7 10 18 10 18z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>`), scaledSize: new google.maps.Size(s, s * 1.3), anchor: new google.maps.Point(s / 2, s * 1.3) }; }
  function buildMarkers() {
    if (LEAF) return buildLeafletMarkers();
    MARKERS.clear();
    for (const d of DEALERS) {
      const m = new google.maps.Marker({ position: { lat: d.lat, lng: d.lng }, title: d.name, icon: pinIcon(COLOR[d.salesman] || "#1E7B3C"), optimized: true });
      m.addListener("click", () => select(d, false));
      MARKERS.set(d.id, m);
    }
    const renderer = { render: ({ count, position }) => new google.maps.Marker({ position, zIndex: 1000 + count,
      label: { text: String(count), color: "#fff", fontSize: "12px", fontWeight: "700" },
      icon: { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="21" fill="#1E7B3C" fill-opacity=".92" stroke="#fff" stroke-width="3"/><circle cx="24" cy="24" r="21" fill="none" stroke="#E0A91B" stroke-width="2" stroke-opacity=".9" transform="scale(1.0)"/></svg>`), scaledSize: new google.maps.Size(count < 20 ? 40 : count < 80 ? 48 : 56, count < 20 ? 40 : count < 80 ? 48 : 56) } }) };
    clusterer = new markerClusterer.MarkerClusterer({ map, markers: [], renderer, algorithmOptions: { maxZoom: 15, radius: 70 } });
    updateMarkers(true);
  }
  let fitted = false;
  function updateMarkers(first) {
    if (!mapReady || !clusterer) return;
    const vis = FILTERED.map(d => MARKERS.get(d.id)).filter(Boolean);
    if (LEAF) {
      clusterer.clearLayers(); clusterer.addLayers(vis);
      if (S.sel && !FILTERED.some(d => d.id === S.sel)) { map.closePopup(); S.sel = null; }
      if (!S.me && FILTERED.length && (first || !fitted || FILTERED.length < DEALERS.length)) {
        if (FILTERED.length === 1) map.setView([FILTERED[0].lat, FILTERED[0].lng], 17); else map.fitBounds(L.latLngBounds(FILTERED.map(d => [d.lat, d.lng])), { padding: [48, 48] });
        fitted = true;
      }
      return;
    }
    clusterer.clearMarkers(); clusterer.addMarkers(vis);
    if (S.sel && !FILTERED.some(d => d.id === S.sel)) { info.close(); S.sel = null; }
    if (!S.me && FILTERED.length && (first || !fitted || FILTERED.length < DEALERS.length)) {
      const b = new google.maps.LatLngBounds(); FILTERED.forEach(d => b.extend(d));
      if (FILTERED.length === 1) { map.setCenter(FILTERED[0]); map.setZoom(17); } else map.fitBounds(b, 48);
      fitted = true;
    }
  }
  function infoContent(d) {
    const box = el("div", { class: "iw" }, d.photo ? el("a", { class: "shot", href: photoSrc(d), target: "_blank", rel: "noopener", title: "Open full photo" }, el("img", { src: photoSrc(d), alt: "Shop photo of " + d.name, width: "290", height: "160" })) : null, el("h3", null, d.name), d.contact ? el("p", { class: "who" }, "Contact: " + d.contact) : null,
      el("div", { class: "meta" }, prodPills(d)),
      el("dl", null, d.mobile ? [el("dt", null, "Mobile"), el("dd", null, el("a", { href: telHref(d.mobile) }, d.mobile))] : null,
        el("dt", null, "Address"), el("dd", null, addrLine(d) || d.town),
        d.area ? [el("dt", null, "Area"), el("dd", null, d.area)] : null,
        d.street ? [el("dt", null, "Street"), el("dd", null, d.street)] : null,
        el("dt", null, "Town"), el("dd", null, d.town),
        el("dt", null, "GPS"), el("dd", { class: "gps" }, el("a", { href: placeHref(d), target: "_blank", rel: "noopener" }, `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`))),
      actions(d));
    return box;
  }
  function select(d, fromList) {
    S.sel = d.id; highlight();
    history.replaceState(null, "", "#dealer-" + d.id);
    if (!mapReady) { if (fromList) window.open(placeHref(d), "_blank", "noopener"); return; }
    const m = MARKERS.get(d.id);
    if (LEAF) {
      const open = () => { const p = L.popup({ maxWidth: 320, offset: [0, -28] }).setLatLng([d.lat, d.lng]).setContent(infoContent(d)); p._dealerId = d.id; p.openOn(map); };
      if (fromList && m) { if (matchMedia("(max-width:980px)").matches) $("#map").scrollIntoView({ behavior: "smooth", block: "start" }); clusterer.zoomToShowLayer(m, open); } else open();
      return;
    }
    if (fromList) { map.panTo(d); if (map.getZoom() < 16) map.setZoom(17); if (matchMedia("(max-width:980px)").matches) $("#map").scrollIntoView({ behavior: "smooth", block: "start" }); }
    setTimeout(() => { info.setContent(infoContent(d)); info.open({ map, anchor: m }); }, fromList ? 250 : 0);
  }
  function highlight() { for (const c of document.querySelectorAll(".card")) c.classList.toggle("sel", +c.dataset.id === S.sel); }
  function openFromHash() { const m = /^#dealer-(\d+)$/.exec(location.hash); if (!m || !DEALERS.length) return; const d = DEALERS.find(x => x.id === +m[1]); if (!d) return; if (mapReady) select(d, true); else { S.sel = d.id; highlight(); const c = document.querySelector(`.card[data-id="${d.id}"]`); if (c) c.scrollIntoView({ block: "center" }); } }
})();
