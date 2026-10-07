/* This bridge runs in Chrome's isolated content-script world. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  // Cache this hint before a reload invalidates the old extension context.
  const refreshHint = t("refreshPage");
  globalThis.ChatGPTPdfContentController?.destroy();
  const BUTTON_ID = "chatgpt-pdf-export-btn";
  const STATUS_ID = "chatgpt-pdf-export-status";
  document.getElementById(BUTTON_ID)?.remove();
  document.getElementById(STATUS_ID)?.remove();
  let queued = false;
  let destroyed = false;

  function status(text, error = false) {
    if (destroyed || !document.body) return;
    let node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = STATUS_ID;
      node.setAttribute("role", "status");
      document.body.appendChild(node);
    }
    node.dataset.level = error ? "error" : "info";
    node.textContent = text;
  }
  async function open() {
    try {
      // ChatGPT navigates without reloading; sender.url can still be the initial homepage.
      const response = await chrome.runtime.sendMessage({ type: "OPEN_EXPORT_PAGE", source: location.href });
      if (!response?.ok) throw new Error(response?.error || t("openExporterFailed"));
    } catch (_) { status(refreshHint, true); }
  }
  function update() {
    queued = false;
    if (destroyed || !document.body) return;
    if (!globalThis.ChatGPTPdfDomAdapter.isConversationPage() && !/^\/share\//.test(location.pathname)) {
      document.getElementById(BUTTON_ID)?.remove();
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = t("exportButton");
    button.addEventListener("click", open);
    document.body.appendChild(button);
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  function onMessage(message, sender, respond) {
    if (sender.id !== chrome.runtime.id || message?.type !== "READ_FULL_CONVERSATION") return false;
    status(t("readingContent"));
    globalThis.ChatGPTPdfSource.read(message.source || location.href).then((payload) => {
      status(t("chainVerified", payload.messages.length));
      respond({ ok: true, payload });
    }).catch((error) => { status(error.message, true); respond({ ok: false, error: error.message }); });
    return true;
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.ChatGPTPdfContentController = {
    destroy() {
      destroyed = true;
      observer.disconnect();
      try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) { /* extension reloaded */ }
      document.getElementById(BUTTON_ID)?.remove();
      document.getElementById(STATUS_ID)?.remove();
    }
  };
  update();
})();
