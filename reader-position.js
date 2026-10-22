/* Resume a local conversation by message and paragraph, without changing its URL or transcript. */
(() => {
  "use strict";
  function init({ main, store = globalThis.ChatGPTReaderStore, report = () => {} }) {
    const document = main.ownerDocument, view = document.defaultView;
    const bar = document.querySelector(".reader-bar");
    let key = null, messages = [], visible = null, enabled = false, locked = false;
    let revision = 0, timer = null, pending = Promise.resolve(), signature = "", restoring = false, interrupted = false;
    let activity = 0, waitingActivity = null;
    // Browser pixel restoration runs before this asynchronously rendered document exists.
    if ("scrollRestoration" in view.history) view.history.scrollRestoration = "manual";
    const excerpt = node => node.textContent.slice(0, 640).replace(/\s+/g, " ").trim().slice(0, 160);
    const line = () => Math.max(0, bar?.getBoundingClientRect().bottom || 0) + 24;
    function capture() {
      if (!key || !enabled || locked || main.hidden || restoring) return null;
      visible ||= messages.filter(node => !node.hidden &&
        !(node.classList.contains("pdf-assistant") && node.dataset.readerFolded === "true"));
      const at = line();
      let low = 0, high = visible.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (visible[middle].getBoundingClientRect().bottom <= at) low = middle + 1; else high = middle;
      }
      const section = visible[Math.min(low, visible.length - 1)];
      if (!section || !section.getBoundingClientRect().height) return null;
      const blocks = [...section.querySelector(".pdf-message-body").children];
      const block = section.dataset.readerFolded === "true" ? null :
        blocks.find(node => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().bottom > at) || blocks.at(-1);
      const rect = (block || section).getBoundingClientRect();
      let question = section;
      while (question && !question.classList.contains("pdf-user")) question = question.previousElementSibling;
      return { messageId: section.dataset.messageId, questionId: question?.dataset.messageId || "",
        blockIndex: block ? blocks.indexOf(block) : -1, excerpt: block ? excerpt(block) : "",
        fraction: Math.max(0, Math.min(1, (at - rect.top) / Math.max(1, rect.height))),
        gap: Math.max(0, Math.min(10000, rect.top - at)), atStart: view.scrollY <= 0, hash: view.location.hash };
    }
    function save(position) {
      const serialized = JSON.stringify(position);
      if (!position || serialized === signature) return pending;
      signature = serialized;
      const current = key, mine = revision;
      pending = pending.then(() => store.saveReaderState(current, { position })).catch(error => {
        if (revision === mine) {
          enabled = false;
          report(globalThis.ChatGPTPdfI18n.t("readerSaveFailed", error.message), true);
        }
      });
      return pending;
    }
    function flush() {
      view.clearTimeout(timer); timer = null;
      return save(capture());
    }
    function schedule() {
      if (!key || !enabled || locked || restoring || timer !== null) return;
      // Throttle, rather than wait for scrolling to stop: long scrolls are saved too.
      timer = view.setTimeout(() => { timer = null; void flush(); }, 400);
    }
    function unload() {
      const flushed = flush();
      revision++; key = null; enabled = false; messages = []; visible = null; restoring = false;
      waitingActivity = activity;
      return flushed;
    }
    function locate(position) {
      const section = messages.find(node => node.dataset.messageId === position.messageId) ||
        messages.find(node => node.dataset.messageId === position.questionId);
      if (!section) return null;
      if (section.dataset.messageId !== position.messageId || position.blockIndex < 0 || section.dataset.readerFolded === "true") {
        return { node: section, fraction: 0, gap: 0 };
      }
      const blocks = [...section.querySelector(".pdf-message-body").children];
      let node = blocks[position.blockIndex];
      if (position.excerpt && (!node || excerpt(node) !== position.excerpt)) {
        const matching = blocks.filter(block => excerpt(block) === position.excerpt);
        if (matching.length === 1) node = matching[0];
      }
      return { node: node || section, fraction: node ? position.fraction : 0, gap: node ? position.gap : 0 };
    }
    async function load(conversationKey, position, writable = true, { fallbackTop = 0 } = {}) {
      const since = waitingActivity ?? activity;
      await unload();
      key = conversationKey; enabled = writable; messages = [...main.querySelectorAll(":scope > .pdf-message")];
      signature = JSON.stringify(position || null); visible = null;
      const mine = revision;
      restoring = true; interrupted = activity !== since; waitingActivity = null;
      // Embedded pictures may finish decoding after fonts and Markdown. Wait briefly
      // before measuring; never correct the viewport after the user starts reading.
      let timeout;
      await Promise.race([
        Promise.all([...main.querySelectorAll("img")].filter(image => !image.complete)
          .map(image => image.decode?.().catch(() => {}))),
        new Promise(resolve => { timeout = view.setTimeout(resolve, 1200); })
      ]);
      view.clearTimeout(timeout);
      await new Promise(resolve => view.requestAnimationFrame(resolve));
      if (mine !== revision) return;
      if (!interrupted) {
        let target;
        try { target = document.getElementById(decodeURIComponent(view.location.hash.slice(1))); } catch (_) { /* Invalid fragment. */ }
        const explicit = target && main.contains(target) && (!position || view.location.hash !== position.hash);
        if (explicit) {
          globalThis.ChatGPTReaderFolds?.reveal(target);
          target.scrollIntoView({ block: "start", behavior: "instant" });
        } else if (position && !position.atStart) {
          const located = locate(position);
          if (located) {
            // A separately saved fold choice wins over an old position inside its answer.
            let node = located.node;
            if (node.classList.contains("pdf-assistant") && node.dataset.readerFolded === "true") {
              node = messages.find(message => message.dataset.messageId === position.questionId) || node;
            }
            const rect = node.getBoundingClientRect();
            view.scrollTo({ top: Math.max(0, view.scrollY + rect.top + located.fraction * rect.height - line() - located.gap), behavior: "instant" });
          } else view.scrollTo({ top: 0, behavior: "instant" });
        } else view.scrollTo({ top: fallbackTop, behavior: "instant" });
      }
      restoring = false;
      view.dispatchEvent(new view.Event("scroll"));
    }
    view.addEventListener("scroll", schedule, { passive: true });
    main.addEventListener("reader-fold-change", () => { visible = null; schedule(); });
    view.addEventListener("resize", () => { visible = null; });
    view.addEventListener("pagehide", flush);
    view.addEventListener("beforeprint", () => { void flush(); locked = true; });
    view.addEventListener("afterprint", () => { locked = false; visible = null; });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
      view.addEventListener(type, () => { activity++; if (restoring) interrupted = true; }, { passive: true, capture: true });
    }
    return { load, unload, flush,
      setLocked(value) { if (value && !locked) void flush(); locked = value; }
    };
  }
  globalThis.ChatGPTReaderPosition = { init };
})();
