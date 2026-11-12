"use strict";
// Usage: npm run create-admin -- <username> <password>   (needs DATABASE_URL in .env or environment)
const path = require("path"), fs = require("fs");
try { fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch (_) {}
const { init, pool } = require("../src/db");
const { createAdmin } = require("../src/auth");
const [u, p] = process.argv.slice(2);
if (!u || !p) { console.log("Usage: npm run create-admin -- <username> <password (10+ characters)>"); process.exit(1); }
init().then(() => createAdmin(u, p)).then(() => { console.log(`Admin "${u}" is ready. Sign in at /admin`); return pool.end(); }).catch(e => { console.error(e.message); process.exit(1); });
