"use strict";
/**
 * Parbat Flour Mills – Find a Dealer
 * Public dealer locator (Google Maps) + password-protected admin panel.
 * Public pages and /api/public/* only ever expose the public fields built in publicDealers().
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
try { fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch (_) {}

const { q, one, run, init, getSettings, DEFAULT_SETTINGS } = require("./src/db");
const auth = require("./src/auth");
const importer = require("./src/importer");
const XLSX = require("xlsx");
const { nameKey, normMobile, validLatLng, clean, esc, similarity } = require("./src/util");

const PORT = +process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const MAP_ID = process.env.GOOGLE_MAP_ID || "";
const PROD = process.env.NODE_ENV === "production";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);
const A = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  if (PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (process.env.CSP !== "off") {
    const g = "https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com";
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'", `script-src 'self' ${g} 'unsafe-eval' blob:`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com data:`, `img-src 'self' data: blob: ${g} https://*.tile.openstreetmap.org https://server.arcgisonline.com`, `connect-src 'self' ${g} data: blob:`,
      `worker-src 'self' blob:`, `frame-src https://*.google.com`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
    ].join("; "));
  }
  next();
});

/* ---------- public data ---------- */
let pubVersion = Date.now(), pubCache = null;
const bump = () => { pubVersion = Date.now(); pubCache = null; };
async function publicDealers() {
  if (pubCache) return pubCache;
  const rows = await q(`SELECT d.id,d.name,d.contact_person,d.mobile,d.show_mobile,d.address,d.town,d.area,d.street,d.lat,d.lng,d.has_atta,d.has_maida,d.has_choker,s.name salesman
    FROM dealers d JOIN salesmen s ON s.id=d.salesman_id
    WHERE d.published=1 AND s.active=1 AND d.lat IS NOT NULL AND d.lng IS NOT NULL ORDER BY d.name`);
  // Public fields only: nothing about sales, ranking, purchases, codes or internal notes leaves through here.
  const dealers = rows.map(r => ({ id: r.id, name: r.name, contact: r.contact_person, mobile: r.show_mobile ? r.mobile : "", address: r.address, town: r.town, area: r.area, street: r.street,
    lat: +(+r.lat).toFixed(6), lng: +(+r.lng).toFixed(6), products: [r.has_atta && "Atta", r.has_maida && "Maida", r.has_choker && "Choker"].filter(Boolean), salesman: r.salesman }));
  const salesmen = await q("SELECT name,color FROM salesmen WHERE active=1 ORDER BY sort,name");
  pubCache = { version: pubVersion, dealers, salesmen };
  return pubCache;
}
app.get("/api/public/dealers", A(async (req, res) => {
  const p = await publicDealers(), etag = `"d${p.version}"`;
  res.setHeader("Cache-Control", "public, max-age=60"); res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.json(p);
}));
app.get("/healthz", (req, res) => res.type("text/plain").send("ok"));

