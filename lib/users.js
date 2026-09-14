const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECTS_DIR = path.resolve(
  process.env.PROJECTS_DIR || path.join(__dirname, "..", "projects"),
);
const USERS_FILE = path.join(PROJECTS_DIR, "users.json");

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// scrypt from Node's own crypto, so there is no native module to build
// into the image. These are the defaults OWASP suggests for scrypt.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// Everything here that is not identity is what keeps the client happy:
// the Pro license fields, the trial dates, the capability flags. Each
// account gets its own copy with its own id, email and name.
const PROFILE_TEMPLATE = {
  email_verified: true,
  email_expire: null,
  login: null,
  avatar: null,
  admin: null,
  flash: null,
  app: "designer",
  stats: {},
  address: "",
  city: "",
  zip: "",
  state: "",
  country: "",
  trial_created: "2021-09-22T19:58:35.018Z",
  trial_expire: "2099-10-07T19:58:35.018Z",
  pro_created: "2021-09-22T19:58:35.018Z",
  pro_expire: "2099-12-31T23:59:59.000Z",
  last_name: "",
  runtime: "Browser",
  user_type: "normal",
  deactivated: false,
  legacy: false,
  guest_created: null,
  guest_expire: null,
  version: "3.15.0",
};

function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeAll(users) {
  // 0600: the file holds password hashes, and PROJECTS_DIR is a bind
  // mount someone may well browse.
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

function hashPassword(password, salt) {
  return crypto
    .scryptSync(password, salt, SCRYPT.keylen, {
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
    })
    .toString("hex");
}

function normaliseEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function count() {
  return readAll().length;
}

function findByEmail(email) {
  const wanted = normaliseEmail(email);
  return readAll().find((u) => normaliseEmail(u.email) === wanted) || null;
}

function findById(id) {
  return readAll().find((u) => u.id === id) || null;
}

// Returns { user } or { error } -- never throws for a caller mistake, so
// routes can turn the reason into a message the login dialog will show.
function create({ email, name, password, admin }) {
  const cleanEmail = normaliseEmail(email);
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { error: "Enter a valid email address." };
  }
  if (!password || String(password).length < 6) {
    return { error: "A minimum of 6 characters is required for password." };
  }
  if (findByEmail(cleanEmail)) {
    return { error: "An account with that email address already exists." };
  }
  const users = readAll();
  const salt = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    name: String(name || cleanEmail.split("@")[0]).trim(),
    salt,
    passwordHash: hashPassword(password, salt),
    // The first account to exist runs the place -- otherwise a fresh
    // install with SIGNUP_MODE=admin could never create anybody.
    admin: admin === undefined ? users.length === 0 : !!admin,
    created: now,
    locale: "en",
  };
  users.push(user);
  writeAll(users);
  return { user };
}

function verifyPassword(email, password) {
  const user = findByEmail(email);
  if (!user) return null;
  const attempt = hashPassword(String(password || ""), user.salt);
  const a = Buffer.from(attempt, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  // Constant-time, and length-checked first since timingSafeEqual throws
  // on a length mismatch.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return user;
}

function update(id, patch) {
  const users = readAll();
  const i = users.findIndex((u) => u.id === id);
  if (i === -1) return null;
  const { id: _ignoredId, passwordHash, salt, ...safe } = patch || {};
  users[i] = { ...users[i], ...safe, id: users[i].id };
  writeAll(users);
  return users[i];
}

function setPassword(id, password) {
  if (!password || String(password).length < 6) {
    return { error: "A minimum of 6 characters is required for password." };
  }
  const users = readAll();
  const i = users.findIndex((u) => u.id === id);
  if (i === -1) return { error: "No such account." };
  const salt = crypto.randomBytes(16).toString("hex");
  users[i] = { ...users[i], salt, passwordHash: hashPassword(password, salt) };
  writeAll(users);
  return { user: users[i] };
}

// The shape the client expects from GET /user. Password material never
// appears here.
function toProfile(user, extra) {
  if (!user) return null;
  const now = new Date().toISOString();
  return {
    ...PROFILE_TEMPLATE,
    ...(extra || {}),
    id: user.id,
    email: user.email,
    name: user.name,
    admin: user.admin ? true : null,
    created: user.created,
    last_seen: now,
    last_update: now,
    locale: user.locale || "en",
  };
}

module.exports = {
  USERS_FILE,
  PROFILE_TEMPLATE,
  count,
  create,
  findByEmail,
  findById,
  verifyPassword,
  update,
  setPassword,
  toProfile,
};
