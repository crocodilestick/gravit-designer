const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECTS_DIR = path.resolve(
  process.env.PROJECTS_DIR || path.join(__dirname, "..", "projects"),
);
const SECRET_FILE = path.join(PROJECTS_DIR, ".session-secret");

const COOKIE_NAME = "gd_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Sessions are signed rather than stored: the cookie carries the user id
// and an expiry, and an HMAC proves this server issued it. Nothing to
// persist, nothing to expire, and a restart does not log everyone out --
// as long as the secret is stable, which is what the file below is for.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const existing = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, generated + "\n", { mode: 0o600 });
  console.log(
    `[auth] generated a session secret at ${SECRET_FILE}\n` +
      "[auth] set SESSION_SECRET in the environment to manage it yourself",
  );
  return generated;
}

const SECRET = loadSecret();

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function issue(userId) {
  const payload = `${userId}.${Date.now() + MAX_AGE_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the user id, or null for anything malformed, expired or not
// signed by us.
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const cut = token.lastIndexOf(".");
  if (cut <= 0) return null;
  const payload = token.slice(0, cut);
  const provided = token.slice(cut + 1);
  const expected = sign(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [userId, expiry] = payload.split(".");
  if (!userId || !expiry) return null;
  if (Number(expiry) < Date.now()) return null;
  return userId;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

// The client sends cookies on every request (credentials: "include") and
// only falls back to the Authorization header when navigator.cookieEnabled
// is false -- so accept either, and hand the token back both ways on
// sign-in. Nothing here trusts a header from a proxy; the HMAC is what
// makes a token acceptable, wherever it arrived.
function tokenFrom(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const auth = req.headers.authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
}

function cookieOptions(req) {
  // Secure only when the request actually arrived over TLS, so the same
  // build works on https://gravit.example.com and on a plain LAN address.
  const forwarded = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const secure = forwarded === "https" || req.protocol === "https";
  return [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
    secure ? "Secure" : null,
  ].filter(Boolean);
}

function attach(res, req, token) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(req).join("; ")}`,
  );
  // The cookies-disabled fallback reads the token from this header.
  res.setHeader("Authorization", token);
}

function clear(res, req) {
  const opts = cookieOptions(req).filter((o) => !o.startsWith("Max-Age"));
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; ${opts.join("; ")}; Max-Age=0`);
}

module.exports = { COOKIE_NAME, issue, verify, tokenFrom, attach, clear };
