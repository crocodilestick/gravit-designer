const { Router } = require("express");
const users = require("../lib/users");
const router = Router();

const LANGUAGES = {
  0: "de-DE",
  1: "en",
  2: "zh-CN",
  3: "pt-BR",
  4: "es-ES",
  5: "fr-FR",
  6: "pl-PL",
  7: "ru-RU",
  8: "tr-TR",
  9: "cs-CZ",
  10: "zh-TW",
  11: "it-IT",
  12: "ja-JP",
  13: "nl-NL",
  14: "sv-SE",
};

const LOCALE_TO_CODE = Object.fromEntries(
  Object.entries(LANGUAGES).map(([k, v]) => [v.toLowerCase(), Number(k)]),
);

function resolveLocale(langOrLocale) {
  if (langOrLocale in LANGUAGES) return LANGUAGES[langOrLocale];
  if (
    typeof langOrLocale === "string" &&
    LOCALE_TO_CODE[langOrLocale.toLowerCase()] !== undefined
  ) {
    return langOrLocale;
  }
  return "en";
}


const SETTINGS = {
  notifications_disabled: false,
  trialDays: 15,
  quotas: { free: null, pro: null },
  subscription: {
    annual: { productId: null, coupon: "Trial20" },
    extraParameters: { "x-at": null, "x-clickref": null },
  },
  license: { offlineExpirationTime: 1296000000, offlineCountdown: 604800000 },
  reminders: {
    offlineWarning: 86400000,
    proOfferInFree: 1296000000,
    proOfferInTrial: 432000000,
    proOfferInTrialExpired: 1296000000,
    proOfferInTrialExpireSoon: 86400000,
    proOfferInTrialLastWarning: 0,
    proOfferSpecialPrice: 0,
    proExpireSoon: 2592000000,
  },
  flags: {
    welcomeMessage: false,
    windowsStoreAnnouncement: false,
    proOfferSpecialPrice: false,
    proOfferInTrialExpireSoon: false,
    proOfferInTrialLastWarning: false,
  },
};

function unauthorized(res) {
  // The client treats this as "nobody is signed in" and offers the login
  // dialog. It parses the body as JSON, so it has to be JSON.
  return res.status(401).json({ message: "Not signed in." });
}

router.get("/user/settings", (req, res) => {
  if (!req.user) return unauthorized(res);
  res.json({ ...SETTINGS, ...(req.user.settings || {}) });
});

router.put("/user/settings", (req, res) => {
  if (!req.user) return unauthorized(res);
  const next = { ...(req.user.settings || {}), ...(req.body || {}) };
  users.update(req.user.id, { settings: next });
  res.json({ ...SETTINGS, ...next });
});

// Until this returned 401 the app believed everyone was the same signed-in
// person, which is why it never asked anybody to log in.
router.get("/user", (req, res) => {
  if (!req.user) return unauthorized(res);
  const locale = resolveLocale(req.query.lang || req.user.locale);
  res.json({ ...users.toProfile(req.user), locale, settings: SETTINGS });
});

router.put("/user", (req, res) => {
  if (!req.user) return unauthorized(res);
  const locale = resolveLocale(req.body?.locale);
  const patch = { locale };
  if (req.body && typeof req.body.name === "string") patch.name = req.body.name;
  const updated = users.update(req.user.id, patch) || req.user;
  res.json({
    id: updated.id,
    name: updated.name,
    locale,
    email: updated.email,
    version: users.PROFILE_TEMPLATE.version,
    runtime: users.PROFILE_TEMPLATE.runtime,
    settings: { notifications_disabled: false },
  });
});

module.exports = router;
