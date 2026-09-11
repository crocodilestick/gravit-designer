const express = require("express");
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { setupWebSocket } = require("./routes/ws");
const userRoutes = require("./routes/user");
const fileRoutes = require("./routes/files");

const app = express();
const port = process.env.PORT || 3100;

// Request logger (first, so every request is logged regardless of which
// handler ends up serving it — most routes end the response without
// calling next(), so a logger placed later would never see them)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Body parsing
app.use(express.json());

// /.well-known (RFC 8615). Mounted separately because express.static
// refuses to serve paths containing a dot-prefixed segment; with the
// prefix stripped the remaining path is an ordinary filename. The service
// worker precaches .well-known/assetlinks.json, and a single 404 fails
// the whole precache install, so this has to actually resolve.
app.use(
  "/.well-known",
  express.static(path.join(__dirname, "public", ".well-known")),
);

// The files we patch keep the same filename forever, so anything holding
// a copy -- the browser's HTTP cache, or a CDN in front of this server --
// has no way to find out a new one exists. Stamping a content hash onto
// the script URLs in index.html gives each build its own URL, which is
// the only thing a cache reliably respects. index.html itself is served
// no-cache, so the new URLs are picked up immediately.
//
// Only files this project actually modifies are stamped; chunk.vendor.js
// and jquery.js ship untouched and are left alone.
const VERSIONED_SCRIPTS = ["designer.browser.dev.js", "save-to-server.js"];

function contentHash(name) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, "public", name));
    return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);
  } catch {
    return null; // absent in some builds; leave its URL untouched
  }
}

function renderIndex() {
  const file = path.join(__dirname, "public", "index.html");
  let html = fs.readFileSync(file, "utf8");
  for (const name of VERSIONED_SCRIPTS) {
    const hash = contentHash(name);
    if (!hash) continue;
    html = html.split(`src="${name}"`).join(`src="${name}?v=${hash}"`);
  }
  return html;
}

// Rendered once at startup: the container is replaced on every deploy, so
// a restart is exactly when the hashes can change.
const INDEX_HTML = renderIndex();

function sendIndex(_req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.send(INDEX_HTML);
}

// Ahead of express.static, which would otherwise serve the unstamped file.
app.get("/", sendIndex);
app.get("/index.html", sendIndex);

// Static files - public dir (main app)
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
      const name = path.basename(filePath);
      // Nothing here has a content-addressed filename, so nothing here
      // can be cached without a revalidation: a deploy changes what a
      // fixed name points at, and the browser has no way to notice. The
      // bundles were served "immutable" for a month, which is a promise
      // this app cannot keep -- a patched designer.browser.dev.js sat
      // unseen behind it, past reloads that would not even revalidate.
      //
      // This is not a re-download on every load. express.static answers
      // an unchanged file with a bodiless 304; only the round trip is
      // spent, on a handful of files.
      if (
        name === "chunk.vendor.js" ||
        name === "designer.browser.js" ||
        name === "designer.browser.dev.js" ||
        name === "index.html" ||
        name === "cacher.js" ||
        name === "save-to-server.js"
      ) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// Static files - docs
app.use("/docs", express.static(path.join(__dirname, "docs")));

// API routes
app.get("/connection/test", (_req, res) => res.send("OK"));
app.use(userRoutes);

// Maintenance status
app.get("/maintenance/status", (_req, res) => {
  res.json({ maintenance: false });
});

// i18n URL
app.get("/i18n-url/:locale/designer", (_req, res) => {
  res.json({});
});

// License check (GET) — returns data consumed directly by the License constructor
app.get("/license", (_req, res) => {
  res.json({
    license: "pro",
    expire: "2099-12-31T23:59:59.000Z",
    created: "2021-09-22T19:58:35.018Z",
    legacy: false,
  });
});

// Subscription test
app.get("/subscription/test", (_req, res) => {
  res.json({ active: true, plan: "pro", status: 1 });
});

// Subscription endpoints
app.get("/subscription/nextbillingdate", (_req, res) => {
  res.json({ date: "2099-12-31T23:59:59.000Z" });
});
app.get("/subscription/lifetime", (_req, res) => {
  res.json({ lifetime: true });
});

// Quota
app.get("/quota", (_req, res) => {
  res.json({ quota: { pro: {}, free: {} } });
});

// Subscription history
app.get("/ever-subscribed", (_req, res) => {
  res.json({ subscribed: true });
});
app.get("/total-subscription-days", (_req, res) => {
  res.json({ days: 9999 });
});

// Pro paywall (return empty page so client doesn't 404)
app.get("/pro/paywall/:page", (_req, res) => {
  res.send("");
});

// File storage (list/create/read/update/delete projects, backed by PROJECTS_DIR)
app.use(fileRoutes);

// Catch /null requests (client bug sends null URL)
app.get("/null", (_req, res) => {
  res.json({});
});

// HTTP + WebSocket server
const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
