const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');

function workerFixture() {
  let action, onMessage;
  const opened = [];
  const context = vm.createContext({
    URL, URLSearchParams, Date, console,
    chrome: {
      runtime: {
        id: 'extension-id',
        getURL: path => `chrome-extension://extension-id/${path}`,
        onMessage: { addListener: listener => { onMessage = listener; } }
      },
      tabs: { create: async options => { opened.push(new URL(options.url)); } },
      action: { onClicked: { addListener: listener => { action = listener; } } }
    },
    importScripts: file => vm.runInContext(fs.readFileSync(path.join(project, file), 'utf8'), context)
  });
  vm.runInContext(fs.readFileSync(path.join(project, 'worker.js'), 'utf8'), context);
  return { opened, click: tab => action(tab), message: (message, sender) => new Promise(resolve => {
    onMessage(message, sender, resolve);
  }) };
}

test('page button uses the current conversation URL even if the document sender still points to the homepage', async () => {
  const worker = workerFixture();
  const source = 'https://chatgpt.com/c/current-conversation?temporary=1#message';
  const response = await worker.message({ type: 'OPEN_EXPORT_PAGE', source },
    { id: 'extension-id', url: 'https://chatgpt.com/' });
  assert.equal(response.ok, true);
  assert.equal(worker.opened[0].searchParams.get('source'), 'https://chatgpt.com/c/current-conversation');
});

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

test('content script captures the URL at click time after navigation without a page reload', async () => {
  const nodes = new Map();
  let scheduleUpdate;
  const sent = [];
  const location = new URL('https://chatgpt.com/');
  const document = {
    documentElement: {},
    body: { appendChild: node => { nodes.set(node.id, node); } },
    getElementById: id => nodes.get(id),
    createElement: () => ({
      listeners: {}, dataset: {}, setAttribute() {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      remove() { nodes.delete(this.id); }
    })
  };
  const context = vm.createContext({
    document, location,
    ChatGPTPdfDomAdapter: { isConversationPage: () => location.pathname.includes('/c/') },
    chrome: { runtime: {
      sendMessage: async message => { sent.push(message); return { ok: true }; },
      onMessage: { addListener() {}, removeListener() {} }
    } },
    MutationObserver: class { constructor(callback) { scheduleUpdate = callback; } observe() {} disconnect() {} },
    requestAnimationFrame: callback => callback()
  });
  vm.runInContext(fs.readFileSync(path.join(project, 'content.js'), 'utf8'), context);
  assert.equal(nodes.has('chatgpt-pdf-export-btn'), false);
  location.href = 'https://chatgpt.com/c/first-conversation';
  scheduleUpdate();
  const button = nodes.get('chatgpt-pdf-export-btn');
  assert.ok(button);
  location.href = 'https://chatgpt.com/c/second-conversation';
  await button.listeners.click();
  assert.equal(sent[0].source, location.href);
  assert.equal(sent[0].type, 'OPEN_EXPORT_PAGE');
});