/* ---------- pages ---------- */
const tpl = name => fs.readFileSync(path.join(__dirname, "views", name), "utf8");
// Browsers keep /assets files for 7 days, so page links carry a version that changes whenever the files change.
const ASSET_V = require("crypto").createHash("md5").update(["site.js", "site.css"].map(f => fs.readFileSync(path.join(__dirname, "public", "assets", f))).join("")).digest("hex").slice(0, 10);
function render(name, vars) { return tpl(name).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "").replace(/"(\/assets\/site\.(?:js|css))"/g, `"$1?v=${ASSET_V}"`); }
function waNumber(m) { let d = String(m || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "92" + d.slice(1); return d; }
let settingsCache = null;
async function settings() { if (!settingsCache) settingsCache = await getSettings(); return settingsCache; }
async function common() {
  const s = await settings();
  return {
    SITE_NAME: esc(s.site_name), BASE_URL, YEAR: new Date().getFullYear(),
    ADDRESS: esc(s.company_address), PHONE: esc(s.company_phone), EMAIL: esc(s.company_email), HOURS: esc(s.office_hours),
    PHONE_LINK: esc((s.company_phone || "").replace(/[^\d+]/g, "")), WA_LINK: s.company_whatsapp ? "https://wa.me/" + esc(waNumber(s.company_whatsapp)) : "",
    settings: s,
  };
}
app.get("/", A(async (req, res) => {
  const c = await common(), p = await publicDealers(), s = c.settings;
  const byArea = {};
  for (const d of p.dealers) (byArea[d.area || d.town] = byArea[d.area || d.town] || []).push(d);
  const seo = Object.keys(byArea).sort().map(a => `<h3>${esc(a)}</h3><ul>${byArea[a].map(d => `<li>${esc(d.name)} – ${esc([d.street, d.area, d.town].filter(Boolean).join(", "))}${d.products.length ? " (" + d.products.join(", ") + ")" : ""}</li>`).join("")}</ul>`).join("");
  const cfg = { mapsKey: MAPS_KEY, mapId: MAP_ID, center: [+s.map_center_lat || 30.1984, +s.map_center_lng || 71.4687], zoom: +s.map_zoom || 12, phone: s.company_phone, whatsapp: s.company_whatsapp };
  const jsonld = { "@context": "https://schema.org", "@type": "Organization", name: "Parbat Flour Mills", url: BASE_URL, logo: BASE_URL + "/assets/parbat-logo.jpg", address: { "@type": "PostalAddress", streetAddress: s.company_address, addressLocality: "Multan", addressCountry: "PK" }, ...(s.company_phone ? { telephone: s.company_phone } : {}) };
  res.setHeader("Cache-Control", "no-cache");
  res.send(render("index.html", { ...c, COUNT: p.dealers.length, SEO_LIST: seo, CONFIG: esc(JSON.stringify(cfg)), JSONLD: JSON.stringify(jsonld).replace(/</g, "\\u003c") }));
}));
app.get("/find", (req, res) => res.redirect(302, "/#find"));
app.get("/contact", A(async (req, res) => { const c = await common(); res.send(render("contact.html", { ...c, PHONE_BLOCK: c.PHONE ? `<a href="tel:${c.PHONE_LINK}">${c.PHONE}</a>` : "Contact number will be added soon.", WA_BLOCK: c.WA_LINK ? `<a class="btn wa" href="${c.WA_LINK}" target="_blank" rel="noopener">WhatsApp us</a>` : "", EMAIL_BLOCK: c.EMAIL ? `<a href="mailto:${c.EMAIL}">${c.EMAIL}</a>` : "—" })); }));
app.get("/robots.txt", (req, res) => res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin\nSitemap: ${BASE_URL}/sitemap.xml\n`));
app.get("/sitemap.xml", (req, res) => res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url><url><loc>${BASE_URL}/contact</loc><priority>0.5</priority></url></urlset>`));
app.use("/assets", express.static(path.join(__dirname, "public", "assets"), { maxAge: PROD ? "7d" : 0 }));
app.get("/favicon.ico", (req, res) => res.redirect(301, "/assets/favicon.ico"));

/* ---------- admin pages ---------- */
app.get("/admin/login", A(async (req, res) => { if (await auth.currentAdmin(req)) return res.redirect("/admin"); res.setHeader("Cache-Control", "no-store"); res.sendFile(path.join(__dirname, "admin", "login.html")); }));
app.get("/admin", auth.requirePage, (req, res) => { res.setHeader("Cache-Control", "no-store"); res.send(fs.readFileSync(path.join(__dirname, "admin", "index.html"), "utf8").replace("{{CONFIG}}", esc(JSON.stringify({ mapsKey: MAPS_KEY, mapId: MAP_ID, user: req.admin.username })))); });
app.use("/admin/static", auth.requirePage, express.static(path.join(__dirname, "admin", "static"), { maxAge: 0 }));

/* ---------- admin API ---------- */
const api = express.Router();
api.use(express.json({ limit: "2mb" }));
app.post("/api/admin/login", express.json({ limit: "10kb" }), A(async (req, res) => {
  const r = await auth.login(req.body && req.body.username, req.body && req.body.password, req.ip);
  if (r.error) return res.status(401).json({ error: r.error });
  auth.setCookie(res, r.token, auth.SESSION_HOURS * 3600);
  await run("INSERT INTO audit(admin,action) VALUES($1,$2)", [r.username, "Signed in"]);
  res.json({ ok: true });
}));
app.use("/api/admin", auth.requireApi, api);
const log = (req, action, dealerId, details) => run("INSERT INTO audit(admin,action,dealer_id,details) VALUES($1,$2,$3,$4)", [req.admin.username, action, dealerId || null, typeof details === "string" ? details : JSON.stringify(details || "")]);

api.post("/logout", A(async (req, res) => { await auth.logout(req); auth.setCookie(res, "", 0); res.json({ ok: true }); }));
api.post("/password", A(async (req, res) => { const e = await auth.changePassword(req.admin.id, req.body.current, req.body.next); if (e) return res.status(400).json({ error: e }); await log(req, "Changed password"); auth.setCookie(res, "", 0); res.json({ ok: true }); }));

