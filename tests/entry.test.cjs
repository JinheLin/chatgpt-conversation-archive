const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { chromeI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');

function workerFixture() {
  let action;
  const opened = [];
  const context = vm.createContext({
    URL, URLSearchParams, Date, console,
    chrome: {
      i18n: chromeI18n(),
      runtime: {
        id: 'extension-id',
        getURL: path => `chrome-extension://extension-id/${path}`
      },
      tabs: { create: async options => { opened.push(new URL(options.url)); } },
      action: { onClicked: { addListener: listener => { action = listener; } } }
    },
    importScripts: (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(project, file), 'utf8'), context))
  });
  vm.runInContext(fs.readFileSync(path.join(project, 'worker.js'), 'utf8'), context);
  return { opened, click: tab => action(tab) };
}

test('toolbar sends conversation, project conversation and shared links; homepage and other tabs wait for input', async () => {
  const worker = workerFixture();
  for (const source of ['https://chatgpt.com/c/test-id', 'https://chatgpt.com/g/g-id/c/test-id',
    'https://chatgpt.com/share/test-id', 'https://chat.openai.com/c/test-id']) {
    await worker.click({ url: source });
    assert.equal(worker.opened.at(-1).searchParams.get('source'), source);
  }
  for (const source of ['https://chatgpt.com/', 'https://chatgpt.com/g/g-id', 'https://example.com/c/id',
    'https://chatgpt.com.evil.example/c/id', undefined]) {
    await worker.click({ url: source });
    assert.equal(worker.opened.at(-1).searchParams.has('source'), false);
  }
});

function contentFixture(read) {
  const nodes = new Map();
  const listeners = new Set();
  const reads = [];
  for (const id of ['chatgpt-pdf-export-btn', 'chatgpt-pdf-export-status']) {
    nodes.set(id, { remove: () => nodes.delete(id) });
  }
  const context = vm.createContext({
    location: new URL('https://chatgpt.com/c/current-conversation'),
    document: {
      getElementById: id => nodes.get(id),
      createElement: () => { throw new Error('The bridge must not create page UI.'); },
      body: { appendChild: () => { throw new Error('The bridge must not inject page UI.'); } }
    },
    ChatGPTPdfSource: { read: async source => { reads.push(source); return read(source); } },
    chrome: { runtime: {
      id: 'extension-id',
      onMessage: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) }
    } }
  });
  const inject = () => vm.runInContext(fs.readFileSync(path.join(project, 'content.js'), 'utf8'), context);
  inject();
  return { context, nodes, listeners, reads, inject, request: message => new Promise(resolve => {
    assert.equal([...listeners][0](message, { id: 'extension-id' }, resolve), true);
  }) };
}

test('the read bridge removes legacy controls and reads without adding page buttons or banners', async () => {
  const payload = { messages: [{ role: 'user', text: 'Question' }] };
  const page = contentFixture(() => payload);
  assert.equal(page.nodes.size, 0);
  page.inject();
  assert.equal(page.listeners.size, 1);
  const result = await page.request({ type: 'READ_FULL_CONVERSATION', source: 'https://chatgpt.com/c/target-conversation' });
  assert.equal(result.ok, true);
  assert.equal(result.payload, payload);
  assert.deepEqual(page.reads, ['https://chatgpt.com/c/target-conversation']);
  assert.equal(page.nodes.size, 0);
});

test('read errors return to the exporter without adding a page banner', async () => {
  const page = contentFixture(() => { throw new Error('ChatGPT login required'); });
  const result = await page.request({ type: 'READ_FULL_CONVERSATION' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ChatGPT login required');
  assert.deepEqual(page.reads, ['https://chatgpt.com/c/current-conversation']);
  assert.equal(page.nodes.size, 0);
});

test('the bridge ignores unrelated messages and requests from other extensions', () => {
  const page = contentFixture(() => ({}));
  const listener = [...page.listeners][0];
  const unexpectedResponse = () => { throw new Error('Unexpected response'); };
  assert.equal(listener({ type: 'OTHER_MESSAGE' }, { id: 'extension-id' }, unexpectedResponse), false);
  assert.equal(listener({ type: 'READ_FULL_CONVERSATION' }, { id: 'other-extension' }, unexpectedResponse), false);
  assert.equal(page.reads.length, 0);
});
