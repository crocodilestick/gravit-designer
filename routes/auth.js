const { Router } = require("express");
const express = require("express");
const users = require("../lib/users");
const session = require("../lib/session");

const router = Router();
const jsonBody = express.json();

// SIGNUP_MODE decides who may create accounts:
//   open   anyone who can reach the server (the default)
//   admin  only a signed-in administrator
//
// A typo must not quietly open registration, so an unrecognised value is
// a startup error rather than a fallback.
const SIGNUP_MODE = (process.env.SIGNUP_MODE || "open").trim().toLowerCase();
if (!["open", "admin"].includes(SIGNUP_MODE)) {
  throw new Error(
    `SIGNUP_MODE must be "open" or "admin" (got "${process.env.SIGNUP_MODE}")`,
  );
}

// Every error body carries `message`: the login dialog reads e.message and
// otherwise falls through to e.errors.toString(), which throws when there
// is no errors field, leaving the user staring at a form that did nothing.
function fail(res, status, message) {
  return res.status(status).json({ message, errors: [["error", message]] });
}

// Populates req.user for every request. Never rejects -- routes decide
// whether being signed out matters.
function withUser(req, _res, next) {
  const id = session.verify(session.tokenFrom(req));
  req.user = id ? users.findById(id) : null;
  next();
}

function signedIn(res, req, user) {
  const token = session.issue(user.id);
  session.attach(res, req, token);
  return res.json(users.toProfile(user));
}

router.post("/signin", jsonBody, (req, res) => {
  const { email, password } = req.body || {};
  const user = users.verifyPassword(email, password);
  // One message for both "no such account" and "wrong password", so this
  // cannot be used to find out which addresses have accounts.
  if (!user) return fail(res, 401, "That email and password do not match.");
  return signedIn(res, req, user);
});

router.post("/signup", jsonBody, (req, res) => {
  const { email, name, password } = req.body || {};
  const first = users.count() === 0;

  // The very first account is always allowed, whatever the mode --
  // otherwise a fresh install with SIGNUP_MODE=admin has no way in. It
  // becomes the administrator.
  if (!first && SIGNUP_MODE === "admin" && !(req.user && req.user.admin)) {
    return fail(
      res,
      403,
      "New accounts on this server are created by an administrator.",
    );
  }

  const { user, error } = users.create({ email, name, password });
  if (error) return fail(res, 400, error);
  if (first) {
    console.log(`[auth] first account created (${user.email}) -- administrator`);
  }
  return signedIn(res, req, user);
});

router.get("/signout", (req, res) => {
  session.clear(res, req);
  res.json({ ok: true });
});

// The sign-up form asks for a key and skips the challenge when there
// isn't one. There is no reCAPTCHA here and no third party to ask.
router.get("/recaptchakey", (_req, res) => res.json({}));

// Password reset needs somewhere to send mail, which this server does not
// have. Say so plainly rather than appearing to send something.
router.post("/reset-password", jsonBody, (_req, res) =>
  fail(
    res,
    501,
    "Password reset isn't available on this server. Ask an administrator to set a new password for you.",
  ),
);

module.exports = { router, withUser, SIGNUP_MODE };
