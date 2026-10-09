/* Opening a conversation and reading it are separate interface states. */
(() => {
  "use strict";
  function init({ document, isBusy }) {
    const { t, language } = globalThis.ChatGPTPdfI18n;
    const get = (id) => document.getElementById(id);
    const workspace = get("reader-workspace"), toggle = get("reader-open");
    const close = get("reader-workspace-close"), heading = get("reader-heading");
    const meta = get("reader-meta"), current = get("reader-current");
    const status = get("export-status");
    let conversation = null, statusTimer;
    function showWorkspace(open, focus = false) {
      workspace.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      close.hidden = !conversation;
      if (focus) (open ? get("conversation-url") : toggle).focus({ preventScroll: true });
    }
    function opening() {
      conversation = null;
      document.body.dataset.readerState = "opening";
      heading.textContent = t("exportHeading");
      heading.title = "";
      meta.hidden = true; current.hidden = true; toggle.hidden = true;
      showWorkspace(true);
    }
    function reading(payload, saved = true) {
      conversation = payload;
      document.body.dataset.readerState = "reading";
      heading.textContent = payload.title;
      heading.title = payload.title;
      meta.textContent = t("readerDocumentMeta", payload.completeness.questions, payload.messages.length,
        saved ? t("readerLocalVersion", new Date(payload.capturedAt).toLocaleDateString(language)) : t("readerNotSaved"));
      meta.hidden = false;
      const link = get("reader-current-link");
      link.href = payload.sourceUrl; link.textContent = t("originalLink");
      current.hidden = false; toggle.hidden = false;
      get("reader-library").open = true;
      showWorkspace(false);
    }
    function notice(error = false, transient = false) {
      clearTimeout(statusTimer);
      status.hidden = !status.textContent;
      if (!error && transient) statusTimer = setTimeout(() => { status.hidden = true; }, 4500);
    }
    function clearNotice() {
      clearTimeout(statusTimer); status.hidden = true;
    }
    toggle.addEventListener("click", () => {
      if (!isBusy()) showWorkspace(workspace.hidden, true);
    });
    close.addEventListener("click", () => { if (!isBusy()) showWorkspace(false, true); });
    workspace.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && conversation && !isBusy()) {
        event.preventDefault(); showWorkspace(false, true);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (conversation && !workspace.hidden && !isBusy() &&
          !workspace.contains(event.target) && !toggle.contains(event.target)) showWorkspace(false);
    });
    get("reader-library").open = true;
    opening(); clearNotice();
    return { opening, reading, notice, clearNotice };
  }
  globalThis.ChatGPTReaderWorkspace = { init };
})();
