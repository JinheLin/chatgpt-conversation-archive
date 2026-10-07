/* This bridge runs in Chrome's isolated content-script world. */
(() => {
  "use strict";
  globalThis.ChatGPTPdfContentController?.destroy();
  function removeLegacyControls() {
    document.getElementById("chatgpt-pdf-export-btn")?.remove();
    document.getElementById("chatgpt-pdf-export-status")?.remove();
  }
  removeLegacyControls();

  function onMessage(message, sender, respond) {
    if (sender.id !== chrome.runtime.id || message?.type !== "READ_FULL_CONVERSATION") return false;
    globalThis.ChatGPTPdfSource.read(message.source || location.href).then((payload) => {
      respond({ ok: true, payload });
    }).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onMessage);
  globalThis.ChatGPTPdfContentController = {
    destroy() {
      try { chrome.runtime.onMessage.removeListener(onMessage); } catch (_) { /* extension reloaded */ }
      removeLegacyControls();
    }
  };
})();
