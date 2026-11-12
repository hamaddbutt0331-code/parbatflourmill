"use strict";
const crypto = require("crypto");
const XLSX = require("xlsx");
const { q, tx } = require("./db");
const { nameKey, similarity, normMobile, validLatLng, toBool, clean, titleCase } = require("./util");

const FIELDS = [
  ["code", "Party code / Dealer ID"], ["name", "Dealer / shop name"], ["contact_person", "Contact person"], ["mobile", "Mobile"],
  ["address", "Address"], ["town", "Town"], ["area", "Area / sector"], ["street", "Street"], ["salesman", "Salesman"],
  ["lat", "Latitude"], ["lng", "Longitude"], ["atta", "Atta available"], ["maida", "Maida available"], ["choker", "Choker available"], ["published", "Published"],
];
const SYN = {
  code: ["partycode", "partyno", "partynumber", "dealerid", "code", "id"],
  name: ["dealershop", "dealershopname", "dealername", "shopname", "partyname", "nameofattashops", "nameofshop", "dealer", "shop", "name"],
  contact_person: ["contactperson", "ownername", "owner", "contact"],
  mobile: ["mobilenumber", "mobileno", "mobile", "cell", "cellno", "phone", "phoneno", "whatsapp"],
  address: ["completeaddress", "shopaddress", "address", "addressorsector"],
  town: ["town", "city", "tehsil", "nameoftehsil"],
  area: ["areasector", "area", "sector", "locality"],
  street: ["street", "streetroad", "road"],
  salesman: ["townsalesman", "salesman", "salesperson", "salesmanname"],
  lat: ["latitude", "gpslatitude", "gpslatitude", "lat"],
  lng: ["longitude", "gpslongitude", "logitude", "lng", "lon", "long"],
  atta: ["atta", "hasatta", "attaavailable"], maida: ["maida", "hasmaida", "maidaavailable"], choker: ["choker", "haschoker", "chokeravailable", "bran"],
  published: ["published", "publish", "show", "visible"],
};
const hn = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function headerScore(rows) {
  let best = 0, bi = 0;
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const hs = (rows[i] || []).map(hn); let sc = 0;
    for (const k in SYN) if (hs.some(h => h && SYN[k].some(s => h === s || (s.length >= 4 && h.startsWith(s))))) sc++;
    if (sc > best) { best = sc; bi = i; }
  }
  return [bi, best];
}
function parseFile(buf, filename) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: true });
  let best = null;
  for (const n of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false });
    const [hi, sc] = headerScore(rows);
    if (!best || sc > best.sc) best = { sheet: n, rows, hi, sc };
  }
  if (!best || best.sc < 1) throw new Error("No dealer columns found in this file.");
  let header = best.rows[best.hi] || [], start = best.hi + 1;
  const next = best.rows[best.hi + 1] || [];
  const nextHit = next.some(v => { const h = hn(v); return h && Object.values(SYN).some(l => l.includes(h)); });
  if (nextHit && next.filter(v => typeof v === "number").length <= 1) {
    const len = Math.max(header.length, next.length);
    header = Array.from({ length: len }, (_, i) => (next[i] != null && String(next[i]).trim()) ? next[i] : header[i]);
    start = best.hi + 2;
  }
  header = header.map((h, i) => (h == null || String(h).trim() === "") ? `Column ${i + 1}` : String(h).trim());
  return { file: filename, sheet: wb.SheetNames.length > 1 ? best.sheet : "", header, rows: best.rows.slice(start).filter(r => r && r.some(v => v != null && String(v).trim() !== "")) };
}
function autoMap(header) {
  const hs = header.map(hn), m = {}, used = new Set();
  const order = ["code", "name", "salesman", "mobile", "lat", "lng", "contact_person", "address", "area", "street", "town", "atta", "maida", "choker", "published"];
  for (const k of order) {
    let i = hs.findIndex((h, j) => !used.has(j) && SYN[k].includes(h));
    if (i < 0) for (const s of SYN[k]) { if (s.length < 4) continue; i = hs.findIndex((h, j) => !used.has(j) && h.startsWith(s)); if (i >= 0) break; }
    m[k] = i; if (i >= 0) used.add(i);
  }
  return m;
}

