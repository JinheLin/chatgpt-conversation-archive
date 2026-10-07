const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');
const conversationUrl = 'https://chatgpt.com/c/test-conversation';
const response = { ok: true, payload: {
  title: 'Test conversation', messages: [{ role: 'user', text: 'Question' }], completeness: { questions: 1 }
} };

function fixture(tabs, readResponse = Promise.resolve(response)) {
  const elements = new Map();
  const created = [], removed = [], activated = [], requests = [];
  let notifyReading;
  const reading = new Promise(resolve => { notifyReading = resolve; });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'conversation-url' ? conversationUrl : 'portrait',
      dataset: {}, handlers: {}, hidden: false,
      addEventListener(type, handler) { this.handlers[type] = handler; }
    });
    return elements.get(id);
  }
  const event = { addListener() {}, removeListener() {} };
  const context = vm.createContext({
    URL, URLSearchParams, Date, setTimeout, clearTimeout,
    location: { search: '' },
    document: { getElementById: element, fonts: { ready: Promise.resolve() }, documentElement: {}, querySelectorAll: () => [] },
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
    ChatGPTPdfExporter: { render: () => [], fitCode() {} }
  });
  installI18n(context);
  vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(project, 'print.js'), 'utf8'), context);
  return { created, removed, activated, requests, reading, element,
    start: () => element('export-form').handlers.submit({ preventDefault() {} }),
    cancel: () => element('cancel-export').handlers.click()
  };
}

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
