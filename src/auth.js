"use strict";
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { q, one, run } = require("./db");

const COOKIE = "pfm_admin";
const SESSION_HOURS = 12;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");

async function createAdmin(username, password) {
  if (!username || !password || password.length < 10) throw new Error("Password must be at least 10 characters.");
  const hash = bcrypt.hashSync(password, 12);
  const ex = await one("SELECT id FROM admins WHERE lower(username)=lower($1)", [username]);
  if (ex) await run("UPDATE admins SET pass_hash=$1 WHERE id=$2", [hash, ex.id]);
  else await run("INSERT INTO admins(username,pass_hash) VALUES($1,$2)", [username, hash]);
}
async function ensureFirstAdmin() {
  const n = (await one("SELECT COUNT(*)::int n FROM admins")).n;
  if (n === 0 && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    await createAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
    console.log(`Admin account "${process.env.ADMIN_USER}" created from environment settings.`);
  } else if (n === 0) console.warn("No admin account yet. Set ADMIN_USER and ADMIN_PASSWORD and restart.");
  // Emergency reset: set ADMIN_RESET_PASSWORD=yes together with ADMIN_USER / ADMIN_PASSWORD, restart once, then remove it.
  if (n > 0 && process.env.ADMIN_RESET_PASSWORD === "yes" && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    await createAdmin(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
    console.log(`Password for "${process.env.ADMIN_USER}" was reset from environment settings. Remove ADMIN_RESET_PASSWORD now.`);
  }
}

const fails = new Map();
function tooMany(ip) { const now = Date.now(), list = (fails.get(ip) || []).filter(t => now - t < 15 * 60e3); fails.set(ip, list); return list.length >= 6; }
function noteFail(ip) { (fails.get(ip) || fails.set(ip, []).get(ip)).push(Date.now()); }

async function login(username, password, ip) {
  if (tooMany(ip)) return { error: "Too many attempts. Wait 15 minutes and try again." };
  const a = await one("SELECT * FROM admins WHERE lower(username)=lower($1)", [String(username || "")]);
  if (!a || !bcrypt.compareSync(String(password || ""), a.pass_hash)) { noteFail(ip); return { error: "Wrong username or password." }; }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  await run("DELETE FROM sessions WHERE expires_at < $1", [Date.now()]);
  await run("INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES($1,$2,$3)", [sha(token), a.id, Date.now() + SESSION_HOURS * 3600e3]);
  return { token, username: a.username };
}
function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
}
async function currentAdmin(req) {
  const t = readCookie(req, COOKIE); if (!t) return null;
  const s = await one("SELECT s.expires_at, a.id, a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1", [sha(t)]);
  if (!s || Number(s.expires_at) < Date.now()) return null;
  return { id: s.id, username: s.username, tokenHash: sha(t) };
}
function setCookie(res, token, maxAgeSec) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`);
}
async function logout(req) { const a = await currentAdmin(req); if (a) await run("DELETE FROM sessions WHERE token_hash=$1", [a.tokenHash]); }

function requirePage(req, res, next) { currentAdmin(req).then(a => { if (!a) return res.redirect("/admin/login"); req.admin = a; next(); }).catch(next); }
function requireApi(req, res, next) {
  currentAdmin(req).then(a => {
    if (!a) return res.status(401).json({ error: "Please sign in again." });
    if (req.method !== "GET" && req.get("X-Requested-With") !== "parbat-admin") return res.status(403).json({ error: "Blocked request." });
    req.admin = a; next();
  }).catch(next);
}
async function changePassword(adminId, oldPw, newPw) {
  const a = await one("SELECT * FROM admins WHERE id=$1", [adminId]);
  if (!a || !bcrypt.compareSync(String(oldPw || ""), a.pass_hash)) return "Current password is wrong.";
  if (!newPw || newPw.length < 10) return "New password must be at least 10 characters.";
  await run("UPDATE admins SET pass_hash=$1 WHERE id=$2", [bcrypt.hashSync(newPw, 12), adminId]);
  await run("DELETE FROM sessions WHERE admin_id=$1", [adminId]);
  return null;
}

module.exports = { createAdmin, ensureFirstAdmin, login, logout, currentAdmin, setCookie, requirePage, requireApi, changePassword, SESSION_HOURS };
