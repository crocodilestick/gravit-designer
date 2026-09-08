(function () {
  "use strict";

  // The client's built-in "Save to Cloud" action ('gravit-cloud.save-as')
  // is never registered by this bundle, so gDesigner.executeAction() throws
  // immediately instead of doing anything. This intercepts that one action
  // id and reimplements it against our own server-side storage
  // (routes/files.js), reusing the app's real document serialization by
  // handing doc.store() a small object that fulfils the same
  // getExtension()/write() contract every real storage backend implements.
  const INTERCEPTED_ACTIONS = new Set(["gravit-cloud.save-as", "gravit-cloud.save"]);

  function showToast(message, isError) {
    let el = document.getElementById("save-to-server-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "save-to-server-toast";
      el.style.cssText = [
        "position:fixed",
        "top:16px",
        "right:16px",
        "z-index:2147483647",
        "padding:10px 16px",
        "border-radius:6px",
        "font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "color:#fff",
        "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
        "transition:opacity 0.2s ease",
        "max-width:360px",
      ].join(";");
      document.body.appendChild(el);
    }
    el.style.background = isError ? "#c0392b" : "#27ae60";
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.style.opacity = "0";
    }, isError ? 6000 : 3000);
  }

  // Shared by both the fresh-save path (fake storage item, below) and the
  // patched real storage item's write() (further down): PUT the bytes to
  // our own simple content endpoint, then mark the file visible/current.
  function uploadBytesToServer(id, bytes) {
    return fetch(`/file/${id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/gravit+design" },
      body: bytes,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
        return fetch(`/file/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: false }),
        });
      })
      .then(() => {});
  }

  async function findOrCreateFile(name) {
    const list = await fetch("/file").then((r) => r.json());
    const existing = list.find((f) => f.name === name && !f.trashed);
    if (existing) return existing;
    return fetch("/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type: "application/gravit+design",
        app: "designer",
      }),
    }).then((r) => r.json());
  }

  function saveActiveDocumentToServer() {
    const doc =
      window.gDesigner && window.gDesigner.getActiveDocument
        ? window.gDesigner.getActiveDocument()
        : null;
    if (!doc) {
      showToast("Save to server: no active document", true);
      return;
    }
    patchDocumentPrototype(doc);
    const name = (doc.getTitle && doc.getTitle()) || "Untitled";

    return findOrCreateFile(name)
      .then(
        (meta) =>
          new Promise((resolve, reject) => {
            const fakeStorageItem = {
              __isFakeStorageItem: true,
              // Real storage-item classes return the uppercase extension
              // (K.prototype.store compares it against B.ext.toUpperCase()).
              getExtension: () => "GVDESIGN",
              getId: () => meta.id,
              getName: () => name,
              getFile: () => ({ id: meta.id }),
              write: (bytes, onSuccess, onFail) => {
                uploadBytesToServer(meta.id, bytes)
                  .then(() => onSuccess && onSuccess())
                  .catch((err) => onFail && onFail(err));
              },
            };
            try {
              doc.store(fakeStorageItem, resolve, reject, {});
            } catch (err) {
              reject(err);
            }
          }),
      )
      .then(() => {
        showToast(`Saved "${name}" to server`);
      })
      .catch((err) => {
        console.error("[save-to-server] failed", err);
        showToast(
          `Failed to save "${name}" to server: ${err && err.message ? err.message : err}`,
          true,
        );
      });
  }

  function installExecuteActionOverride() {
    if (
      !window.gDesigner ||
      typeof window.gDesigner.executeAction !== "function" ||
      window.gDesigner.__saveToServerInstalled
    ) {
      return !!(window.gDesigner && window.gDesigner.__saveToServerInstalled);
    }
    const originalExecuteAction = window.gDesigner.executeAction.bind(
      window.gDesigner,
    );
    window.gDesigner.executeAction = function (id) {
      if (INTERCEPTED_ACTIONS.has(id)) {
        return saveActiveDocumentToServer();
      }
      return originalExecuteAction.apply(this, arguments);
    };
    window.gDesigner.__saveToServerInstalled = true;
    console.log("[save-to-server] executeAction override installed");
    return true;
  }

  // Belt-and-suspenders fallback: on browsers where the default storage
  // can't do a native local save (getDefaultStorage().canSave() === false),
  // K.prototype._save()'s isCloudFile() branch checks canSaveToCloud()
  // first — false there makes it fall back to _saveToCloud() ->
  // executeAction('gravit-cloud.save-as'), which the override above
  // already handles. Harmless to patch even when unused.
  function patchDocumentPrototype(doc) {
    const proto = doc && Object.getPrototypeOf(doc);
    if (!proto || proto.__saveToServerCanSaveToCloudPatched) return !!proto;
    if (typeof proto.canSaveToCloud !== "function") return false;
    proto.canSaveToCloud = async () => false;
    proto.__saveToServerCanSaveToCloudPatched = true;
    console.log("[save-to-server] canSaveToCloud patched");
    return true;
  }

  // The actual culprit: on browsers where getDefaultStorage().canSave() is
  // true (File System Access API present — the normal case), _save() ALWAYS
  // takes the _saveDesktop() branch, which never even looks at
  // canSaveToCloud(). For a document reopened via "Open Recent",
  // _saveDesktop() just calls .write() straight on whatever real storage
  // item Recent reconstructed — a genuine built-in "Cloud" storage item
  // (b.Item) pointing at our file id, expecting the full original Corel
  // cloud API surface (manual/commit, usage tracking, real signed URLs,
  // etc.) that this server doesn't implement. That's what produces the
  // native "error occurred while saving" / "newer version" dialogs.
  //
  // Rather than build out that whole surface, patch write() itself on the
  // real storage item's shared prototype so every save — no matter which
  // internal path leads to it — ends up doing the same simple, working PUT
  // our own fake storage item already uses above.
  function patchStorageItemPrototype(item) {
    if (!item || item.__isFakeStorageItem) return false;
    const proto = Object.getPrototypeOf(item);
    if (!proto || proto === Object.prototype) return false;
    if (proto.__saveToServerWritePatched) return true;
    if (typeof proto.write !== "function" || typeof item.getId !== "function")
      return false;
    proto.write = function (bytes, onSuccess, onFail) {
      const id = this.getId();
      if (!id) {
        onFail && onFail(new Error("Storage item has no server file id"));
        return;
      }
      uploadBytesToServer(id, bytes)
        .then(() => onSuccess && onSuccess())
        .catch((err) => onFail && onFail(err));
    };
    proto.__saveToServerWritePatched = true;
    console.log("[save-to-server] real storage item write() patched");
    return true;
  }

  function tryPatchActiveDocument() {
    if (!window.gDesigner || !window.gDesigner.getActiveDocument) return false;
    const doc = window.gDesigner.getActiveDocument();
    if (!doc) return false;
    const patchedDoc = patchDocumentPrototype(doc);
    const item = doc.getStorageItem && doc.getStorageItem();
    const patchedItem = item ? patchStorageItemPrototype(item) : false;
    return patchedDoc && patchedItem;
  }

  let documentPatched = false;
  const poll = setInterval(() => {
    const actionInstalled = installExecuteActionOverride();
    documentPatched = documentPatched || tryPatchActiveDocument();
    if (actionInstalled && documentPatched) clearInterval(poll);
  }, 250);
})();
