const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROJECTS_DIR = path.resolve(
  process.env.PROJECTS_DIR || path.join(__dirname, "..", "projects"),
);

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const DEFAULT_MIME = "application/gravit+design";
const DEFAULT_EXT = "gvdesign";

// A folder is an ordinary metadata record with no content or thumbnail
// file beside it. Keeping them in the same flat directory means none of
// the path helpers below have to care, and the save/open path is
// untouched -- the hierarchy lives entirely in each record's `parent`.
const FOLDER_MIME = "application/vnd.gravit.folder";

function isFolder(meta) {
  return !!meta && meta.folder === true;
}

// Thrown for a caller's mistake (a missing parent, a cycle) so routes can
// answer 400 rather than a blanket 500.
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function metaPath(id) {
  return path.join(PROJECTS_DIR, `${id}.meta.json`);
}
function contentPath(id) {
  return path.join(PROJECTS_DIR, `${id}.gvdesign`);
}
function thumbnailPath(id) {
  return path.join(PROJECTS_DIR, `${id}.thumb.png`);
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeMeta(meta) {
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
  return meta;
}

function withUrls(meta) {
  if (isFolder(meta)) return { ...meta };
  const out = { ...meta, url: `/file/${meta.id}/content` };
  if (meta.hasThumbnail) out.thumbnailLink = `/file/${meta.id}/thumbnail`;
  return out;
}

function readAllMetas() {
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((name) => name.endsWith(".meta.json"))
    .map((name) => name.slice(0, -".meta.json".length))
    .map(readMeta)
    .filter(Boolean);
}

// Records whose parent no longer exists are shown at the root rather than
// disappearing. PROJECTS_DIR is a bind mount people are meant to poke
// around in, so a folder's metadata file can be deleted by hand and leave
// its children pointing at nothing.
function reparentOrphans(metas) {
  const folders = new Set(metas.filter(isFolder).map((m) => m.id));
  return metas.map((m) =>
    m.parent && !folders.has(m.parent) ? { ...m, parent: null } : m,
  );
}

// Folders are omitted unless asked for. The app's own bundle calls
// listFiles in several places, and those callers expect documents; only
// our own browser opts in to seeing the hierarchy.
function list({ includeFolders = false } = {}) {
  const metas = reparentOrphans(readAllMetas());
  return (includeFolders ? metas : metas.filter((m) => !isFolder(m))).map(
    withUrls,
  );
}

// Every id from `folderId` downwards, excluding itself.
function descendantsOf(folderId, metas) {
  const byParent = new Map();
  for (const m of metas) {
    if (!byParent.has(m.parent)) byParent.set(m.parent, []);
    byParent.get(m.parent).push(m);
  }
  const out = [];
  const queue = [folderId];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) || []) {
      out.push(child);
      if (isFolder(child)) queue.push(child.id);
    }
  }
  return out;
}

// A parent must exist and be a folder; moving a folder inside itself or
// one of its own descendants would strand that whole subtree.
function assertValidParent(id, parent, metas) {
  if (parent === null || parent === undefined) return;
  const target = metas.find((m) => m.id === parent);
  if (!target) throw badRequest(`parent ${parent} does not exist`);
  if (!isFolder(target)) throw badRequest(`parent ${parent} is not a folder`);
  if (parent === id) throw badRequest("a folder cannot contain itself");
  const self = metas.find((m) => m.id === id);
  if (isFolder(self) && descendantsOf(id, metas).some((m) => m.id === parent)) {
    throw badRequest("a folder cannot be moved inside its own subtree");
  }
}

function create({ name, parent, type, app, folder } = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const asFolder = folder === true || type === FOLDER_MIME;
  if (parent) assertValidParent(id, parent, readAllMetas());
  const meta = {
    id,
    name: name || (asFolder ? "New Folder" : "Untitled"),
    app: app || "designer",
    folder: asFolder,
    mimeType: asFolder ? FOLDER_MIME : type || DEFAULT_MIME,
    type: asFolder ? FOLDER_MIME : type || DEFAULT_MIME,
    fileExtension: asFolder ? null : DEFAULT_EXT,
    parent: parent || null,
    trashed: false,
    createdTime: now,
    modifiedTime: now,
    created: now,
    updated: now,
    version: 1,
    size: 0,
    sha256: null,
    hasThumbnail: false,
    thumbnailLink: null,
    capabilities: { canDownload: true, canEdit: true },
    width: 0,
    height: 0,
    unit: null,
  };
  writeMeta(meta);
  return withUrls(meta);
}

function get(id) {
  const meta = readMeta(id);
  return meta ? withUrls(meta) : null;
}

