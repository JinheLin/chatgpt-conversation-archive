/* Reader controls are kept outside the printable conversation document. */
(() => {
  "use strict";
  function init({ main, layout, store = globalThis.ChatGPTReaderStore }) {
    const { t, language } = globalThis.ChatGPTPdfI18n;
    const anchors = globalThis.ChatGPTReaderAnchor;
    const document = main.ownerDocument;
    const get = (id) => document.getElementById(id);
    const panel = get("reader-annotations"), list = get("reader-annotation-list");
    const toolbar = get("reader-selection"), editor = get("reader-editor");
    toolbar.setAttribute("aria-label", t("readerSelectionToolbar"));
    const comment = get("reader-comment"), status = get("reader-status");
    const toggle = get("reader-toggle"), save = get("reader-save-comment");
    let key = null, notes = [], positions = new Map(), selection = null, editing = null;
    let revision = 0, selecting = 0, busy = false, enabled = false, locked = false;
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function report(message, error = false) {
      status.textContent = message;
      status.hidden = !message;
      status.dataset.level = error ? "error" : "info";
      if (error && key) openPanel();
    }
    function openPanel(open = true) {
      panel.hidden = !open;
      layout.dataset.annotations = String(open);
      toggle.setAttribute("aria-expanded", String(open));
    }
    function hideSelection() { toolbar.hidden = true; selection = null; selecting++; }
    function dirty() { return !editor.hidden && comment.value !== (editing?.comment || ""); }
    function canLeave() { return !busy && !locked && (!dirty() || globalThis.confirm(t("readerDiscardDraft"))); }
    function closeEditor() {
      editor.hidden = true; editing = null; comment.value = "";
    }
    function jump(id) {
      const mark = [...main.querySelectorAll("mark.reader-highlight")].find((node) =>
        JSON.parse(node.dataset.annotationIds).includes(id));
      if (mark) {
        mark.scrollIntoView({ block: "center", behavior: "auto" });
        mark.classList.add("reader-highlight-active");
        setTimeout(() => mark.classList.remove("reader-highlight-active"), 1500);
      } else report(t("readerUnresolvedHint"));
    }
    function edit(note) {
      if (!canLeave()) return;
      editing = note;
      get("reader-editor-quote").textContent = note.anchor.exact;
      comment.value = note.comment || "";
      editor.hidden = false; openPanel();
      comment.focus();
    }
    async function mutate(operation) {
      if (busy || locked || !enabled) return;
      busy = true; save.disabled = true;
      hideSelection();
      report(t("readerSaving"));
      try {
        await operation();
        closeEditor();
        await refresh();
        report(t("readerSaved"));
      } catch (error) {
        report(t("readerSaveFailed", error.message), true);
        // Keep a failed comment draft so it can be copied or retried.
      } finally { busy = false; save.disabled = false; }
    }
    function sortNotes(loaded, restored) {
      const messages = new Map([...main.querySelectorAll(".pdf-message[data-message-id]")]
        .map((section, index) => [section.dataset.messageId, index]));
      // Use restored offsets, since edits can move a quote from its saved position.
      // Missing quotes retain their saved offset; missing messages sort last.
      return [...loaded].sort((a, b) =>
        (messages.get(a.messageId) ?? Number.MAX_SAFE_INTEGER) - (messages.get(b.messageId) ?? Number.MAX_SAFE_INTEGER) ||
        (restored.get(a.id)?.start ?? a.anchor.start) - (restored.get(b.id)?.start ?? b.anchor.start) ||
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    function renderList() {
      list.replaceChildren();
      get("reader-annotations-title").textContent = t("readerAnnotationsCount", notes.length);
      if (!notes.length) {
        list.appendChild(element("p", "hint", t("readerNoAnnotations")));
        return;
      }
      for (const note of notes) {
        const card = element("article", "reader-annotation");
        card.dataset.annotationId = note.id;
        const jumpButton = element("button", "reader-quote", note.anchor.exact);
        jumpButton.type = "button";
        jumpButton.addEventListener("click", () => jump(note.id));
        card.appendChild(jumpButton);
        if (!positions.get(note.id)) card.appendChild(element("p", "reader-unresolved", t("readerUnresolved")));
        if (note.comment) card.appendChild(element("p", "reader-comment-text", note.comment));
        card.appendChild(element("time", "reader-note-date", new Date(note.updatedAt).toLocaleString(language)));
        const controls = element("div", "reader-note-controls");
        const editButton = element("button", "", t("readerEdit"));
        editButton.type = "button"; editButton.disabled = locked;
        editButton.addEventListener("click", () => edit(note));
        const deleteButton = element("button", "", t("readerDelete"));
        deleteButton.type = "button"; deleteButton.disabled = locked;
        deleteButton.addEventListener("click", () => {
          if (!canLeave()) return;
          if (globalThis.confirm(t("readerDeleteConfirm"))) void mutate(() => store.deleteAnnotation(note));
        });
        controls.append(editButton, deleteButton); card.appendChild(controls); list.appendChild(card);
      }
    }
    async function refresh() {
      if (!key) return;
      const mine = ++revision, current = key;
      const loaded = await store.getAnnotations(current);
      if (mine !== revision || current !== key) return;
      const restored = await anchors.apply(main, loaded, { isCancelled: () => mine !== revision || current !== key });
      if (!restored || mine !== revision) return;
      notes = sortNotes(loaded, restored); positions = restored; renderList();
    }
    function unload() {
      revision++; hideSelection(); closeEditor();
      key = null; enabled = false; notes = []; positions.clear();
      openPanel(false); list.replaceChildren();
      toggle.disabled = true;
      report("");
    }
    async function load(conversationKey, writable = true) {
      unload();
      key = conversationKey; enabled = writable; toggle.disabled = !writable;
      if (!writable) { report(t("readerReadOnly"), true); return; }
      const mine = revision;
      try {
        await refresh();
        if (mine + 1 !== revision || key !== conversationKey) return;
        const unresolved = [...positions.values()].filter((value) => !value).length;
        // The list already shows saved notes; successful restoration needs no separate message.
        report(unresolved ? t("readerRestoredUnresolved", notes.length, unresolved) : "");
        openPanel();
      } catch (error) {
        if (key !== conversationKey) return;
        enabled = false;
        report(t("readerSaveFailed", error.message), true);
        openPanel();
      }
    }
    async function captureSelection() {
      if (!key || !enabled || busy || locked || main.hidden) return;
      const selected = globalThis.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) { hideSelection(); return; }
      const range = selected.getRangeAt(0).cloneRange();
      if (!main.contains(range.commonAncestorContainer)) { hideSelection(); return; }
      const mine = ++selecting;
      const captured = await anchors.capture(range, main);
      if (mine !== selecting || !key) return;
      if (!captured) {
        toolbar.hidden = true; selection = null;
        report(t("readerSelectionUnsupported"), true);
        return;
      }
      selection = captured;
      const rect = range.getBoundingClientRect();
      toolbar.style.left = Math.max(8, Math.min(rect.left, globalThis.innerWidth - 230)) + "px";
      toolbar.style.top = Math.max(8, rect.top > 52 ? rect.top - 48 : rect.bottom + 8) + "px";
      toolbar.hidden = false;
    }
    document.addEventListener("mouseup", () => { void captureSelection().catch((error) => report(error.message, true)); });
    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") hideSelection();
      else if (event.shiftKey || event.key.startsWith("Arrow")) void captureSelection().catch((error) => report(error.message, true));
    });
    document.addEventListener("selectionchange", () => {
      if (globalThis.getSelection()?.isCollapsed) hideSelection();
    });
    globalThis.addEventListener("scroll", hideSelection, true);
    globalThis.addEventListener("resize", hideSelection);
    toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    function selectedNote() {
      if (!selection || !key) return null;
      const now = new Date().toISOString();
      return { ...selection, id: crypto.randomUUID(), conversationKey: key, comment: "", createdAt: now, updatedAt: now };
    }
    get("reader-highlight").addEventListener("click", () => {
      if (!canLeave()) return;
      const note = selectedNote();
      if (note) void mutate(() => store.saveAnnotation(note));
    });
    get("reader-add-comment").addEventListener("click", () => {
      const note = selectedNote();
      if (note) { edit(note); hideSelection(); globalThis.getSelection()?.removeAllRanges(); }
    });
    save.addEventListener("click", () => {
      if (!editing) return;
      const old = notes.find((note) => note.id === editing.id);
      const value = { ...editing, comment: comment.value.trim() };
      void mutate(() => store.saveAnnotation(value, old ? editing.updatedAt : null));
    });
    get("reader-cancel-comment").addEventListener("click", () => { if (canLeave()) closeEditor(); });
    toggle.addEventListener("click", () => openPanel(panel.hidden));
    get("reader-close").addEventListener("click", () => { if (canLeave()) { closeEditor(); openPanel(false); } });
    main.addEventListener("click", (event) => {
      const mark = event.target.closest("mark.reader-highlight");
      if (!mark || !globalThis.getSelection()?.isCollapsed) return;
      event.preventDefault();
      const id = JSON.parse(mark.dataset.annotationIds)[0];
      openPanel();
      const card = [...list.children].find((node) => node.dataset.annotationId === id);
      card?.scrollIntoView({ block: "nearest" });
      card?.querySelector("button")?.focus({ preventScroll: true });
    });
    globalThis.addEventListener("beforeunload", (event) => {
      if (dirty() || busy) { event.preventDefault(); event.returnValue = ""; }
    });
    store.subscribe((changedKey) => {
      if (changedKey === key && !busy) void refresh().catch((error) => report(t("readerSaveFailed", error.message), true));
    });
    unload();
    return { load, unload, refresh, canLeave: () => !busy && canLeave(),
      setLocked(value) { locked = value; hideSelection(); save.disabled = value; toggle.disabled = value || !enabled; renderList(); } };
  }
  globalThis.ChatGPTReader = { init };
})();
