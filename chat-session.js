/* Each send owns a background tab. Existing user tabs and drafts are untouched. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scripts = ["i18n.js", "layout-markdown.js", "conversation-images.js", "dom-adapter.js", "conversation-source.js", "chat-composer.js", "content.js"];
  let busy = false;
  function error(key, uncertain = false) { const result = new Error(t(key)); result.uncertain = uncertain; return result; }
  async function send(payload, pending, options = {}) {
    const run = () => sendOwned(payload, pending, options);
    const locks = globalThis.navigator?.locks;
    if (!locks) throw error("chatLockUnavailable");
    return locks.request("chatgpt-reader-send:" + globalThis.ChatGPTPdfSource.parseUrl(payload.sourceUrl).url,
      { ifAvailable: true }, lock => { if (!lock) throw error("chatBusy"); return run(); });
  }
  async function sendOwned(payload, pending, { checking = false, beforeCommit = async () => {}, onState = () => {}, timeout = 600000, interval = 2000, responseTimeout = 45000 } = {}) {
    if (busy) throw error("chatBusy");
    const source = globalThis.ChatGPTPdfSource.parseUrl(payload.sourceUrl);
    if (source.kind !== "c") throw error("chatSharedReadOnly");
    busy = true;
    let tab, target, attached = false, committed = checking, complete = false;
    const detachOnLeave = () => { if (attached) chrome.debugger.detach(target).catch(() => {}); };
    function bounded(promise, limit = responseTimeout) {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error("chatReplyTimeout", committed)), limit); })])
        .finally(() => clearTimeout(timer));
    }
    async function verifyTab() {
      const current = await chrome.tabs.get(tab.id);
      if (globalThis.ChatGPTPdfSource.parseUrl(current.url).url !== source.url) throw error("chatWrongConversation", committed);
      return current;
    }
    async function request(type) {
      await verifyTab();
      const response = await bounded(chrome.tabs.sendMessage(tab.id, { type, source: source.url, ...pending,
        expiresAt: Date.now() + responseTimeout }));
      if (!response?.ok) {
        const failed = new Error(response?.error || t("chatSendUncertain"));
        failed.uncertain = committed;
        if (type === "CHAT_COMMIT" && response?.ok === false && !response.uncertain) {
          failed.uncertain = false; committed = false;
        }
        throw failed;
      }
      return response;
    }
    try {
      onState("connecting");
      tab = await chrome.tabs.create({ url: source.url, active: false });
      const deadline = Date.now() + 45000;
      while ((await verifyTab()).status !== "complete") {
        if (Date.now() > deadline) throw error("chatComposerUnavailable", committed);
        await sleep(250);
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: scripts });
      if (!checking) {
        onState("preparing");
        await request("CHAT_PREPARE");
        target = { tabId: tab.id };
        if (!chrome.debugger) throw error("chatDebuggerRequired");
        try { await chrome.debugger.attach(target, "1.3"); }
        catch (_) { throw error("chatDebuggerRequired"); }
        attached = true;
        globalThis.addEventListener("pagehide", detachOnLeave);
        await verifyTab();
        await chrome.debugger.sendCommand(target, "Input.insertText", { text: pending.prompt });
        await beforeCommit();
        onState("sending");
        committed = true;
        await request("CHAT_COMMIT");
        await chrome.debugger.detach(target); attached = false;
      }
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const state = await request("CHAT_INSPECT");
        if (state.userId) pending.userId = state.userId;
        onState(state.generating ? "generating" : "waiting");
        if (state.complete) {
          const response = await bounded(chrome.tabs.sendMessage(tab.id, { type: "READ_FULL_CONVERSATION", source: source.url, allowImageScroll: true }), 180000);
          if (!response?.ok) throw error("chatReplyReadFailed", true);
          const next = response.payload;
          const head = next.messages.findIndex(item => item.id === pending.headId);
          const added = next.messages.slice(head + 1);
          if (next.sourceUrl !== source.url || head < 0 || added.find(item => item.role === "user")?.id !== state.userId ||
              added.find(item => item.role === "user")?.text.trim() !== pending.prompt.trim() ||
              added.filter(item => item.role === "user").length !== 1) throw error("chatBranchChanged", true);
          if (response.missingImages) await globalThis.ChatGPTImageResources?.capture(tab.id, source.url, next).catch(() => {});
          globalThis.ChatGPTConversationImages.preserve(next, payload);
          for (const message of next.messages) delete message.imageSources;
          complete = true;
          return { payload: next, userId: state.userId, answers: added.filter(item => item.role === "assistant") };
        }
        await sleep(interval);
      }
      throw error("chatReplyTimeout", true);
    } catch (failed) {
      if (failed.uncertain === undefined) failed.uncertain = committed;
      failed.tabId = tab?.id;
      throw failed;
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => {});
      globalThis.removeEventListener("pagehide", detachOnLeave);
      // A submitted generation may still be running. Keep its tab on failure;
      // the user can inspect the original conversation, without another send.
      if (tab && (checking || !committed || complete)) await chrome.tabs.remove(tab.id).catch(() => {});
      busy = false;
    }
  }
  globalThis.ChatGPTReaderChatSession = { send };
})();