const EDITABLE = ["code", "name", "contact_person", "mobile", "show_mobile", "address", "town", "area", "street", "salesman_id", "lat", "lng", "gps_verified", "has_atta", "has_maida", "has_choker", "published", "notes"];
async function validateDealer(b, existingId) {
  const o = {}, errs = [];
  for (const k of EDITABLE) if (k in b) o[k] = b[k];
  if ("name" in o) { o.name = clean(o.name, 200).toUpperCase(); if (!o.name) errs.push("Dealer name is required."); }
  for (const k of ["contact_person", "address", "town", "area", "street", "notes", "code"]) if (k in o) o[k] = clean(o[k], k === "notes" ? 2000 : 300);
  if ("code" in o && !o.code) o.code = null;
  if ("mobile" in o) { const raw = String(o.mobile || "").trim(); o.mobile = raw ? normMobile(raw) : ""; if (raw && !o.mobile) errs.push("Mobile must be like 0300-1234567."); }
  for (const k of ["show_mobile", "gps_verified", "has_atta", "has_maida", "has_choker", "published"]) if (k in o) o[k] = o[k] ? 1 : 0;
  if ("salesman_id" in o) { o.salesman_id = o.salesman_id ? +o.salesman_id : null; if (o.salesman_id && !(await one("SELECT 1 x FROM salesmen WHERE id=$1", [o.salesman_id]))) errs.push("Unknown salesman."); }
  if ("lat" in o || "lng" in o) {
    const la = o.lat === "" || o.lat == null ? null : +o.lat, ln = o.lng === "" || o.lng == null ? null : +o.lng;
    if ((la == null) !== (ln == null)) errs.push("Enter both latitude and longitude.");
    else if (la != null && !validLatLng(la, ln)) errs.push("GPS must be inside Pakistan (latitude 23–37.5, longitude 60–78).");
    o.lat = la; o.lng = ln;
  }
  if (o.code && await one("SELECT id FROM dealers WHERE code=$1 AND id<>$2", [o.code, existingId || 0])) errs.push(`Party code ${o.code} already belongs to another dealer.`);
  return { o, errs };
}
const dealerRow = id => one("SELECT d.*, s.name salesman FROM dealers d LEFT JOIN salesmen s ON s.id=d.salesman_id WHERE d.id=$1", [id]);

api.get("/dealers", A(async (req, res) => res.json(await q("SELECT d.*, s.name salesman, s.color FROM dealers d LEFT JOIN salesmen s ON s.id=d.salesman_id ORDER BY d.name"))));
api.post("/dealers", A(async (req, res) => {
  const { o, errs } = await validateDealer(req.body); if (!o.name) errs.push("Dealer name is required.");
  if (errs.length) return res.status(400).json({ error: [...new Set(errs)].join(" ") });
  if (!req.body.force) { const k = nameKey(o.name); const dup = (await q("SELECT id,name,area FROM dealers")).find(d => similarity(k, nameKey(d.name)) >= 0.92); if (dup) return res.status(409).json({ error: `Possible duplicate of "${dup.name}" (${dup.area}).`, duplicate: dup }); }
  o.name_key = nameKey(o.name);
  const cols = Object.keys(o);
  const r = await one(`INSERT INTO dealers(${cols.join(",")}) VALUES(${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`, cols.map(c => o[c]));
  await log(req, "Added dealer", r.id, o.name); bump();
  res.json(await dealerRow(r.id));
}));
api.put("/dealers/:id", A(async (req, res) => {
  const id = +req.params.id, cur = await dealerRow(id); if (!cur) return res.status(404).json({ error: "Dealer not found." });
  const { o, errs } = await validateDealer(req.body, id); if (errs.length) return res.status(400).json({ error: errs.join(" ") });
  const ch = {}; for (const k in o) if (String(cur[k] ?? "") !== String(o[k] ?? "")) ch[k] = [cur[k], o[k]];
  if (!Object.keys(ch).length) return res.json(cur);
  if (("lat" in ch || "lng" in ch) && !("gps_verified" in req.body)) o.gps_verified = 0;
  if ("name" in ch) o.name_key = nameKey(o.name);
  const cols = Object.keys(o);
  await run(`UPDATE dealers SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(",")}, updated_at=now() WHERE id=$${cols.length + 1}`, [...cols.map(k => o[k]), id]);
  await log(req, "Edited dealer", id, ch); bump();
  res.json(await dealerRow(id));
}));
api.delete("/dealers/:id", A(async (req, res) => { const d = await dealerRow(+req.params.id); if (!d) return res.status(404).json({ error: "Not found" }); await run("DELETE FROM dealers WHERE id=$1", [d.id]); await log(req, "Deleted dealer", d.id, d.name); bump(); res.json({ ok: true }); }));
api.post("/dealers/bulk", A(async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean), act = req.body.action; if (!ids.length) return res.status(400).json({ error: "No dealers selected." });
  let n = 0;
  if (act === "publish") n = await run("UPDATE dealers SET published=1, updated_at=now() WHERE lat IS NOT NULL AND id = ANY($1::int[])", [ids]);
  else if (act === "hide") n = await run("UPDATE dealers SET published=0, updated_at=now() WHERE id = ANY($1::int[])", [ids]);
  else if (act === "verify") n = await run("UPDATE dealers SET gps_verified=1 WHERE lat IS NOT NULL AND id = ANY($1::int[])", [ids]);
  else if (act === "salesman") n = await run("UPDATE dealers SET salesman_id=$2, updated_at=now() WHERE id = ANY($1::int[])", [ids, +req.body.salesman_id || null]);
  else if (act === "delete") n = await run("DELETE FROM dealers WHERE id = ANY($1::int[])", [ids]);
  else return res.status(400).json({ error: "Unknown action." });
  await log(req, "Bulk " + act, null, `${n} dealers`); bump(); res.json({ changed: n });
}));

