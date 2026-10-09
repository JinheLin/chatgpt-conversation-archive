const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');
const { installI18n, catalogs } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');
const conversationUrl = 'https://chatgpt.com/c/test-conversation';
const response = { ok: true, payload: {
  title: 'Test conversation', sourceUrl: conversationUrl, messages: [{ role: 'user', text: 'Question' }], completeness: { questions: 1 }
} };

function fixture(tabs, readResponse = Promise.resolve(response), output = {}) {
  const elements = new Map();
  const created = [], removed = [], activated = [], requests = [];
  const downloads = [];
  const progressListeners = new Set();
  let notifyReading;
  const reading = new Promise(resolve => { notifyReading = resolve; });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'conversation-url' ? (output.inputValue ?? (output.initialSource ? '' : conversationUrl)) : 'portrait',
      checked: false,
      dataset: {}, style: {}, handlers: {}, hidden: false,
      ownerDocument: context.document,
      setAttribute(name, value) { this[name] = String(value); },
      removeAttribute(name) { delete this[name]; },
      focus() { context.document.activeElement = this; },
      contains(node) { return node === this; },
      querySelectorAll(selector) { return selector === '.pdf-toc li a' ? [{ textContent: 'Question', getAttribute: () => '#question-1' }] : []; },
      addEventListener(type, handler) { this.handlers[type] = handler; }
    });
    return elements.get(id);
  }
  const event = { addListener() {}, removeListener() {} };
  class DownloadURL extends URL {
    static createObjectURL() { return 'blob:test-pdf'; }
    static revokeObjectURL() {}
  }
  const localized = [...fs.readFileSync(path.join(project, 'print.html'), 'utf8').matchAll(/data-i18n="([^"]+)"/g)]
    .map((match) => ({ textContent: '', getAttribute: () => match[1] }));
  const context = vm.createContext({
    URL: DownloadURL, URLSearchParams, Date, Blob, crypto: webcrypto,
    setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); return timer; }, clearTimeout,
    location: { search: output.initialSource ? `?${new URLSearchParams({ source: output.initialSource })}` : '' },
    fetch: async url => ({ ok: !output.catalogFailure, status: 404, json: async () => url.includes('/zh_CN/') ? catalogs.zh_CN : catalogs.en }),
    document: {
      getElementById: element, fonts: { ready: Promise.resolve() }, documentElement: {}, querySelectorAll: () => localized,
      addEventListener() {},
      createElement: () => { const link = { click() { downloads.push(link.download); } }; return link; }
    },
    chrome: {
      runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`,
        onMessage: { addListener: listener => progressListeners.add(listener) } },
      tabs: {
        query: async () => tabs,
        create: async options => { created.push(options); return { id: 90 }; },
        get: async () => ({ status: 'complete' }),
        getCurrent: async () => ({ id: 10 }),
        remove: async id => { removed.push(id); },
        update: async (id, options) => { activated.push({ id, ...options }); },
        onUpdated: event, onRemoved: event,
        sendMessage: (id, message) => {
          requests.push({ id, message });
          notifyReading();
          return readResponse;
        }
      },
      scripting: { executeScript: async () => {} }
    },
    ChatGPTPdfExporter: { render: output.render || ((payload, main) => { main.hidden = false; return []; }), fitCode: output.fit || (() => {}) },
    ChatGPTPdfPreviewNavigation: { init: ({ sidebar, layout }) => {
      const clear = () => { sidebar.hidden = layout.hidden = true; };
      clear();
      return { clear, refresh: () => { sidebar.hidden = layout.hidden = false; } };
    } },
    ChatGPTPdfCapture: { capture: output.capture || (async () => new Uint8Array([1, 2, 3])) },
    ChatGPTPdfOutline: { add: output.add || (async () => ({ bytes: new Uint8Array([1, 2, 3]), questions: 1, pages: 2 })) }
  });
  installI18n(context, output.locale || 'en-US');
  if (output.staleLocale) {
    const original = context.chrome.i18n.getMessage;
    context.chrome.i18n.getMessage = (key, ...args) => ['savePdf', 'directPdfHint', 'pdfFallbackHeading'].includes(key) ? '' : original(key, ...args);
  }
  vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(project, 'export-menu.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(project, 'read-progress.js'), 'utf8'), context);
  const initialized = vm.runInContext(fs.readFileSync(path.join(project, 'print.js'), 'utf8'), context);
  return { created, removed, activated, requests, reading, element, downloads, initialized,
    progress: (progress, options = {}) => {
      const request = requests.at(-1);
      for (const listener of progressListeners) listener(
        { type: 'READ_PROGRESS', readId: options.readId ?? request.message.readId, progress },
        { id: options.extensionId ?? 'test-extension', tab: { id: options.tabId ?? request.id } });
    },
    start: async () => { await initialized; return element('export-form').handlers.submit({ preventDefault() {} }); },
    cancel: () => element('cancel-export').handlers.click()
};
}

for (const locale of ['en-US', 'zh-CN']) {
  test(`reading shows workflow percentages, ignores unrelated or late updates, and completes at 100% (${locale})`, async () => {
    let finish;
    const app = fixture([{ id: 20, url: conversationUrl }], new Promise(resolve => { finish = resolve; }), { locale });
    const pending = app.start();
    await app.reading;
    assert.equal(app.element('preview-layout').hidden, true);
    assert.equal(app.element('read-progress').hidden, false);
    assert.equal(app.element('export-status').hidden, true);
    assert.equal(app.element('read-progress-bar').value, 10);
    assert.equal(app.element('read-progress-count').textContent, '10%');
    assert.match(app.element('read-progress-label').textContent, locale === 'zh-CN' ? /登录状态/ : /login session/);
    for (const options of [{ tabId: 123 }, { extensionId: 'other-extension' }, { readId: 'stale-read' }]) {
      app.progress({ stage: 'assets', completed: 3, total: 4 }, options);
      assert.equal(app.element('read-progress-bar').value, 10);
    }
    app.progress({ stage: 'complete' }); // Only the export page may finish the overall workflow.
    assert.equal(app.element('read-progress-bar').value, 10);
    app.progress({ stage: 'conversation' });
    assert.equal(app.element('read-progress-count').textContent, '20%');
    app.progress({ stage: 'verify' });
    assert.equal(app.element('read-progress-count').textContent, '55%');
    app.progress({ stage: 'assets', completed: 3, total: 4 });
    assert.equal(app.element('read-progress-bar').value, 75);
    assert.equal(app.element('read-progress-bar').max, 100);
    assert.equal(app.element('read-progress-count').textContent, '75%');
    assert.match(app.element('read-progress-label').textContent, locale === 'zh-CN' ? /附件/ : /attachments/);
    app.progress({ stage: 'verify' });
    app.progress({ stage: 'assets', completed: 1, total: 4 });
    assert.equal(app.element('read-progress-bar').value, 75);
    assert.equal(app.element('read-progress-count').textContent, '75%');
    app.progress({ stage: 'assets', completed: 4, total: 4 });
    assert.equal(app.element('read-progress-bar').value, 80);
    finish(response);
    await pending;
    assert.equal(app.element('preview-layout').hidden, false);
    assert.equal(app.element('preview-sidebar').hidden, false);
    assert.equal(app.element('read-progress').hidden, false);
    assert.equal(app.element('export-status').hidden, false);
    assert.equal(app.element('read-progress-count').textContent, '100%');
    assert.equal(app.element('read-progress-bar').value, 100);
    app.progress({ stage: 'assets', completed: 4, total: 4 });
    assert.equal(app.element('read-progress-count').textContent, '100%');
  });
}

test('read failure hides the progress bar and shows the error', async () => {
  let finish;
  const app = fixture([{ id: 20, url: conversationUrl }], new Promise(resolve => { finish = resolve; }));
  const pending = app.start();
  await app.reading;
  finish({ ok: false, error: 'Login expired' });
  await pending;
  assert.equal(app.element('read-progress').hidden, true);
  assert.ok(app.element('read-progress-bar').value < 100);
  assert.equal(app.element('export-status').hidden, false);
  assert.equal(app.element('export-status').textContent, 'Login expired');
  assert.equal(app.element('export-status').dataset.level, 'error');
  assert.equal(app.element('preview-layout').hidden, true);
});

test('cancelling while fitting code hides the document and ignores late completion', async () => {
  let fittingStarted, finishFitting;
  const fitting = new Promise(resolve => { fittingStarted = resolve; });
  const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), {
    render: (payload, main) => { main.hidden = false; return []; },
    fit: async (main, landscape, options) => {
      fittingStarted();
      await new Promise(resolve => { finishFitting = resolve; });
      options.onProgress({ completed: 1, total: 1 });
    }
  });
  const pending = app.start();
  await fitting;
  await app.cancel();
  finishFitting();
  await pending;
  assert.equal(app.element('pdf-document').hidden, true);
  assert.equal(app.element('preview-layout').hidden, true);
  assert.equal(app.element('output-actions').hidden, true);
  assert.equal(app.element('read-progress').hidden, true);
  assert.equal(app.element('export-status').textContent, 'Reading cancelled.');
});

for (const locale of ['en-US', 'zh-CN']) {
  test(`a source URL fills automatically and reads even with an old Chrome locale cache (${locale})`, async () => {
    const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), {
      initialSource: conversationUrl, staleLocale: true, locale
    });
    await app.initialized;
    assert.equal(app.element('conversation-url').value, conversationUrl);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].message.source, conversationUrl);
    assert.equal(app.created.length, 0);
    assert.equal(app.activated.length, 0);
    assert.match(app.element('export-status').textContent, locale === 'zh-CN' ? /校验通过/ : /verified/);
  });
}

test('without a source URL the page waits for a manually entered link', async () => {
  const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), { inputValue: '' });
  await app.initialized;
  assert.equal(app.element('conversation-url').value, '');
  assert.equal(app.requests.length, 0);
  app.element('conversation-url').value = conversationUrl;
  await app.start();
  assert.equal(app.requests.length, 1);
});

test('catalog loading failure preserves the entry link and displays an actionable startup error', async () => {
  const app = fixture([], Promise.resolve(response), { initialSource: conversationUrl, catalogFailure: true, locale: 'zh-CN' });
  await app.initialized;
  assert.equal(app.element('conversation-url').value, conversationUrl);
  assert.equal(app.requests.length, 0);
  assert.equal(app.element('export-status').dataset.level, 'error');
  assert.match(app.element('export-status').textContent, /重新加载插件/);
});

test('one PDF button captures the selected orientation and adds question bookmarks before downloading', async () => {
  let app;
  const options = {
    capture: async settings => {
      assert.equal(settings.landscape, true);
      for (const id of ['start-export', 'page-layout']) assert.equal(app.element(id).disabled, true);
      await app.start(); // Submitting the read form cannot replace the document mid-export.
      assert.equal(app.requests.length, 1);
      return new Uint8Array([5, 6, 7]);
    },
    add: async (bytes, metadata) => {
      assert.deepEqual([...bytes], [5, 6, 7]);
      assert.equal(metadata.sourceUrl, conversationUrl);
      assert.equal(metadata.questions[0].id, 'question-1');
      assert.equal(metadata.questions[0].title, 'Question');
      return { bytes: new Uint8Array([8, 9]), questions: 1, pages: 2 };
    }
  };
  app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), options);
  await app.start();
  app.element('page-layout').checked = true;
  await app.element('page-layout').handlers.change();
  await app.element('save-pdf').handlers.click();
  assert.deepEqual(app.downloads, ['Test conversation.pdf']);
  assert.match(app.element('export-status').textContent, /1 question bookmarks and 2 pages/);
  assert.equal(app.element('save-pdf').disabled, false);
  assert.equal(app.element('pdf-fallback').hidden, true);
  assert.equal(app.created.length, 0);
  assert.equal(app.activated.length, 0);
});

test('the landscape checkbox defaults to portrait and updates document width, print size and code fitting together', async () => {
  const fitted = [];
  const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), {
    fit: async (main, landscape) => fitted.push(landscape)
  });
  await app.start();
  assert.equal(app.element('page-layout').checked, false);
  assert.equal(app.element('pdf-document').dataset.landscape, 'false');
  assert.equal(app.element('page-direction').textContent, '@page { size: A4 portrait; }');
  assert.equal(fitted.at(-1), false);
  for (const checked of [true, false]) {
    app.element('page-layout').checked = checked;
    await app.element('page-layout').handlers.change();
    assert.equal(app.element('pdf-document').dataset.landscape, String(checked));
    assert.equal(app.element('page-direction').textContent, `@page { size: A4 ${checked ? 'landscape' : 'portrait'}; }`);
    assert.equal(fitted.at(-1), checked);
    assert.equal(app.element('page-layout').disabled, false);
  }
});

test('PDF capture failure does not download an incomplete file and restores controls', async () => {
  let fail = true;
  const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), {
    capture: async () => {
      if (fail) throw new Error('Debugger cancelled');
      return new Uint8Array([1, 2, 3]);
    }
  });
  await app.start();
  assert.equal(app.element('pdf-fallback').hidden, true);
  await app.element('save-pdf').handlers.click();
  assert.equal(app.downloads.length, 0);
  assert.equal(app.element('start-export').disabled, false);
  assert.equal(app.element('page-layout').disabled, false);
  assert.match(app.element('export-status').textContent, /Debugger cancelled/);
  assert.equal(app.element('export-status').dataset.level, 'error');
  assert.equal(app.element('pdf-fallback').hidden, false);
  assert.equal(app.element('print-again').disabled, false);
  assert.equal(app.element('add-pdf-outline').disabled, false);
  await app.start();
  assert.equal(app.element('pdf-fallback').hidden, true);
  await app.element('save-pdf').handlers.click();
  assert.equal(app.element('pdf-fallback').hidden, false);
  fail = false;
  await app.element('save-pdf').handlers.click();
  assert.equal(app.element('pdf-fallback').hidden, true);
  assert.deepEqual(app.downloads, ['Test conversation.pdf']);
});

test('reading reuses the same conversation without creating, closing or activating any tab', async () => {
  const app = fixture([{ id: 20, url: `${conversationUrl}?temporary=1#message` }]);
  await app.start();
  assert.equal(app.created.length, 0);
  assert.equal(app.removed.length, 0);
  assert.equal(app.activated.length, 0);
  assert.equal(app.requests[0].id, 20);
  assert.equal(app.requests[0].message.source, conversationUrl);
  assert.match(app.element('export-status').textContent, /verified/);
});

test('without a matching conversation, the temporary tab stays in the background and closes on success', async () => {
  const app = fixture([{ id: 20, url: 'https://chatgpt.com/c/different-conversation' }]);
  await app.start();
  assert.equal(app.created.length, 1);
  assert.equal(app.created[0].url, conversationUrl);
  assert.equal(app.created[0].active, false);
  assert.deepEqual(app.removed, [90]);
  assert.equal(app.activated.length, 0);
});

for (const reuse of [true, false]) {
  test(`cancellation closes only temporary tabs (${reuse ? 'reused conversation' : 'background tab'})`, async () => {
    let finishReading;
    const delayed = new Promise(resolve => { finishReading = resolve; });
    const app = fixture(reuse ? [{ id: 20, url: conversationUrl }] : [], delayed);
    const pending = app.start();
    await app.reading;
    await app.cancel();
    app.progress({ stage: 'assets', completed: 1, total: 2 });
    assert.equal(app.element('read-progress').hidden, true);
    assert.equal(app.element('export-status').hidden, false);
    finishReading(response);
    await pending;
    assert.deepEqual(app.removed, reuse ? [] : [90]);
    assert.equal(app.activated.length, 0);
    assert.equal(app.element('export-status').textContent, 'Reading cancelled.');
  });
}
