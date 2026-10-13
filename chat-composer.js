/* Use only ChatGPT's visible composer controls. Never call a private send API. */
(() => {
  "use strict";
  const { t } = globalThis.ChatGPTPdfI18n;
  let prepared = null, committed = new Set();
  const fail = (key, code = key) => { const error = new Error(t(key)); error.code = code; throw error; };
  function assertSource(source) {
    const target = globalThis.ChatGPTPdfSource.parseUrl(source);
    if (target.kind !== "c" || target.url !== globalThis.ChatGPTPdfSource.parseUrl(location.href).url) fail("chatWrongConversation");
  }
  function controls() {
    const scope = document.querySelector('main') || document;
    const inputs = [...scope.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], [data-composer-markdown][contenteditable="true"][role="textbox"]')]
      .filter(node => node.matches('textarea, [contenteditable="true"]') && node.getAttribute('aria-disabled') !== 'true' &&
        !node.closest('[hidden]') && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
    if (inputs.length !== 1) fail("chatComposerUnavailable");
    const input = inputs[0];
    const form = input.closest('form');
    const buttons = [...(form || scope).querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"], button[aria-label="发送消息"], button[aria-label="发送"], button[aria-label="Send"]' +
      (form ? ', button[type="submit"]' : ''))]
      .filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.closest('[hidden]') &&
        getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
    return { input, button: buttons.length === 1 ? buttons[0] : null };
  }
  function text(input) { return (input.matches('textarea') ? input.value : input.innerText || input.textContent || '').replace(/\r\n/g, '\n').trim(); }
  function generating() {
    return Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="停止生成"], button[aria-label="停止"]'));
  }
  async function prepare(message) {
    assertSource(message.source);
    if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 26000 || typeof message.requestId !== 'string') fail("chatInvalidPrompt");
    const payload = await globalThis.ChatGPTPdfSource.read(message.source, { includeAssets: false });
    assertSource(message.source);
    if (payload.completeness.lastMessageId !== message.headId) fail("chatBranchChanged");
    if (generating()) fail("chatAlreadyGenerating");
    let input;
    const until = Date.now() + 10000;
    while (!input) {
      try { input = controls().input; }
      catch (error) { if (Date.now() >= until) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
      assertSource(message.source);
    }
    if (text(input)) fail("chatComposerNotEmpty");
    prepared = { source: message.source, prompt: message.prompt.trim(), requestId: message.requestId, headId: message.headId, input };
    input.focus({ preventScroll: true });
    return { ready: true };
  }
  async function commit(message) {
    assertSource(message.source);
    if (!prepared || prepared.requestId !== message.requestId || prepared.source !== message.source || committed.has(message.requestId)) fail("chatSendUncertain");
    const current = await globalThis.ChatGPTPdfSource.read(message.source, { includeAssets: false });
    assertSource(message.source);
    if (current.completeness.lastMessageId !== prepared.headId || generating()) fail("chatBranchChanged");
    const { input, button } = controls();
    if (input !== prepared.input || text(input) !== prepared.prompt || !button) fail("chatComposerUnavailable");
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
    if (user.text.trim() !== message.prompt.trim() || message.userId && user.id !== message.userId) fail("chatBranchChanged");
    if (added.filter(item => item.role === 'user').length !== 1) fail("chatBranchChanged");
    const answers = added.filter(item => item.role === 'assistant');
    if (generating() || !answers.length) return { generating: true, userId: user.id };
    return { complete: true, userId: user.id, payload, answers };
  }
  globalThis.ChatGPTReaderComposer = { prepare, commit, inspect };
})();
