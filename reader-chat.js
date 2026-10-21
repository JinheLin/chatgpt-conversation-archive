/* Conversation-specific local drafts and an explicit, single-send workflow. */
(() => {
  "use strict";
  function init({ document, main, layout, reader, store, onResult, onBusy,
      session = globalThis.ChatGPTReaderChatSession }) {
    const { t } = globalThis.ChatGPTPdfI18n;
    const get = id => document.getElementById(id);
    const panel = get("reader-chat"), toggle = get("reader-chat-toggle"), input = get("reader-chat-input");
    const send = get("reader-chat-send"), check = get("reader-chat-check");
    let payload = null, key = null, draft = null, version = null, revision = 0;
    let busy = false, locked = false, writable = false, dirty = false, saving = 0, timer;
    let writes = Promise.resolve(), subscriptionTimer;
    function status(text = "", failed = false) {
      const node = get("reader-chat-status");
      node.textContent = text; node.hidden = !text; node.dataset.level = failed ? "error" : "info";
    }
    function draftStatus(text = "", failed = false) {
      const node = get("reader-chat-draft-status");
      node.textContent = text; node.hidden = !text; node.dataset.level = failed ? "error" : "info";
    }
    function controls() {
      const available = writable && !!key && !busy && !locked;
      input.disabled = !available || !!draft?.pending;
      send.disabled = !available || !!draft?.pending || !input.value.trim();
      send.hidden = !!draft?.pending;
      check.hidden = !draft?.pending || busy; check.disabled = !available;
      get("reader-chat-restore").hidden = !draft?.pending || busy;
      get("reader-chat-restore").disabled = !available;
      get("reader-chat-remove-quote").disabled = !available || !!draft?.pending;
      get("reader-ask-selection").disabled = !available || !!draft?.pending;
      toggle.disabled = !payload;
      panel.setAttribute("aria-busy", String(busy));
    }
    function show(open = true, focus = false) {
      if (open && !payload) return;
      if (open && !reader.canLeave()) return;
      if (open) reader.openPanel(false);
      panel.hidden = !open;
      layout.dataset.chat = String(open);
      toggle.setAttribute("aria-expanded", String(open));
      if (focus) (open ? input : toggle).focus({ preventScroll: true });
    }
    function paintDraft() {
      input.value = draft?.text || "";
      get("reader-chat-quote").hidden = !draft?.quote;
      get("reader-chat-quote-text").textContent = draft?.quote || "";
      controls();
    }
    function save() {
      clearTimeout(timer);
      if (!key || !writable || !dirty) return writes;
      const entry = structuredClone(draft), mine = revision;
      dirty = false; saving++;
      draftStatus(t("chatDraftSaving"));
      const task = writes.catch(() => {}).then(async () => {
        const result = await store.saveDraft(entry, { expectedUpdatedAt: version });
        version = result.updatedAt;
        if (mine === revision) draftStatus(t("chatDraftSaved"));
      }).catch(error => {
        if (mine === revision) { dirty = true; draftStatus(t("chatDraftFailed", error.message), true); }
        throw error;
      }).finally(() => { saving--; });
      writes = task;
      // Autosave errors remain visible without unhandled promise rejections.
      task.catch(() => {});
      return task;
    }
    function changed() {
      draft.text = input.value; dirty = true;
      clearTimeout(timer); timer = setTimeout(() => { void save(); }, 250);
      controls();
    }
    async function unload() {
      await save().catch(() => {});
      revision++; clearTimeout(timer);
      writes = Promise.resolve();
      payload = key = draft = null; version = null; dirty = false; writable = false;
      show(false); input.value = ""; controls(); status(); draftStatus();
      get("reader-chat-replies").replaceChildren();
    }
    async function load(value, enabled = true) {
      await unload();
      payload = value; key = store.keyFor(value.sourceUrl);
      writable = enabled && globalThis.ChatGPTPdfSource.parseUrl(value.sourceUrl).kind === "c";
      get("reader-chat-original").href = value.sourceUrl;
      draft = { key, text: "", quote: "", quoteMessageId: "", updatedAt: new Date().toISOString() };
      if (writable) {
        try {
          const saved = await store.getDraft(key);
          if (saved) { draft = saved; version = saved.updatedAt; }
        } catch (error) { writable = false; status(t("chatDraftFailed", error.message), true); }
      }
      paintDraft();
      if (!enabled) status(t("chatStorageRequired"), true);
      else if (!writable && globalThis.ChatGPTPdfSource.parseUrl(value.sourceUrl).kind !== "c") status(t("chatSharedReadOnly"));
      else if (draft.pending) status(t("chatSendUncertain"), true);
    }
    async function receive(result) {
      // Persist and render the full conversation before retiring the pending send.
      await onResult(result.payload);
      payload = result.payload;
      const previous = draft;
      draft = { key, text: "", quote: "", quoteMessageId: "", updatedAt: new Date().toISOString() };
      dirty = true;
      try { await save(); }
      catch (error) { draft = previous; dirty = false; paintDraft(); throw error; }
      paintDraft();
      const replies = get("reader-chat-replies"); replies.replaceChildren();
      const title = document.createElement("h3"); title.textContent = t("chatLatestReply"); replies.append(title);
      for (const message of result.answers) {
        const original = [...main.querySelectorAll(".pdf-message")].find(node => node.dataset.messageId === message.id);
        const body = original?.querySelector(".pdf-message-body")?.cloneNode(true);
        if (body) {
          // Namespace copied IDs, including SVG definitions and their references.
          const ids = new Map();
          for (const [index, node] of [...body.querySelectorAll("[id]")].entries()) {
            const id = "chat-reply-" + encodeURIComponent(message.id) + "-" + index;
            ids.set(node.id, id); node.id = id;
          }
          for (const node of body.querySelectorAll("*")) for (const attribute of [...node.attributes]) {
            if (attribute.name === "id") continue;
            let value = attribute.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
              (match, _quote, id) => ids.has(id) ? "url(#" + ids.get(id) + ")" : match);
            if (/^(?:href|xlink:href)$/.test(attribute.name) && value.startsWith("#") && ids.has(value.slice(1))) value = "#" + ids.get(value.slice(1));
            if (value !== attribute.value) node.setAttribute(attribute.name, value);
          }
          for (const node of body.querySelectorAll("mark.reader-highlight")) node.replaceWith(...node.childNodes);
          replies.append(body);
        }
      }
      const jump = document.createElement("button"); jump.type = "button"; jump.textContent = t("chatViewReply");
      jump.addEventListener("click", () => {
        const target = [...main.querySelectorAll(".pdf-message")].find(node => node.dataset.messageId === result.answers.at(-1)?.id);
        if (target) globalThis.ChatGPTReaderFolds?.reveal(target);
        target?.scrollIntoView({ block: "start", behavior: "auto" });
      });
      replies.append(jump);
      status(t("chatReplySaved"));
    }
    async function submit(checking = false) {
      if (!writable || busy || locked || !reader.canLeave() || (!checking && (!input.value.trim() || draft.pending))) return;
      if (checking && !draft.pending) return;
      busy = true; controls(); onBusy(true);
      try { await save(); } catch (_) { busy = false; onBusy(false); controls(); return; }
      const pending = checking ? structuredClone(draft.pending) : {
        requestId: crypto.randomUUID(), headId: payload.completeness.lastMessageId,
        prompt: draft.quote ? t("chatQuotePrompt") + "\n\n" + draft.quote + "\n\n" + input.value.trim() : input.value.trim(),
        startedAt: new Date().toISOString()
      };
      try {
        const result = await session.send(payload, pending, {
          checking,
          beforeCommit: async () => {
            const latest = await store.getDraft(key);
            if (latest?.pending) throw new Error(t("chatSendUncertain"));
            draft.pending = pending; dirty = true;
            await save(); controls();
          },
          onState: state => status(t({ connecting: "chatConnecting", preparing: "chatPreparing", sending: "chatSending", recovering: "chatRecovering",
            generating: "chatGenerating", waiting: "chatWaiting" }[state]))
        });
        // From here onward, a storage/render failure is still a confirmed send.
        try { await receive(result); }
        catch (error) { error.uncertain = true; throw error; }
      } catch (error) {
        if (!checking && !error.uncertain && draft.pending) {
          delete draft.pending; dirty = true; await save().catch(() => {});
        }
        status((error.message || t("chatReplyReadFailed")) + (error.uncertain ? " " + t("chatSendUncertain") : ""), true);
      } finally {
        busy = false; onBusy(false); controls();
        if (!panel.hidden) show();
      }
    }
    toggle.addEventListener("click", () => show(panel.hidden, true));
    get("reader-chat-close").addEventListener("click", () => show(false, true));
    get("reader-chat-form").addEventListener("submit", event => { event.preventDefault(); void submit(); });
    check.addEventListener("click", () => { void submit(true); });
    get("reader-chat-restore").addEventListener("click", async () => {
      if (busy || locked || !draft?.pending || !globalThis.confirm(t("chatRestoreDraftConfirm"))) return;
      const previous = draft.pending;
      delete draft.pending; dirty = true;
      try { await save(); status(); paintDraft(); }
      catch (_) { draft.pending = previous; dirty = false; paintDraft(); }
    });
    input.addEventListener("input", changed);
    get("reader-chat-remove-quote").addEventListener("click", () => {
      if (busy || locked || draft?.pending) return;
      draft.quote = draft.quoteMessageId = ""; paintDraft(); changed();
    });
    document.addEventListener("reader-panel-open", event => { if (event.detail === "annotations") show(false); });
    document.addEventListener("reader-quote-question", event => {
      if (!writable || busy || locked || draft?.pending) return;
      draft.quote = event.detail.quote; draft.quoteMessageId = event.detail.messageId;
      paintDraft(); changed(); show(true, true);
    });
    globalThis.addEventListener("beforeunload", event => {
      void save();
      if (busy || dirty || saving) { event.preventDefault(); event.returnValue = ""; }
    });
    store.subscribe((changedKey, topic) => {
      if (changedKey !== key || topic !== "drafts" || busy) return;
      clearTimeout(subscriptionTimer);
      subscriptionTimer = setTimeout(async () => {
        const mine = revision;
        try {
          const latest = await store.getDraft(key);
          if (mine !== revision || !latest || latest.updatedAt === version || busy || saving) return;
          if (dirty) { draftStatus(t("chatDraftConflict"), true); return; }
          draft = latest; version = latest.updatedAt; paintDraft();
          status(draft.pending ? t("chatSendUncertain") : "", !!draft.pending);
        } catch (error) { draftStatus(t("chatDraftFailed", error.message), true); }
      }, 50);
    });
    controls();
    return { load, unload, setLocked(value) { locked = value; controls(); },
      async canLeave() { if (busy) return false; try { await save(); return true; } catch (_) { return false; } } };
  }
  globalThis.ChatGPTReaderChat = { init };
})();