function update(id, patch) {
  const meta = readMeta(id);
  if (!meta) return null;
  // A move arrives as an ordinary field update, so the hierarchy has to be
  // checked here rather than in a separate endpoint.
  if (patch && Object.prototype.hasOwnProperty.call(patch, "parent")) {
    assertValidParent(id, patch.parent || null, readAllMetas());
  }
  const now = new Date().toISOString();
  const next = {
    ...meta,
    ...patch,
    id: meta.id,
    folder: meta.folder === true,
    modifiedTime: now,
    updated: now,
  };
  writeMeta(next);
  return withUrls(next);
}

function removeOne(id) {
  for (const p of [metaPath(id), contentPath(id), thumbnailPath(id)]) {
    fs.rmSync(p, { force: true });
  }
}

// Deleting a folder takes its whole subtree with it; anything else would
// leave records stranded under a parent that no longer exists. Returns
// the number of records removed so callers can say what happened.
function remove(id) {
  const meta = readMeta(id);
  if (!meta) return false;
  const ids = isFolder(meta)
    ? [id, ...descendantsOf(id, reparentOrphans(readAllMetas())).map((m) => m.id)]
    : [id];
  ids.forEach(removeOne);
  return { removed: ids.length };
}

// What a delete would take with it, so the confirmation can be specific
// instead of asking about "this folder" and quietly binning twelve files.
function describeRemoval(id) {
  const meta = readMeta(id);
  if (!meta) return null;
  if (!isFolder(meta)) return { name: meta.name, folder: false, files: 0, folders: 0 };
  const kids = descendantsOf(id, reparentOrphans(readAllMetas()));
  return {
    name: meta.name,
    folder: true,
    files: kids.filter((m) => !isFolder(m)).length,
    folders: kids.filter(isFolder).length,
  };
}

function writeContent(id, buffer, mimeType) {
  const meta = readMeta(id);
  if (!meta) return null;
  fs.writeFileSync(contentPath(id), buffer);
  const now = new Date().toISOString();
  const next = {
    ...meta,
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    version: (meta.version || 1) + 1,
    mimeType: mimeType || meta.mimeType,
    modifiedTime: now,
    updated: now,
  };
  writeMeta(next);
  return withUrls(next);
}

function readContent(id) {
  const meta = readMeta(id);
  if (!meta || !fs.existsSync(contentPath(id))) return null;
  return {
    buffer: fs.readFileSync(contentPath(id)),
    mimeType: meta.mimeType || DEFAULT_MIME,
  };
}

function writeThumbnail(id, buffer, mimeType) {
  const meta = readMeta(id);
  if (!meta) return null;
  fs.writeFileSync(thumbnailPath(id), buffer);
  const next = {
    ...meta,
    hasThumbnail: true,
    thumbnailMimeType: mimeType || "image/png",
  };
  writeMeta(next);
  return withUrls(next);
}

function readThumbnail(id) {
  const meta = readMeta(id);
  if (!meta || !meta.hasThumbnail || !fs.existsSync(thumbnailPath(id)))
    return null;
  return {
    buffer: fs.readFileSync(thumbnailPath(id)),
    mimeType: meta.thumbnailMimeType || "image/png",
  };
}

// Mirrors how the client names a duplicate made locally: a trailing
// "(n)" is incremented, otherwise "(1)" is appended.
function duplicateName(name) {
  const match = /^(.*)\((\d+)\)$/.exec(name);
  if (match) return `${match[1]}(${parseInt(match[2], 10) + 1})`;
  return `${name}(1)`;
}

// Server-side copy, used by the tab context menu's Duplicate: the client
// sends COPY /file/:id and opens whatever id comes back.
function copy(id, options) {
  const meta = readMeta(id);
  if (!meta) return null;
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const next = {
    ...meta,
    id: newId,
    name: duplicateName(meta.name || "Untitled"),
    parent:
      options && Object.prototype.hasOwnProperty.call(options, "parent")
        ? options.parent || null
        : meta.parent,
    createdTime: now,
    modifiedTime: now,
    created: now,
    updated: now,
    version: 1,
    hasThumbnail: false,
    thumbnailLink: null,
  };
  // size/sha256 carry over from the source, since the bytes are identical.
  if (fs.existsSync(contentPath(id))) {
    fs.copyFileSync(contentPath(id), contentPath(newId));
  }
  if (meta.hasThumbnail && fs.existsSync(thumbnailPath(id))) {
    fs.copyFileSync(thumbnailPath(id), thumbnailPath(newId));
    next.hasThumbnail = true;
  }
  writeMeta(next);
  return withUrls(next);
}

module.exports = {
  PROJECTS_DIR,
  FOLDER_MIME,
  isFolder,
  describeRemoval,
  list,
  create,
  get,
  update,
  remove,
  copy,
  writeContent,
  readContent,
  writeThumbnail,
  readThumbnail,
};
