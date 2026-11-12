"use strict";
const SYN = [["KERYANA", "KARYANA"], ["KIRYANA", "KARYANA"], ["KRYANA", "KARYANA"], ["KARAYANA", "KARYANA"], ["SAWEETS", "SWEETS"], ["TREEDRZ", "TRADERS"], ["TRADRS", "TRADERS"], ["MARKEET", "MARKET"]];

/** Normalized key used to recognise the same dealer written slightly differently. */
function nameKey(s) {
  s = " " + String(s || "").toUpperCase() + " ";
  for (const [a, b] of SYN) s = s.split(a).join(b);
  return s.replace(/\bMULTAN\b/g, "").replace(/^FD\s+/, "").replace(/[^A-Z0-9]/g, "");
}
function grams(s) { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.substr(i, 2); g.set(k, (g.get(k) || 0) + 1); } return g; }
/** Dice similarity of two normalized keys, 0..1 */
function similarity(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const A = grams(a), B = grams(b); let m = 0;
  for (const [k, v] of A) { const w = B.get(k); if (w) m += Math.min(v, w); }
  return (2 * m) / (a.length - 1 + b.length - 1);
}
/** Pakistani mobile -> "03XX-XXXXXXX", or "" if not valid. */
function normMobile(v) {
  let s = String(v ?? "").replace(/\D/g, "");
  if (s.startsWith("92") && s.length === 12) s = "0" + s.slice(2);
  if (s.length === 10 && s[0] === "3") s = "0" + s;
  return /^03\d{9}$/.test(s) ? s.slice(0, 4) + "-" + s.slice(4) : "";
}
function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 23 && lat <= 37.5 && lng >= 60 && lng <= 78;
}
function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return ["1", "y", "yes", "true", "x", "✓", "haan", "han", "available"].includes(s);
}
function clean(s, max = 300) { return String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function titleCase(s) { return String(s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim(); }

module.exports = { nameKey, similarity, normMobile, validLatLng, toBool, clean, esc, titleCase };
