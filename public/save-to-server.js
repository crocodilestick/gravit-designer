(function () {
  "use strict";

  // The client's built-in "Save to Cloud"/"Open from Cloud" actions
  // (gravit-cloud.save-as / .save / .open) are never registered by this
  // bundle, so gDesigner.executeAction() throws immediately instead of
  // doing anything. This file intercepts those three action ids and
  // reimplements them against our own server-side storage
  // (routes/files.js), reusing the app's real document serialization by
  // handing doc.store() a small object that fulfils the same
  // getExtension()/write() contract every real storage backend implements.

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
    el._hideTimer = setTimeout(
      () => {
        el.style.opacity = "0";
      },
      isError ? 6000 : 3000,
    );
  }

  // Small reusable modal shell — an overlay + centered box — used by both
  // the name prompt and the browse dialog below. Resolves with whatever
  // the caller passes to `close()`; resolves null on backdrop click.
  function openModal(contentBuilder) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "background:rgba(0,0,0,0.5)",
        "z-index:2147483646",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      ].join(";");
      const box = document.createElement("div");
      box.style.cssText = [
        "background:#2b2b2b",
        "color:#eee",
        "border-radius:8px",
        "padding:20px",
        "min-width:320px",
        "max-width:480px",
        "max-height:80vh",
        "overflow:auto",
        "box-shadow:0 4px 24px rgba(0,0,0,0.4)",
      ].join(";");
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function close(result) {
        overlay.remove();
        resolve(result);
      }
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
      contentBuilder(box, close);
    });
  }

  function styledButton(label, primary) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = primary
      ? "padding:7px 14px;border-radius:4px;border:none;background:#2f80ed;color:#fff;cursor:pointer;"
      : "padding:7px 14px;border-radius:4px;border:1px solid #555;background:transparent;color:#eee;cursor:pointer;";
    return btn;
  }

  // Prompts for a filename, defaulting to `defaultName`. Resolves the
  // chosen name, or null if cancelled.
  function promptForName(defaultName, title) {
    return openModal((box, close) => {
      const h = document.createElement("div");
      h.textContent = title || "Save to Server";
      h.style.cssText = "font-size:15px;font-weight:600;margin-bottom:12px;";

      const input = document.createElement("input");
      input.type = "text";
      input.value = defaultName || "Untitled";
      input.style.cssText =
        "width:100%;box-sizing:border-box;padding:8px;border-radius:4px;border:1px solid #555;background:#1e1e1e;color:#eee;font-size:13px;margin-bottom:16px;";

      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
      const cancelBtn = styledButton("Cancel", false);
      const okBtn = styledButton("Save", true);
      cancelBtn.onclick = () => close(null);
      okBtn.onclick = () => close(input.value.trim() || defaultName || "Untitled");
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") okBtn.click();
        if (e.key === "Escape") cancelBtn.click();
      });
      buttons.appendChild(cancelBtn);
      buttons.appendChild(okBtn);

      box.appendChild(h);
      box.appendChild(input);
      box.appendChild(buttons);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  // Lists server files (GET /file) and lets the user pick one to open.
  function browseServerFiles() {
    return openModal(async (box, close) => {
      box.style.minWidth = "480px";
      const h = document.createElement("div");
      h.textContent = "Open from Server";
      h.style.cssText = "font-size:15px;font-weight:600;margin-bottom:12px;";
      box.appendChild(h);

      const list = document.createElement("div");
      list.textContent = "Loading…";
      list.style.cssText = "max-height:50vh;overflow:auto;";
      box.appendChild(list);

      const footer = document.createElement("div");
      footer.style.cssText = "display:flex;justify-content:flex-end;margin-top:12px;";
      const closeBtn = styledButton("Close", false);
      closeBtn.onclick = () => close(null);
      footer.appendChild(closeBtn);
      box.appendChild(footer);

      let files;
      try {
        files = await fetch("/file").then((r) => r.json());
      } catch (err) {
        list.textContent = `Failed to load files: ${err && err.message ? err.message : err}`;
        return;
      }
      files = (files || []).filter((f) => !f.trashed);
      list.innerHTML = "";
      if (!files.length) {
        list.textContent = "No files saved to the server yet.";
        return;
      }
      files.sort(
        (a, b) =>
          new Date(b.updated || b.modifiedTime || 0) -
          new Date(a.updated || a.modifiedTime || 0),
      );
      files.forEach((file) => {
        const row = document.createElement("div");
        row.style.cssText =
          "padding:10px;border-radius:4px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;";
        row.onmouseenter = () => {
          row.style.background = "rgba(255,255,255,0.08)";
        };
        row.onmouseleave = () => {
          row.style.background = "transparent";
        };
        const name = document.createElement("div");
        name.textContent = file.name || "Untitled";
        const date = document.createElement("div");
        date.style.cssText = "color:#999;font-size:12px;white-space:nowrap;";
        const when = file.updated || file.modifiedTime;
        date.textContent = when ? new Date(when).toLocaleString() : "";
        row.appendChild(name);
        row.appendChild(date);
        row.onclick = () => {
          close(null);
          openServerFile(file);
        };
        list.appendChild(row);
      });
    });
  }

  // Opening a file: gDesigner.openDocument() is the same call "Open
  // Recent" uses internally (see its click handler in the bundle), and
  // that path is proven to work end to end, including picking up the
  // write() prototype patch below for re-saving afterwards. We prefer
  // reusing an existing Recent Files entry for this id when there is one;
  // for a file never opened in this browser/session before there's no
  // such entry, so this falls back to a minimally-shaped descriptor —
  // the one part of this feature without a confirmed-working precedent.
  function openServerFile(file) {
    try {
      const recents =
        (window.gContainer &&
          window.gContainer.getRecentDocuments &&
          window.gContainer.getRecentDocuments()) ||
        [];
      const match = recents.find((r) => {
        try {
          return (
            (r.getId && r.getId() === file.id) ||
            r.id === file.id ||
            (r.getFile && r.getFile() && r.getFile().id === file.id)
          );
        } catch (err) {
          return false;
        }
      });
      if (match) {
        window.gDesigner.openDocument(match);
        return;
      }
    } catch (err) {
      console.warn("[save-to-server] recent-files lookup failed", err);
    }
    try {
      window.gDesigner.openDocument({
        id: file.id,
        getId: () => file.id,
        getUniqueId: () => file.id,
        getName: () => file.name,
        getExtension: () => "GVDESIGN",
        getFile: () => ({ id: file.id }),
      });
    } catch (err) {
      console.error("[save-to-server] open failed", err);
      showToast(
        `Couldn't open "${file.name}": ${err && err.message ? err.message : err}`,
        true,
      );
    }
  }

  // Shared by the fresh-save path (fake storage item, below) and the
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

  function createServerFile(name) {
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

  // Figures out which server file a save should target, prompting for a
  // name only when we genuinely don't already know one:
  //  - doc.__serverFile: set on the live document object after any
  //    successful save, so a plain re-save never re-prompts.
  //  - doc.getStorageItem()'s real id: true for a document reopened via
  //    Open Recent or our own Browse dialog, which already has a
  //    server-assigned id even though we've never personally saved it
  //    from this document instance.
  //  - otherwise (a brand-new, never-saved document, or an explicit
  //    "Save to Server As") — we don't know the name, so ask, matching
  //    how local Save As already behaves.
  // Returns null if the user cancels the prompt.
  async function resolveTargetFile(doc, forceSaveAs) {
    const currentName = (doc.getTitle && doc.getTitle()) || "Untitled";
    if (!forceSaveAs) {
      if (doc.__serverFile) return doc.__serverFile;
      const item = doc.getStorageItem && doc.getStorageItem();
      const existingId =
        item && !item.__isFakeStorageItem && typeof item.getId === "function"
          ? item.getId()
          : null;
      if (existingId) {
        const meta = {
          id: existingId,
          name: (item.getName && item.getName()) || currentName,
        };
        doc.__serverFile = meta;
        return meta;
      }
    }
    const defaultName =
      forceSaveAs && doc.__serverFile ? doc.__serverFile.name : currentName;
    const chosenName = await promptForName(
      defaultName,
      forceSaveAs ? "Save to Server As" : "Save to Server",
    );
    if (chosenName == null) return null;
    const meta = await createServerFile(chosenName);
    doc.__serverFile = meta;
    return meta;
  }

  function saveActiveDocumentToServer(options) {
    options = options || {};
    const doc =
      window.gDesigner && window.gDesigner.getActiveDocument
        ? window.gDesigner.getActiveDocument()
        : null;
    if (!doc) {
      if (!options.silent) showToast("Save to server: no active document", true);
      return;
    }
    patchDocumentPrototype(doc);

    return resolveTargetFile(doc, !!options.forceSaveAs)
      .then((target) => {
        if (!target) return; // user cancelled the name prompt
        const name = target.name;
        const fakeStorageItem = {
          __isFakeStorageItem: true,
          // Real storage-item classes return the uppercase extension
          // (K.prototype.store compares it against B.ext.toUpperCase()).
          getExtension: () => "GVDESIGN",
          getId: () => target.id,
          getName: () => name,
          getFile: () => ({ id: target.id }),
          write: (bytes, onSuccess, onFail) => {
            uploadBytesToServer(target.id, bytes)
              .then(() => onSuccess && onSuccess())
              .catch((err) => onFail && onFail(err));
          },
        };
        return new Promise((resolve, reject) => {
          try {
            doc.store(fakeStorageItem, resolve, reject, {});
          } catch (err) {
            reject(err);
          }
        }).then(() => {
          // Update the tab title via the document's own public setter.
          //
          // NOT doc.setStorageItem(fakeStorageItem): that fires a
          // StorageItemUpdated event, and the app then calls a much wider
          // storage-item interface on it than our small object implements
          // (Je._registerUsage -> isRegistrable(), Je._updateTitle ->
          // supportsShadowFile(), K.isModified -> getVersionId(), ...),
          // each throwing a TypeError that killed the save.
          //
          // setTitle() is the real API for this and needs none of that:
          // K.prototype.getTitle() returns this._title while the document
          // is still "new" (isNew() === !this._storageItem), and setTitle
          // only touches the storage item when isCloudFile() is true —
          // which is `getStorageItem() instanceof D.Item`, false for us
          // since we deliberately never attach one. It also triggers the
          // Modified event the title UI already listens to.
          if (typeof doc.setTitle === "function") {
            doc.setTitle(name);
          }
          if (!options.silent) showToast(`Saved "${name}" to server`);
        });
      })
      .catch((err) => {
        console.error("[save-to-server] failed", err);
        showToast(
          `Failed to save to server: ${err && err.message ? err.message : err}`,
          true,
        );
      });
  }

  // Both ids below are handled identically: with canSaveToCloud() forced
  // to false (see patchDocumentPrototype), _saveDesktop() ends up calling
  // _saveToCloud() -> executeAction('gravit-cloud.save-as') for every
  // single save it triggers, first or hundredth — there is no separate
  // dispatch of plain 'gravit-cloud.save' happening anywhere in this
  // build. Treating '.save-as' as "always prompt and create a new file"
  // was the bug: it re-prompted and duplicated the file on every save.
  // saveActiveDocumentToServer() with no forced flag already does the
  // right thing either way — reuse the known file if there is one,
  // prompt only when there genuinely isn't.
  const ACTION_HANDLERS = {
    "gravit-cloud.save-as": () => saveActiveDocumentToServer({ forceSaveAs: false }),
    "gravit-cloud.save": () => saveActiveDocumentToServer({ forceSaveAs: false }),
    "gravit-cloud.open": () => browseServerFiles(),
  };

  // The File menu is built by Je.prototype._createMainMenu (Je = the
  // gDesigner class), which is NOT hand-written markup — it walks
  // gDesigner._actions, groups each by action.getCategory()/getGroup(),
  // and renders every item through the same code (addMenuItem, reading
  // getTitle()/getIcon()/isEnabled()/etc off each action). Two earlier
  // attempts assumed otherwise (once guessing this menu used hardcoded
  // captions, once trying to inject raw <li> markup by hand) and both
  // were wrong — DOM-level insertion is invisible to this menu's own
  // hover/click handling, which is driven by its internal items array,
  // not the DOM. Confirmed the real mechanism instead: the button that
  // opens the menu calls its factory function fresh on every mousedown
  // (see the "gmenubutton" jQuery plugin), so _createMainMenu — and the
  // walk over gDesigner._actions — reruns on every single open. Actions
  // registered into gDesigner._actions before that point render exactly
  // like real ones automatically: no menu-DOM code of our own needed.
  //
  // getTitle() must return a real GLocaleKey (GLocale.get() is called on
  // it directly), not a string — grabbed at runtime off any real action
  // rather than guessed at. getCategory()/getGroup() are borrowed by
  // reference from a real neighboring action (GOpenAction for "Open...",
  // the GVDESIGN Save-As entry for "Save...") so our items land in the
  // exact same menu groups without needing to reverse-engineer the
  // category tree ourselves. Titles reuse the GGravitCloudAction locale
  // keys already renamed for the rebrand above.
  // Primary lookup is by action id, taken straight from the source:
  // GOpenAction.ID === "file.open", GSaveAsAction.ID === "file.save-as"
  // (per-format variants are `file.save-as.<ext>`, so the native format's
  // is "file.save-as.gvdesign"). Searching _actions directly rather than
  // _actionsMap, because _actionsMap is only filled in as a side effect of
  // _createMainMenu's walk and so may still be empty this early.
  function findActionById(id) {
    const actions = window.gDesigner.getActions ? window.gDesigner.getActions() : null;
    if (!actions) return null;
    for (const action of actions) {
      try {
        if (action.getId() === id) return action;
      } catch (err) {
        // Skip anything that can't report its id.
      }
    }
    const mapped = window.gDesigner._actionsMap && window.gDesigner._actionsMap[id];
    return mapped || null;
  }

  function findActionByTitleKey(namespace, key) {
    const actions = window.gDesigner.getActions ? window.gDesigner.getActions() : null;
    if (!actions) return null;
    for (const action of actions) {
      try {
        const title = action.getTitle();
        if (
          title &&
          typeof title.getClassReference === "function" &&
          title.getClassReference() === namespace &&
          (key == null || title.getKey() === key)
        ) {
          return action;
        }
      } catch (err) {
        // Some actions may throw building a title outside their normal
        // context — irrelevant to finding our reference, skip.
      }
    }
    return null;
  }

  // GLocale.get() is called on whatever getTitle() returns, so it has to be
  // a real GLocaleKey, not a string. Rather than hardcode the class (it
  // lives inside the webpack bundle with no global export), take it off any
  // real action's title — every action class builds one the same way,
  // e.g. GOpenAction.TITLE = new GLocaleKey("GOpenAction", "title").
  function getGLocaleKeyClass() {
    const actions = window.gDesigner.getActions ? window.gDesigner.getActions() : [];
    for (const action of actions || []) {
      try {
        const title = action.getTitle();
        if (title && typeof title.getClassReference === "function" && title.constructor) {
          return title.constructor;
        }
      } catch (err) {
        // Skip actions whose title can't be built here.
      }
    }
    return null;
  }

  function makeServerAction(id, titleKey, referenceAction, GLocaleKeyClass) {
    const fake = Object.create(Object.getPrototypeOf(referenceAction));
    Object.assign(fake, {
      getId: () => id,
      getTitle: () => new GLocaleKeyClass("GGravitCloudAction", titleKey),
      getInfo: () => null,
      getIcon: () => "gravit-icon-cloud",
      getGroupIcon: () => "gravit-icon-cloud",
      getShortcut: () => null,
      getStyleClass: () => null,
      getCategory: () => referenceAction.getCategory(),
      getGroup: () => referenceAction.getGroup(),
      isEnabled: () => true,
      isVisible: () => true,
      isAvailable: () => true,
      isPro: () => false,
      isCheckable: () => false,
      isChecked: () => false,
      isShortcutGlobal: () => false,
      noHover: () => false,
      getTooltipConfig: () => null,
      statsValue: () => id,
      // Also called against every action while the menu builds
      // (Je.registerAdditionalShortcuts -> getAdditionalShortcuts, and
      // _executeShortcutAction -> isKeyBoardEventRequiredToExecute).
      // Overridden so nothing falls through to the borrowed prototype and
      // runs a real action's logic against an object lacking its state.
      getAdditionalShortcuts: () => null,
      isKeyBoardEventRequiredToExecute: () => false,
      // Routes through the executeAction override above regardless of
      // whether the menu calls executeAction(id) or action.execute()
      // directly — both converge on the exact same, already-proven logic.
      execute: () => window.gDesigner.executeAction(id),
      executeFromShortcut: () => window.gDesigner.executeAction(id),
    });
    return fake;
  }

  // Reports, once, exactly what the action registry actually looks like at
  // runtime. Previous rounds failed silently here and left nothing to
  // diagnose from; this makes the reason visible in the console instead of
  // guessing at it.
  let registerAttempts = 0;
  function logActionRegistryDiagnostics() {
    const g = window.gDesigner;
    console.warn("[save-to-server] DIAGNOSTIC: could not find reference actions");
    console.warn("  gDesigner present:", !!g);
    if (!g) return;
    console.warn("  _actions is array:", Array.isArray(g._actions), "length:", g._actions && g._actions.length);
    console.warn("  _actionsMap keys:", g._actionsMap ? Object.keys(g._actionsMap).length : "(none)");
    const actions = g.getActions ? g.getActions() : [];
    console.warn("  sample of first 5 actions:");
    (actions || []).slice(0, 5).forEach((a, idx) => {
      let id, title, titleType, ref, key;
      try { id = a.getId && a.getId(); } catch (e) { id = "<getId threw>"; }
      try {
        title = a.getTitle && a.getTitle();
        titleType = typeof title;
        ref = title && title.getClassReference ? title.getClassReference() : "(no getClassReference)";
        key = title && title.getKey ? title.getKey() : "(no getKey)";
      } catch (e) {
        titleType = "<getTitle threw: " + e.message + ">";
      }
      console.warn(`    [${idx}] id=${id} titleType=${titleType} classRef=${ref} key=${key}`);
    });
    const ids = (actions || []).map((a) => { try { return a.getId(); } catch (e) { return null; } });
    console.warn("  is 'file.open' among action ids:", ids.indexOf("file.open"));
    console.warn("  ids containing 'save':", ids.filter((i) => i && i.indexOf("save") !== -1).slice(0, 15));
  }

  function registerFileMenuActions() {
    if (!window.gDesigner || !window.gDesigner._actions || !window.gDesigner._actionsMap) {
      return false;
    }
    if (window.gDesigner.__saveToServerActionsRegistered) return true;
    const openRef =
      findActionById("file.open") || findActionByTitleKey("GOpenAction");
    const saveAsRef =
      findActionById("file.save-as.gvdesign") ||
      findActionById("file.save-as") ||
      findActionByTitleKey("GDocument", "title.save-gvdesign");
    const GLocaleKeyClass = getGLocaleKeyClass();
    if (!openRef || !saveAsRef || !GLocaleKeyClass) {
      registerAttempts++;
      if (registerAttempts === 12) {
        // ~3s in, once: report which of the three is missing plus a dump of
        // the registry, so a failure here is diagnosable instead of silent.
        console.warn(
          "[save-to-server] missing:",
          !openRef ? "openRef " : "",
          !saveAsRef ? "saveAsRef " : "",
          !GLocaleKeyClass ? "GLocaleKeyClass" : "",
        );
        logActionRegistryDiagnostics();
      }
      return false; // not built yet — retry next tick
    }

    const newActions = [
      makeServerAction("gravit-cloud.open", "title.open", openRef, GLocaleKeyClass),
      makeServerAction("gravit-cloud.save", "title.save", saveAsRef, GLocaleKeyClass),
      makeServerAction("gravit-cloud.save-as", "title.save-as", saveAsRef, GLocaleKeyClass),
    ];
    newActions.forEach((action) => {
      if (window.gDesigner._actionsMap[action.getId()]) return;
      window.gDesigner._actions.push(action);
      window.gDesigner._actionsMap[action.getId()] = action;
    });
    window.gDesigner.__saveToServerActionsRegistered = true;
    console.log(
      "[save-to-server] File menu actions registered (refs:",
      openRef.getId(),
      "/",
      saveAsRef.getId(),
      ")",
    );
    return true;
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
      if (ACTION_HANDLERS[id]) return ACTION_HANDLERS[id]();
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

  // The actual culprit behind the "Open Recent" save failures: on
  // browsers where getDefaultStorage().canSave() is true (File System
  // Access API present — the normal case), _save() ALWAYS takes the
  // _saveDesktop() branch, which never even looks at canSaveToCloud().
  // For a document reopened via "Open Recent" (or our own Browse
  // dialog), _saveDesktop() just calls .write() straight on whatever
  // real storage item got reconstructed — a genuine built-in "Cloud"
  // storage item (b.Item) pointing at our file id, expecting the full
  // original Corel cloud API surface (manual/commit, usage tracking,
  // real signed URLs, etc.) that this server doesn't implement.
  //
  // Rather than build out that whole surface, patch write() itself on
  // the real storage item's shared prototype so every save — no matter
  // which internal path leads to it — ends up doing the same simple,
  // working PUT our own fake storage item already uses above.
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
  let fileMenuActionsRegistered = false;
  const poll = setInterval(() => {
    const actionInstalled = installExecuteActionOverride();
    documentPatched = documentPatched || tryPatchActiveDocument();
    fileMenuActionsRegistered = fileMenuActionsRegistered || registerFileMenuActions();
    if (actionInstalled && documentPatched && fileMenuActionsRegistered) {
      clearInterval(poll);
    }
  }, 250);

  // Periodic autosave-to-server. The app's own native autosave loop
  // explicitly skips any document where canSaveToCloud() is false (see
  // patchDocumentPrototype above) — which is now every document we've
  // touched, by design. This is a separate, independent replacement:
  // only ever fires for a document that already has a known server file
  // (doc.__serverFile), so it never prompts for a name or creates a new
  // file — a brand-new, never-saved document is simply never autosaved.
  const AUTOSAVE_INTERVAL_MS = 3 * 60 * 1000;
  setInterval(() => {
    const doc =
      window.gDesigner && window.gDesigner.getActiveDocument
        ? window.gDesigner.getActiveDocument()
        : null;
    if (!doc || !doc.__serverFile) return;
    try {
      if (typeof doc.isModified === "function" && !doc.isModified()) return;
    } catch (err) {
      // isModified() reaches into storage-item state; never let a throw
      // there kill the interval — just skip this tick.
      console.warn("[save-to-server] isModified() threw, skipping autosave", err);
      return;
    }
    saveActiveDocumentToServer({ silent: true });
  }, AUTOSAVE_INTERVAL_MS);
})();
