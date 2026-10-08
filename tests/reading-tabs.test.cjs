const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');
const conversationUrl = 'https://chatgpt.com/c/test-conversation';
const response = { ok: true, payload: {
  title: 'Test conversation', sourceUrl: conversationUrl, messages: [{ role: 'user', text: 'Question' }], completeness: { questions: 1 }
} };

function fixture(tabs, readResponse = Promise.resolve(response), output = {}) {
  const elements = new Map();
  const created = [], removed = [], activated = [], requests = [];
  const downloads = [];
  let notifyReading;
  const reading = new Promise(resolve => { notifyReading = resolve; });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'conversation-url' ? conversationUrl : 'portrait',
      checked: id === 'show-back-links',
      dataset: {}, handlers: {}, hidden: false,
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
  const context = vm.createContext({
    URL: DownloadURL, URLSearchParams, Date, Blob,
    setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timer.unref(); return timer; }, clearTimeout,
    location: { search: '' },
    document: {
      getElementById: element, fonts: { ready: Promise.resolve() }, documentElement: {}, querySelectorAll: () => [],
      createElement: () => { const link = { click() { downloads.push(link.download); } }; return link; }
    },
    chrome: {
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
    ChatGPTPdfExporter: { render: () => [], fitCode() {} },
    ChatGPTPdfCapture: { capture: output.capture || (async () => new Uint8Array([1, 2, 3])) },
    ChatGPTPdfOutline: { add: output.add || (async () => ({ bytes: new Uint8Array([1, 2, 3]), questions: 1, pages: 2 })) }
  });
  installI18n(context);
  vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(project, 'print.js'), 'utf8'), context);
  return { created, removed, activated, requests, reading, element, downloads,
    start: () => element('export-form').handlers.submit({ preventDefault() {} }),
    cancel: () => element('cancel-export').handlers.click()
  };
}

test('one PDF button captures the selected orientation and adds question bookmarks before downloading', async () => {
  let app;
  const options = {
    capture: async settings => {
      assert.equal(settings.landscape, true);
      for (const id of ['start-export', 'page-layout', 'show-back-links']) assert.equal(app.element(id).disabled, true);
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
  app.element('page-layout').value = 'landscape';
  app.element('show-back-links').checked = false;
  app.element('show-back-links').handlers.change();
  await app.element('save-pdf').handlers.click();
  assert.deepEqual(app.downloads, ['Test conversation.pdf']);
  assert.equal(app.element('pdf-document').dataset.showBackLinks, 'false');
  assert.match(app.element('export-status').textContent, /1 question bookmarks and 2 pages/);
  assert.equal(app.element('save-pdf').disabled, false);
  assert.equal(app.created.length, 0);
  assert.equal(app.activated.length, 0);
});

test('PDF capture failure does not download an incomplete file and restores controls', async () => {
  const app = fixture([{ id: 20, url: conversationUrl }], Promise.resolve(response), {
    capture: async () => { throw new Error('Debugger cancelled'); }
  });
  await app.start();
  await app.element('save-pdf').handlers.click();
  assert.equal(app.downloads.length, 0);
  assert.equal(app.element('start-export').disabled, false);
  assert.equal(app.element('show-back-links').disabled, false);
  assert.match(app.element('export-status').textContent, /Debugger cancelled/);
  assert.equal(app.element('export-status').dataset.level, 'error');
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
    finishReading(response);
    await pending;
    assert.deepEqual(app.removed, reuse ? [] : [90]);
    assert.equal(app.activated.length, 0);
    assert.equal(app.element('export-status').textContent, 'Reading cancelled.');
  });
}
