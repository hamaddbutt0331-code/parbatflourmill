"use strict";
/**
 * PostgreSQL storage (works with the free Neon database, or any Postgres).
 * Set DATABASE_URL, e.g. postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Create a free database at neon.tech and put its connection string in DATABASE_URL.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL);
// node-postgres does not use libpq's channel_binding option; drop it so Neon's copied string works as-is.
const DB_URL = process.env.DATABASE_URL.trim().replace(/([?&])channel_binding=[^&]*(&|$)/, (m, a, b) => (b ? a : "")).replace(/[?&]$/, "");
const pool = new Pool({
  connectionString: DB_URL,
  ssl: local || /sslmode=disable/.test(DB_URL) ? false : { rejectUnauthorized: false },
  max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000,
});
pool.on("error", e => console.error("Database connection error:", e.message));

/** rows of a query */
async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
/** first row or undefined */
async function one(sql, params = []) { return (await pool.query(sql, params)).rows[0]; }
/** run; returns rowCount */
async function run(sql, params = []) { return (await pool.query(sql, params)).rowCount; }
/** transaction helper: fn receives a client with the same q/one/run helpers */
async function tx(fn) {
  const c = await pool.connect();
  const h = { q: async (s, p = []) => (await c.query(s, p)).rows, one: async (s, p = []) => (await c.query(s, p)).rows[0], run: async (s, p = []) => (await c.query(s, p)).rowCount };
  try { await c.query("BEGIN"); const r = await fn(h); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS salesmen (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#1E7B3C',
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS salesmen_name ON salesmen (lower(name));
CREATE TABLE IF NOT EXISTS towns ( id SERIAL PRIMARY KEY, name TEXT NOT NULL );
CREATE UNIQUE INDEX IF NOT EXISTS towns_name ON towns (lower(name));
CREATE TABLE IF NOT EXISTS dealers (
  id SERIAL PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  show_mobile INTEGER NOT NULL DEFAULT 1,
  address TEXT NOT NULL DEFAULT '',
  town TEXT NOT NULL DEFAULT 'Multan',
  area TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  salesman_id INTEGER REFERENCES salesmen(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  gps_verified INTEGER NOT NULL DEFAULT 0,
  gps_source TEXT NOT NULL DEFAULT '',
  has_atta INTEGER NOT NULL DEFAULT 0,
  has_maida INTEGER NOT NULL DEFAULT 0,
  has_choker INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dealers_code ON dealers (code) WHERE code IS NOT NULL AND code <> '';
CREATE INDEX IF NOT EXISTS dealers_key ON dealers (name_key);
CREATE INDEX IF NOT EXISTS dealers_pub ON dealers (published);
CREATE TABLE IF NOT EXISTS admins ( id SERIAL PRIMARY KEY, username TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now() );
CREATE UNIQUE INDEX IF NOT EXISTS admins_user ON admins (lower(username));
CREATE TABLE IF NOT EXISTS sessions ( token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL );
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS dealer_photos (
  dealer_id INTEGER PRIMARY KEY REFERENCES dealers(id) ON DELETE CASCADE,
  image BYTEA NOT NULL,            -- JPEG, longest side about 1000px
  thumb BYTEA NOT NULL,            -- JPEG, about 200px
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), admin TEXT NOT NULL, action TEXT NOT NULL,
  dealer_id INTEGER, details TEXT NOT NULL DEFAULT ''
);`;

const DEFAULT_SETTINGS = {
  site_name: "Parbat Flour Mills – Find a Dealer",
  company_address: "Plot #64, Phase 2, Industrial Estate, Multan, Pakistan",
  company_phone: "",
  company_whatsapp: "",
  company_email: "",
  office_hours: "Monday – Saturday, 9:00 AM – 6:00 PM",
  map_center_lat: "30.1984",
  map_center_lng: "71.4687",
  map_zoom: "12",
};
const DEFAULT_SALESMEN = [["Zahid Amjad", "#2563EB"], ["Zahid Shah", "#16A34A"], ["Nadeem Ahmed", "#C026D3"], ["Rana Waheed", "#EA580C"]];

/** Create tables, defaults and (first start only) the initial dealers. */
async function init() {
  await pool.query(SCHEMA);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) await run("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING", [k, v]);
  const n = (await one("SELECT COUNT(*)::int n FROM salesmen")).n;
  if (!n) for (const [i, [name, color]] of DEFAULT_SALESMEN.entries()) await run("INSERT INTO salesmen(name,color,sort) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [name, color, i]);
  await run("INSERT INTO towns(name) VALUES('Multan') ON CONFLICT DO NOTHING");
  const dealers = (await one("SELECT COUNT(*)::int n FROM dealers")).n;
  if (!dealers) await seedDealers();
}
async function seedDealers() {
  const { nameKey } = require("./util");
  const file = path.join(__dirname, "..", "data", "seed-dealers.json");
  if (!fs.existsSync(file)) return;
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const sm = Object.fromEntries((await q("SELECT id,name FROM salesmen")).map(s => [s.name.toLowerCase(), s.id]));
  await tx(async t => {
    for (const r of rows) {
      await t.run(`INSERT INTO dealers(code,name,name_key,mobile,address,town,area,street,salesman_id,lat,lng,gps_verified,gps_source,has_atta,has_maida,has_choker,published)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
        [r.code || null, r.name, nameKey(r.name), r.mobile || "", r.address || "", r.town || "Multan", r.area || "", r.street || "", sm[(r.salesman || "").toLowerCase()] || null,
          r.lat, r.lng, r.gps_verified ? 1 : 0, r.gps_source || "", r.has_atta ? 1 : 0, r.has_maida ? 1 : 0, r.has_choker ? 1 : 0, r.published ? 1 : 0]);
    }
    await t.run("INSERT INTO audit(admin,action,details) VALUES('system','Initial data load',$1)", [`${rows.length} dealers from seed-dealers.json`]);
  });
  console.log(`Loaded ${rows.length} dealers into the database (first start).`);
}
async function getSettings() {
  const o = {};
  for (const r of await q("SELECT key,value FROM settings")) o[r.key] = r.value;
  return o;
}

module.exports = { pool, q, one, run, tx, init, getSettings, DEFAULT_SETTINGS };
