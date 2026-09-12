const express = require("express");
const router = express.Router();
const fileStore = require("../lib/fileStore");

const jsonBody = express.json();
// Design/thumbnail bytes arrive as an arbitrary-content-type PUT body (the
// client sets Content-Type to the design mime type, e.g.
// "application/gravit+design"), not JSON — must be parsed as raw binary,
// and only on these two upload routes so express.json() elsewhere is unaffected.
const rawBody = express.raw({ type: "*/*", limit: "512mb" });

// Folders are opt-in. The app's own bundle calls listFiles in several
// places expecting documents, so the default response is unchanged and
// only our file browser asks for the hierarchy.
router.get("/file", (req, res) => {
  const includeFolders =
    req.query.includeFolders === "1" || req.query.includeFolders === "true";
  res.json(fileStore.list({ includeFolders }));
});

router.post("/file", jsonBody, (req, res, next) => {
  try {
    res.json(fileStore.create(req.body));
  } catch (err) {
    next(err);
  }
});

// What a delete would remove, so the confirmation can name the cost
// before a folder takes its subtree with it.
router.get("/file/:id/removal", (req, res) => {
  const info = fileStore.describeRemoval(req.params.id);
  if (!info) return res.status(404).json({ error: "not found" });
  res.json(info);
});

router.get(["/file/:id", "/file/:id/full"], (req, res) => {
  const file = fileStore.get(req.params.id);
  if (!file) return res.status(404).json({ error: "not found" });
  res.json(file);
});

router.put("/file/:id", jsonBody, (req, res, next) => {
  try {
    const file = fileStore.update(req.params.id, req.body);
    if (!file) return res.status(404).json({ error: "not found" });
    res.json(file);
  } catch (err) {
    next(err);
  }
});

// Still 204, as before: gApi.deleteFile in the app's own bundle goes
// through a shared request helper whose empty-body handling is not worth
// guessing at. Callers that want to know what a folder delete will take
// ask GET /file/:id/removal first, which our browser does anyway to word
// its confirmation.
router.delete("/file/:id", (req, res) => {
  if (!fileStore.remove(req.params.id))
    return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// COPY is what the tab context menu's Duplicate uses for a server-backed
// document (gApi.copyFile -> COPY /file/:id, then it opens the returned
// id). It's a real HTTP method, so Express routes it directly.
router.copy("/file/:id", jsonBody, (req, res) => {
  const file = fileStore.copy(req.params.id, req.body);
  if (!file) return res.status(404).json({ error: "not found" });
  res.json(file);
});

// Stand-in for the original product's S3 "signed put URL" — since we own
// the whole server, this just hands back one of our own upload endpoints.
router.put("/file/:id/urls", jsonBody, (req, res) => {
  const target = req.body && req.body.type_t ? "thumbnail" : "content";
  res.json({ url: `/file/${req.params.id}/${target}` });
});

router.put("/file/:id/content", rawBody, (req, res) => {
  const file = fileStore.writeContent(
    req.params.id,
    req.body,
    req.headers["content-type"],
  );
  if (!file) return res.status(404).json({ error: "not found" });
  res.json(file);
});

router.get("/file/:id/content", (req, res) => {
  const content = fileStore.readContent(req.params.id);
  if (!content) return res.status(404).end();
  res.setHeader("Content-Type", content.mimeType);
  res.send(content.buffer);
});

router.put("/file/:id/thumbnail", rawBody, (req, res) => {
  const file = fileStore.writeThumbnail(
    req.params.id,
    req.body,
    req.headers["content-type"],
  );
  if (!file) return res.status(404).json({ error: "not found" });
  res.json(file);
});

router.get("/file/:id/thumbnail", (req, res) => {
  const thumb = fileStore.readThumbnail(req.params.id);
  if (!thumb) return res.status(404).end();
  res.setHeader("Content-Type", thumb.mimeType);
  res.send(thumb.buffer);
});

// Turns the store's caller-mistake errors into 400s instead of letting
// Express answer 500 with a stack.
router.use((err, _req, res, next) => {
  if (err && err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
