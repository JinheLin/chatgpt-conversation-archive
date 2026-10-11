/* Answer read marks stay in the reader. HTML export removes them; print CSS hides them. */
(() => {
  "use strict";
  function clear(root) {
    for (const node of root?.querySelectorAll?.(".reader-read-controls") || []) node.remove();
  }
  async function hash(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function init({ main, sidebar, store = globalThis.ChatGPTReaderStore, report = () => {} }) {
    const { t } = globalThis.ChatGPTPdfI18n;
    const document = main.ownerDocument;
    let key = null, messages = [], records = [], hashes = new Map();
    let revision = 0, busy = false, enabled = false, locked = false, unreadOnly = false;
    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function byId() {
      return new Map(records.map((entry) => [entry.messageId, entry]));
    }
    function status(messageId) {
      const record = byId().get(messageId);
      if (!record?.read) return "unread";
      return record.textHash === hashes.get(messageId) ? "read" : "stale";
    }
    function statusText(state) {
      return t(state === "read" ? "readerStatusRead" : state === "stale" ? "readerStatusStale" : "readerStatusUnread");
    }
    function answers() {
      return messages.filter((message) => message.role === "assistant");
    }
    function button(className, text, focus, messageIds) {
      const node = element("button", className, text);
      node.type = "button";
      node.dataset.readFocus = focus;
      node.dataset.messageIds = JSON.stringify(messageIds);
      node.disabled = locked || busy || !enabled;
      return node;
    }
    function focused() {
      const node = document.activeElement;
      return node?.dataset?.readFocus || "";
    }
    function restoreFocus(token) {
      if (!token) return;
      const node = [...document.querySelectorAll("[data-read-focus]")].find((item) => item.dataset.readFocus === token);
      node?.focus({ preventScroll: true });
    }
    function paintMessages() {
      clear(main);
      if (!enabled) return;
      for (const section of main.querySelectorAll(".pdf-assistant[data-message-id]")) {
        const id = section.dataset.messageId;
        const state = status(id);
        const label = t("answerLabel");
        const controls = element("div", "reader-read-controls");
        const toggle = button("reader-read-toggle", state === "read" ? t("readerMarkUnread") : t("readerMarkRead"), `toggle:${id}`, [id]);
        toggle.dataset.state = state;
        toggle.dataset.action = "toggle";
        toggle.setAttribute("aria-pressed", String(state === "read"));
        toggle.setAttribute("aria-label", state === "stale" ? t("readerMarkStaleNamed", label) :
          t(state === "read" ? "readerMarkUnreadNamed" : "readerMarkReadNamed", label));
        controls.append(toggle);
        if (state === "stale") controls.append(element("span", "reader-read-state", t("readerReadStale")));
        section.querySelector(".pdf-role")?.insertAdjacentElement("afterend", controls);
      }
    }
    function turns() {
      const grouped = [];
      let current = null;
      for (const section of main.querySelectorAll(".pdf-message[data-message-id]")) {
        const id = section.dataset.messageId;
        if (section.classList.contains("pdf-user")) {
          current = { anchor: section.id, question: id, answers: [] };
          grouped.push(current);
        } else if (current) current.answers.push(id);
      }
      return new Map(grouped.map((entry) => [entry.anchor, entry]));
    }
    function paintToc() {
      const nav = sidebar.querySelector(".preview-toc");
      sidebar.querySelector(".reader-read-filter")?.remove();
      sidebar.querySelector(".reader-no-unread")?.remove();
      for (const node of sidebar.querySelectorAll(".reader-read-toc")) node.remove();
      if (!nav || !enabled) return;
      const filter = element("div", "reader-read-filter");
      const filterButton = button("reader-read-filter-toggle", unreadOnly ? t("readerShowAll") : t("readerUnreadOnly"), "filter", []);
      filterButton.setAttribute("aria-pressed", String(unreadOnly));
      filter.append(filterButton);
      nav.insertBefore(filter, nav.firstChild);
      const grouped = turns();
      let visible = 0;
      for (const item of nav.querySelectorAll(":scope > ol > li")) {
        const link = item.querySelector(":scope > a");
        const raw = link?.getAttribute("href") || "";
        const anchor = raw.includes("#") ? raw.slice(raw.lastIndexOf("#") + 1) : "";
        const turn = anchor ? grouped.get(anchor) : null;
        item.hidden = false;
        if (!turn?.question) continue;
        const answerStates = turn.answers.map((id) => status(id));
        const answerState = answerStates.includes("unread") ? "unread" : answerStates.includes("stale") ? "stale" : "read";
        if (turn.answers.length) {
          const marks = element("span", "reader-read-toc");
          const answer = button("reader-read-dot", answerState === "read" ? "✓" : answerState === "stale" ? "!" : "○",
            `answers:${turn.answers.join("\n")}`, turn.answers);
          answer.dataset.state = answerState;
          answer.dataset.action = "group";
          answer.setAttribute("aria-label", t("readerAnswerStatus", statusText(answerState)));
          marks.append(answer);
          link.before(marks);
        }
        item.hidden = unreadOnly && answerState === "read";
        if (!item.hidden) visible += 1;
      }
      if (unreadOnly && visible === 0 && nav.querySelector(":scope > ol > li")) {
        nav.append(element("p", "hint reader-no-unread", t("readerNoUnread")));
      }
    }
    function paintMeta() {
      const meta = document.getElementById("reader-meta");
      const tracked = answers();
      if (!meta?.dataset.readBase || !tracked.length) return;
      const count = tracked.filter((message) => byId().get(message.id)?.read).length;
      meta.textContent = `${meta.dataset.readBase} · ${t("readerReadProgress", count, tracked.length)}`;
    }
    function paint() {
      const token = focused();
      paintMessages();
      paintToc();
      paintMeta();
      restoreFocus(token);
    }
    function idsFrom(node) {
      try {
        const parsed = JSON.parse(node?.dataset.messageIds || "[]");
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
      } catch (_) { return []; }
    }
    function entriesFor(ids, read) {
      return ids.map((id) => ({ conversationKey: key, messageId: id, read, textHash: hashes.get(id) }));
    }
    async function commit(entries) {
      if (!enabled || locked || busy || !key || !entries.length || entries.some((entry) => !entry.textHash)) return;
      busy = true;
      paint();
      try {
        await store.setReads(entries);
        const mine = revision;
        records = await store.getReads(key);
        if (mine !== revision) return;
      } catch (error) {
        report(t("readerReadFailed", error.message), true);
      } finally {
        busy = false;
        if (key) paint();
      }
    }
    function toggle(ids) {
      const markRead = ids.some((id) => status(id) !== "read");
      void commit(entriesFor(ids, markRead));
    }
    function onClick(event) {
      const control = event.target.closest?.("[data-read-focus]");
      if (!control || control.disabled) return;
      if (control.dataset.readFocus === "filter") {
        event.preventDefault();
        unreadOnly = !unreadOnly;
        paint();
        return;
      }
      if (control.closest(".reader-read-controls")) event.preventDefault();
      const ids = idsFrom(control).filter((id) => answers().some((message) => message.id === id));
      if (ids.length) toggle(ids);
    }
    main.addEventListener("click", onClick);
    sidebar.addEventListener("click", onClick);
    async function load(conversationKey, nextMessages, writable = true) {
      const mine = ++revision;
      key = conversationKey;
      enabled = writable;
      messages = nextMessages;
      records = [];
      unreadOnly = false;
      hashes = new Map(await Promise.all(nextMessages.filter((message) => message.role === "assistant").map(async (message) => [message.id, await hash(message.text)])));
      if (mine !== revision) return;
      if (!writable) { paint(); return; }
      try {
        await store.pruneReads(conversationKey, [...hashes.keys()], false);
        if (mine !== revision) return;
        records = await store.getReads(conversationKey);
      } catch (error) {
        if (mine !== revision) return;
        enabled = false;
        report(t("readerReadFailed", error.message), true);
      }
      if (mine === revision) paint();
    }
    function unload() {
      revision += 1;
      key = null;
      enabled = false;
      busy = false;
      messages = [];
      records = [];
      hashes = new Map();
      unreadOnly = false;
      clear(main);
      sidebar.querySelector(".reader-read-filter")?.remove();
      sidebar.querySelector(".reader-no-unread")?.remove();
      for (const node of sidebar.querySelectorAll(".reader-read-toc")) node.remove();
    }
    store.subscribe((changedKey, topic) => {
      if (topic !== "reads" || changedKey !== key || busy) return;
      const mine = ++revision;
      void store.getReads(key).then((loaded) => {
        if (mine !== revision || changedKey !== key) return;
        records = loaded;
        paint();
      }).catch((error) => {
        if (mine === revision) report(t("readerReadFailed", error.message), true);
      });
    });
    globalThis.addEventListener?.("beforeunload", (event) => {
      if (busy) { event.preventDefault(); event.returnValue = ""; }
    });
    return {
      load, unload, clear, canLeave: () => !busy,
      setLocked(value) { locked = value; if (key) paint(); }
    };
  }
  globalThis.ChatGPTReaderReads = { init, clear };
})();