async function salesmanLookup() {
  const list = await q("SELECT id,name FROM salesmen");
  return v => {
    const k = hn(v); if (!k) return null;
    let s = list.find(x => hn(x.name) === k) || list.find(x => k.includes(hn(x.name)) || hn(x.name).includes(k));
    if (!s) { const hit = list.filter(x => x.name.split(/\s+/).some(w => hn(w).length >= 4 && k.includes(hn(w)))); if (hit.length === 1) s = hit[0]; }
    return s || null;
  };
}

const sessions = new Map();
function rowToRecord(r, m, smFind) {
  const g = k => m[k] >= 0 ? r[m[k]] : null;
  const rec = {}, warn = [];
  const name = clean(g("name"), 200);
  if (!name) return null;
  rec.name = name.toUpperCase();
  const code = g("code"); if (code != null && String(code).trim() !== "") rec.code = String(code).trim().replace(/^P(?=\d)/, "");
  for (const k of ["contact_person", "address", "street"]) { const v = clean(g(k)); if (v) rec[k] = v; }
  for (const k of ["town", "area"]) { const v = clean(g(k), 120); if (v) rec[k] = v === v.toUpperCase() ? titleCase(v) : v; }
  // Some sheets (e.g. the Kobo survey) put the salesman's name in the "Town" column.
  if (rec.town && m.salesman < 0) { const s = smFind(rec.town); if (s) { rec.salesman_id = s.id; delete rec.town; } else if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(rec.town) && !/(abad|pur|wala|town|colony|road|multan)/i.test(rec.town)) { warn.push(`"${rec.town}" in the town column looks like a person, ignored`); delete rec.town; } }
  const mob = g("mobile"); if (mob != null && String(mob).trim()) { const mm = normMobile(mob); if (mm) rec.mobile = mm; else warn.push("mobile not valid"); }
  const la = parseFloat(g("lat")), ln = parseFloat(g("lng"));
  if (m.lat >= 0 && (g("lat") != null || g("lng") != null) && String(g("lat") ?? "").trim() !== "") { if (validLatLng(la, ln)) { rec.lat = +la.toFixed(7); rec.lng = +ln.toFixed(7); } else warn.push("GPS outside Pakistan"); }
  const sm = g("salesman"); if (sm != null && String(sm).trim()) { const s = smFind(sm); if (s) rec.salesman_id = s.id; else warn.push(`salesman "${clean(sm, 40)}" not in list`); }
  for (const [k, col] of [["atta", "has_atta"], ["maida", "has_maida"], ["choker", "has_choker"], ["published", "published"]]) if (m[k] >= 0 && g(k) != null && String(g(k)).trim() !== "") rec[col] = toBool(g(k)) ? 1 : 0;
  return { rec, warn };
}
const CMP = ["code", "name", "contact_person", "mobile", "address", "town", "area", "street", "salesman_id", "lat", "lng", "has_atta", "has_maida", "has_choker", "published"];
function diff(cur, rec) { const ch = {}; for (const k of CMP) if (k in rec && String(cur[k] ?? "") !== String(rec[k] ?? "")) ch[k] = [cur[k] ?? "", rec[k]]; return ch; }