api.get("/salesmen", A(async (req, res) => res.json(await q("SELECT s.*, (SELECT COUNT(*)::int FROM dealers d WHERE d.salesman_id=s.id) dealers FROM salesmen s ORDER BY sort,name"))));
api.post("/salesmen", A(async (req, res) => { const name = clean(req.body.name, 80); const color = /^#[0-9a-f]{6}$/i.test(req.body.color || "") ? req.body.color : "#475569"; if (!name) return res.status(400).json({ error: "Name required." });
  try { await run("INSERT INTO salesmen(name,color,sort) VALUES($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM salesmen))", [name, color]); } catch { return res.status(409).json({ error: "This salesman already exists." }); }
  await log(req, "Added salesman", null, name); bump(); res.json({ ok: true }); }));
api.put("/salesmen/:id", A(async (req, res) => { const s = await one("SELECT * FROM salesmen WHERE id=$1", [+req.params.id]); if (!s) return res.status(404).json({ error: "Not found" });
  const name = clean(req.body.name ?? s.name, 80), color = /^#[0-9a-f]{6}$/i.test(req.body.color || "") ? req.body.color : s.color, active = "active" in req.body ? (req.body.active ? 1 : 0) : s.active;
  try { await run("UPDATE salesmen SET name=$1,color=$2,active=$3 WHERE id=$4", [name, color, active, s.id]); } catch { return res.status(409).json({ error: "Another salesman has this name." }); }
  await log(req, "Edited salesman", null, { from: s.name, to: name, color, active }); bump(); res.json({ ok: true }); }));
api.delete("/salesmen/:id", A(async (req, res) => { const n = (await one("SELECT COUNT(*)::int n FROM dealers WHERE salesman_id=$1", [+req.params.id])).n; if (n) return res.status(400).json({ error: `Move this salesman's ${n} dealers first.` }); await run("DELETE FROM salesmen WHERE id=$1", [+req.params.id]); await log(req, "Deleted salesman", null, req.params.id); bump(); res.json({ ok: true }); }));

api.get("/towns", A(async (req, res) => res.json(await q("SELECT t.name, (SELECT COUNT(*)::int FROM dealers d WHERE d.town=t.name) dealers FROM towns t ORDER BY t.name"))));
api.post("/towns", A(async (req, res) => { const n = clean(req.body.name, 80); if (!n) return res.status(400).json({ error: "Name required." }); await run("INSERT INTO towns(name) VALUES($1) ON CONFLICT DO NOTHING", [n]); await log(req, "Added town", null, n); res.json({ ok: true }); }));

