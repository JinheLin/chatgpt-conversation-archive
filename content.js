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
    const onProgress = (progress) => {
      if (typeof message.readId !== "string") return;
      // Progress contains only stage/count metadata; never credentials or conversation text.
      chrome.runtime.sendMessage({ type: "READ_PROGRESS", readId: message.readId, progress }).catch(() => {});
    };
    globalThis.ChatGPTPdfSource.read(message.source || location.href, { onProgress, allowImageScroll: message.allowImageScroll === true }).then((payload) => {
      const missingImages = payload.messages.some(item =>
        globalThis.ChatGPTConversationImages.slots(item.text).length > (item.layoutImages?.length || 0));
      respond({ ok: true, payload, missingImages });
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
