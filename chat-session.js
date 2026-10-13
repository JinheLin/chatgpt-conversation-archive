/* Each send owns a background tab. Existing user tabs and drafts are untouched. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scripts = ["i18n.js", "layout-markdown.js", "conversation-images.js", "dom-adapter.js", "conversation-source.js", "chat-text.js", "chat-composer.js", "content.js"];
  let busy = false;
  function error(key, uncertain = false) { const result = new Error(t(key)); result.uncertain = uncertain; return result; }
  async function send(payload, pending, options = {}) {
    const run = () => sendOwned(payload, pending, options);
    const locks = globalThis.navigator?.locks;
    if (!locks) throw error("chatLockUnavailable");
    return locks.request("chatgpt-reader-send:" + globalThis.ChatGPTPdfSource.parseUrl(payload.sourceUrl).url,
      { ifAvailable: true }, lock => { if (!lock) throw error("chatBusy"); return run(); });
  }
  async function sendOwned(payload, pending, { checking = false, beforeCommit = async () => {}, onState = () => {}, timeout = 600000, interval = 2000, responseTimeout = 45000, loadTimeout = 45000, loadInterval = 250 } = {}) {
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
    function matchesSource(value) {
      try { return globalThis.ChatGPTPdfSource.parseUrl(value).url === source.url; }
      catch (_) { return false; }
    }
    async function waitForTab() {
      const deadline = Date.now() + loadTimeout;
      while (true) {
        const current = await chrome.tabs.get(tab.id);
        // url is the last committed address. A newly created tab can still
        // report an empty/about:blank URL or complete status while pendingUrl
        // points to the requested conversation. Neither permits injection.
        if (current.pendingUrl && !matchesSource(current.pendingUrl)) throw error("chatWrongConversation", committed);
        const blank = !current.url || current.url === "about:blank";
        if (current.status === "complete" && !current.pendingUrl && !blank) {
          if (!matchesSource(current.url)) throw error("chatWrongConversation", committed);
          return;
        }
        if (Date.now() >= deadline) throw error("chatConversationLoadTimeout", committed);
        await sleep(loadInterval);
      }
    }
    async function verifyTab() {
      const current = await chrome.tabs.get(tab.id);
      if (current.status !== "complete" || current.pendingUrl || !matchesSource(current.url)) throw error("chatWrongConversation", committed);
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
      await waitForTab();
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: scripts });
      if (!checking) {
        onState("preparing");
        const ready = await request("CHAT_PREPARE");
        if (ready.alreadySubmitted) pending.userId = ready.userId;
        else if (!ready.alreadyEntered) {
          target = { tabId: tab.id };
          if (!chrome.debugger) throw error("chatDebuggerRequired");
          try { await chrome.debugger.attach(target, "1.3"); }
          catch (_) { throw error("chatDebuggerRequired"); }
          attached = true;
          globalThis.addEventListener("pagehide", detachOnLeave);
          await verifyTab();
          await chrome.debugger.sendCommand(target, "Input.insertText", { text: pending.prompt });
        }
        await beforeCommit();
        onState(ready.alreadySubmitted ? "recovering" : "sending");
        committed = true;
        if (!ready.alreadySubmitted) await request("CHAT_COMMIT");
        if (attached) { await chrome.debugger.detach(target); attached = false; }
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
              !globalThis.ChatGPTReaderChatText.same(added.find(item => item.role === "user")?.text, pending.prompt) ||
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
      if (tab && (checking || !committed || complete)) {
        // A user may select or repurpose the temporary tab while we work.
        // Close only a still-background tab at the exact requested conversation.
        const current = await chrome.tabs.get(tab.id).catch(() => null);
        if (current && !current.active && matchesSource(current.pendingUrl || current.url)) {
          await chrome.tabs.remove(tab.id).catch(() => {});
        }
      }
      busy = false;
    }
  }
  globalThis.ChatGPTReaderChatSession = { send };
})();