api.get("/settings", A(async (req, res) => res.json({ settings: await getSettings(), mapsKeySet: !!MAPS_KEY })));
api.put("/settings", A(async (req, res) => { const ch = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in req.body) { await run("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [k, clean(req.body[k], 300)]); ch[k] = req.body[k]; }
  settingsCache = null; await log(req, "Changed settings", null, ch); bump(); res.json({ ok: true }); }));

api.get("/audit", A(async (req, res) => res.json(await q("SELECT a.id, to_char(a.at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD HH24:MI') at, a.admin, a.action, a.dealer_id, a.details, d.name dealer FROM audit a LEFT JOIN dealers d ON d.id=a.dealer_id ORDER BY a.id DESC LIMIT 500"))));
api.get("/stats", A(async (req, res) => res.json(await one(`SELECT COUNT(*)::int total, COALESCE(SUM(published),0)::int published, COUNT(*) FILTER (WHERE lat IS NULL)::int no_gps,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND gps_verified=0)::int unverified, COUNT(*) FILTER (WHERE mobile='')::int no_mobile, COUNT(*) FILTER (WHERE salesman_id IS NULL)::int no_salesman FROM dealers`))));

app.post("/api/admin/import/preview", auth.requireApi, express.raw({ type: "application/octet-stream", limit: "15mb" }), A(async (req, res) => {
  let parsed;
  try { let fname = req.get("X-File-Name") || "upload"; try { fname = decodeURIComponent(fname); } catch (_) {} parsed = importer.parseFile(req.body, clean(fname, 120)); }
  catch (e) { return res.status(400).json({ error: "Could not read this file: " + e.message }); }
  let mapping = null; try { mapping = req.get("X-Mapping") ? JSON.parse(req.get("X-Mapping")) : null; } catch (_) {}
  const p = await importer.preview(parsed, mapping);
  if (p.error) return res.status(400).json(p);
  res.json(p);
}));
api.post("/import/apply", A(async (req, res) => { try { const r = await importer.apply(req.body.token, req.body.decisions, { publishNew: !!req.body.publishNew }, req.admin.username); bump(); res.json(r); } catch (e) { res.status(400).json({ error: e.message }); } }));

const EXPORT_SQL = `SELECT d.id "Dealer ID", d.code "Party Code", d.name "Dealer / Shop", d.contact_person "Contact Person", d.mobile "Mobile", d.show_mobile "Show Mobile", d.address "Address", d.street "Street", d.area "Area", d.town "Town", s.name "Salesman", d.lat "Latitude", d.lng "Longitude", d.gps_verified "GPS Verified", d.has_atta "Atta", d.has_maida "Maida", d.has_choker "Choker", d.published "Published", d.notes "Notes", to_char(d.updated_at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD HH24:MI') "Updated" FROM dealers d LEFT JOIN salesmen s ON s.id=d.salesman_id ORDER BY s.sort, d.name`;
api.get("/export.xlsx", A(async (req, res) => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q(EXPORT_SQL)), "Dealers");
  res.setHeader("Content-Disposition", `attachment; filename="Parbat_Dealers_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}));
api.get("/backup.xlsx", A(async (req, res) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q(EXPORT_SQL)), "Dealers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q("SELECT id, name, color, active, sort FROM salesmen ORDER BY sort")), "Salesmen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q("SELECT name FROM towns ORDER BY name")), "Towns");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q("SELECT key, value FROM settings ORDER BY key")), "Settings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(await q("SELECT to_char(at AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD HH24:MI') at, admin, action, dealer_id, details FROM audit ORDER BY id DESC LIMIT 5000")), "Activity");
  await log(req, "Downloaded full backup");
  res.setHeader("Content-Disposition", `attachment; filename="Parbat_Full_Backup_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}));

app.use(A(async (req, res) => res.status(404).send(render("404.html", await common()))));
app.use((err, req, res, next) => { console.error(err); if (req.path.startsWith("/api/")) return res.status(503).json({ error: "The database is waking up. Please try again in a few seconds." }); res.status(503).send("<p style='font-family:sans-serif;padding:24px'>The website is starting up. Please refresh in a few seconds.</p>"); });

(async () => {
  for (let i = 1; ; i++) {
    try { await init(); await auth.ensureFirstAdmin(); break; }
    catch (e) { console.error(`Database not reachable (attempt ${i}): ${e.message}`); if (i >= 10) process.exit(1); await new Promise(r => setTimeout(r, 3000)); }
  }
  app.listen(PORT, () => console.log(`Parbat dealer site running on ${BASE_URL} (port ${PORT})${MAPS_KEY ? "" : "  — GOOGLE_MAPS_API_KEY is not set, the map will show a notice."}`));
})();