async function preview(parsed, mapping) {
  const m = mapping || autoMap(parsed.header);
  if (m.name < 0) return { error: "Choose the column that has the dealer / shop name.", mapping: m, header: parsed.header, fields: FIELDS };
  const smFind = await salesmanLookup();
  const all = await q("SELECT * FROM dealers");
  const byCode = new Map(all.filter(d => d.code).map(d => [String(d.code), d]));
  const byKey = new Map(); for (const d of all) if (!byKey.has(d.name_key)) byKey.set(d.name_key, d);
  const seen = new Set(), items = [];
  parsed.rows.forEach((r, i) => {
    const x = rowToRecord(r, m, smFind); if (!x) return;
    const key = nameKey(x.rec.name), it = { row: i + 1, name: x.rec.name, rec: x.rec, warn: x.warn };
    const fileKey = x.rec.code ? "c" + x.rec.code : "k" + key;
    if (seen.has(fileKey)) { it.status = "duplicate"; items.push(it); return; }
    seen.add(fileKey);
    let d = x.rec.code && byCode.get(x.rec.code);
    if (d) it.how = "code"; else { d = byKey.get(key); if (d) it.how = "name"; }
    if (!d) {
      let best = null, bs = 0; for (const c of all) { const s = similarity(key, c.name_key); if (s > bs) { bs = s; best = c; } }
      if (bs >= 0.86) { it.status = "check"; it.match = { id: best.id, name: best.name, area: best.area, score: Math.round(bs * 100) }; it.decision = bs >= 0.94 ? "match" : "skip"; items.push(it); return; }
      it.status = "new"; it.decision = "new"; items.push(it); return;
    }
    it.match = { id: d.id, name: d.name, area: d.area };
    const ch = diff(d, x.rec); it.changes = ch; it.status = Object.keys(ch).length ? "update" : "same"; it.decision = "match";
    items.push(it);
  });
  const token = crypto.randomBytes(16).toString("hex");
  sessions.set(token, { at: Date.now(), items, file: parsed.file });
  for (const [t, s] of sessions) if (Date.now() - s.at > 30 * 60e3) sessions.delete(t);
  const count = s => items.filter(x => x.status === s).length;
  return { token, file: parsed.file, sheet: parsed.sheet, header: parsed.header, mapping: m, fields: FIELDS, items,
    summary: { rows: items.length, update: count("update"), same: count("same"), new: count("new"), check: count("check"), duplicate: count("duplicate"), warnings: items.filter(x => x.warn.length).length } };
}

async function apply(token, decisions, opts, adminName) {
  const s = sessions.get(token); if (!s) throw new Error("This preview has expired. Upload the file again.");
  decisions = decisions || {};
  let updated = 0, added = 0, skipped = 0;
  await tx(async t => {
    const upd = async (id, rec) => {
      const cur = await t.one("SELECT * FROM dealers WHERE id=$1", [id]); if (!cur) return false;
      const ch = diff(cur, rec); if (!Object.keys(ch).length) return false;
      if ("code" in ch && rec.code && await t.one("SELECT id FROM dealers WHERE code=$1 AND id<>$2", [rec.code, id])) delete ch.code;
      const cols = Object.keys(ch); if (!cols.length) return false;
      const vals = cols.map(k => rec[k]);
      const sets = cols.map((k, i) => `${k}=$${i + 1}`);
      if ("name" in ch) { vals.push(nameKey(rec.name)); sets.push(`name_key=$${vals.length}`); }
      if ("lat" in ch || "lng" in ch) sets.push("gps_verified=0");
      vals.push(id);
      await t.run(`UPDATE dealers SET ${sets.join(",")}, updated_at=now() WHERE id=$${vals.length}`, vals);
      return true;
    };
    for (const [idx, it] of s.items.entries()) {
      if (it.status === "duplicate" || it.status === "same") { skipped++; continue; }
      const dec = decisions[idx] || it.decision;
      if (dec === "skip") { skipped++; continue; }
      if (dec === "match" && it.match) { if (await upd(it.match.id, it.rec)) updated++; else skipped++; continue; }
      const r = it.rec;
      if (r.code && await t.one("SELECT id FROM dealers WHERE code=$1", [r.code])) { skipped++; continue; }
      const hasGps = r.lat != null;
      await t.run(`INSERT INTO dealers(code,name,name_key,contact_person,mobile,address,town,area,street,salesman_id,lat,lng,has_atta,has_maida,has_choker,published,gps_source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [r.code || null, r.name, nameKey(r.name), r.contact_person || "", r.mobile || "", r.address || "", r.town || "Multan", r.area || "", r.street || "",
          r.salesman_id || null, hasGps ? r.lat : null, hasGps ? r.lng : null, r.has_atta ?? 0, r.has_maida ?? 0, r.has_choker ?? 0,
          r.published ?? (opts && opts.publishNew && hasGps ? 1 : 0), hasGps ? "Import: " + s.file : ""]);
      added++;
    }
    await t.run("INSERT INTO audit(admin,action,details) VALUES($1,$2,$3)", [adminName, "Excel import", `${s.file}: ${updated} updated, ${added} added, ${skipped} unchanged or skipped`]);
    for (const tn of new Set(s.items.map(i => i.rec.town).filter(Boolean))) await t.run("INSERT INTO towns(name) VALUES($1) ON CONFLICT DO NOTHING", [tn]);
  });
  sessions.delete(token);
  return { updated, added, skipped };
}

module.exports = { parseFile, preview, apply, autoMap, FIELDS };
