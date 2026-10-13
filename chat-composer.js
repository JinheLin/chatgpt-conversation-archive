/* Use only ChatGPT's visible composer controls. Never call a private send API. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  const chatText = globalThis.ChatGPTReaderChatText;
  let prepared = null, committed = new Set();
  const fail = (key, code = key) => { const error = new Error(t(key)); error.code = code; throw error; };
  function assertSource(source) {
    const target = globalThis.ChatGPTPdfSource.parseUrl(source);
    if (target.kind !== "c" || target.url !== globalThis.ChatGPTPdfSource.parseUrl(location.href).url) fail("chatWrongConversation");
  }
  function controls() {
    const inputs = [...document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], [data-composer-markdown][contenteditable], [data-composer-input] [role="textbox"][contenteditable]')]
      .filter(node => (node.matches('textarea') || ['', 'true', 'plaintext-only'].includes(node.getAttribute('contenteditable'))) &&
        !node.disabled && node.getAttribute('aria-disabled') !== 'true' && visible(node));
    if (inputs.length !== 1) fail("chatComposerUnavailable");
    const input = inputs[0];
    const form = input.closest('form');
    const buttons = [...(form || document).querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="发送"], button[aria-label="Send"]' +
      (form ? ', button[type="submit"]' : ''))]
      .filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true' && visible(node));
    return { input, button: buttons.length === 1 ? buttons[0] : null };
  }
  function visible(node) {
    if (!node.isConnected) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    return true;
  }
  function text(input) { return chatText.read(input).trim(); }
  function generating() {
    return [...document.querySelectorAll('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止"]')].some(visible);
  }
  async function waitControls(message, { sending = false, timeout = 10000, interval = 200 } = {}) {
    const deadline = Math.min(Date.now() + timeout, Number.isFinite(message.expiresAt) ? message.expiresAt : Infinity);
    let reason = 'chatComposerUnavailable';
    while (true) {
      assertSource(message.source);
      if (Number.isFinite(message.expiresAt) && Date.now() >= message.expiresAt) fail('chatSendUncertain');
      let current;
      try { current = controls(); } catch (_) { reason = 'chatComposerUnavailable'; }
      if (current) {
        if (!sending) return current;
        if (!chatText.same(text(current.input), message.prompt)) reason = 'chatInputMismatch';
        else if (!current.button) reason = 'chatSendButtonUnavailable';
        else return current;
      }
      if (Date.now() >= deadline) fail(reason);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  async function prepare(message, options = {}) {
    assertSource(message.source);
    if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 26000 || typeof message.requestId !== 'string') fail("chatInvalidPrompt");
    prepared = null;
    const payload = await globalThis.ChatGPTPdfSource.read(message.source, { includeAssets: false });
    assertSource(message.source);
    if (payload.completeness.lastMessageId !== message.headId) {
      const head = payload.messages.findIndex(item => item.id === message.headId);
      const added = head >= 0 ? payload.messages.slice(head + 1) : [];
      const user = added.find(item => item.role === 'user');
      // The previous attempt may already have reached ChatGPT. Read it rather
      // than submitting the same question again against a stale local snapshot.
      if (user && chatText.same(user.text, message.prompt) && added.filter(item => item.role === 'user').length === 1) {
        return { ready: true, alreadySubmitted: true, userId: user.id };
      }
      fail("chatBranchChanged");
    }
    if (generating()) fail("chatAlreadyGenerating");
    const { input } = await waitControls(message, options);
    const entered = text(input);
    if (entered && !chatText.same(entered, message.prompt)) fail("chatComposerNotEmpty");
    prepared = { source: message.source, prompt: message.prompt.trim(), requestId: message.requestId, headId: message.headId };
    input.focus({ preventScroll: true });
    return { ready: true, alreadyEntered: Boolean(entered) };
  }
  async function commit(message, options = {}) {
    assertSource(message.source);
    if (!prepared || prepared.requestId !== message.requestId || prepared.source !== message.source || committed.has(message.requestId)) fail("chatSendUncertain");
    await waitControls({ ...message, prompt: prepared.prompt }, { ...options, sending: true });
    const current = await globalThis.ChatGPTPdfSource.read(message.source, { includeAssets: false });
    assertSource(message.source);
    if (current.completeness.lastMessageId !== prepared.headId || generating()) fail("chatBranchChanged");
    const { input, button } = controls();
    if (!chatText.same(text(input), prepared.prompt)) fail("chatInputMismatch");
    if (!button) fail("chatSendButtonUnavailable");
    // A delayed branch check must not click after the reader has timed out.
    if (!Number.isFinite(message.expiresAt) || Date.now() >= message.expiresAt) fail("chatSendUncertain");
    // Mark before clicking. An ambiguous click result must never be retried.
    committed.add(message.requestId);
    prepared = null;
    try { button.click(); }
    catch (error) { error.uncertain = true; throw error; }
    return { submitted: true };
  }
  async function inspect(message) {
    assertSource(message.source);
    let payload;
    try { payload = await globalThis.ChatGPTPdfSource.read(message.source, { includeAssets: false }); }
    catch (error) { if (error.code === 'GENERATING') return { generating: true }; throw error; }
    const head = payload.messages.findIndex(item => item.id === message.headId);
    if (head < 0) fail("chatBranchChanged");
    const added = payload.messages.slice(head + 1);
    const user = added.find(item => item.role === 'user');
    if (!user) return { waiting: true };
    if (!chatText.same(user.text, message.prompt) || message.userId && user.id !== message.userId) fail("chatBranchChanged");
    if (added.filter(item => item.role === 'user').length !== 1) fail("chatBranchChanged");
    const answers = added.filter(item => item.role === 'assistant');
    if (generating() || !answers.length) return { generating: true, userId: user.id };
    return { complete: true, userId: user.id, payload, answers };
  }
  globalThis.ChatGPTReaderComposer = { prepare, commit, inspect };
})();
