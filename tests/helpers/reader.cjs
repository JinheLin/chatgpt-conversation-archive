const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { catalogs } = require('./i18n.cjs');
const project = path.resolve(__dirname, '../..');

function payload(text = 'First question', answer = 'An answer with **important text** and more detail.') {
  return {
    title: 'Reader fixture', sourceUrl: 'https://chatgpt.com/c/test-conversation',
    capturedAt: '2026-10-09T00:00:00.000Z',
    messages: [{ id: 'user-1', role: 'user', text }, { id: 'assistant-1', role: 'assistant', text: answer }],
    completeness: { verified: true, count: 2, questions: 1, firstMessageId: 'user-1', lastMessageId: 'assistant-1' }
  };
}
function fixture({ factory = new IDBFactory(), locale = 'en', initial = '', remote = payload(), BroadcastChannel } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(project, 'print.html'), 'utf8'), {
    url: 'https://reader.invalid/print.html' + (initial ? '?' + new URLSearchParams({ source: initial }) : ''),
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window, catalog = locale === 'zh-CN' ? catalogs.zh_CN : catalogs.en;
  Object.defineProperty(w, 'crypto', { value: webcrypto });
  w.TextEncoder = TextEncoder;
  w.indexedDB = factory;
  if (BroadcastChannel) w.BroadcastChannel = BroadcastChannel;
  w.confirm = () => true;
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolled = 'true'; };
  w.Range.prototype.getBoundingClientRect = () => ({ left: 100, top: 200, bottom: 220 });
  w.document.fonts = { ready: Promise.resolve() };
  const requests = [], downloads = [];
  w.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fixture'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  w.fetch = async (url) => {
    const relative = String(url).replace('chrome-extension://test/', '');
    const file = path.join(project, relative);
    if (relative.includes('_locales')) return { ok: true, json: async () => catalog };
    return { ok: true, text: async () => fs.readFileSync(file, 'utf8'), blob: async () => new w.Blob([fs.readFileSync(file)]) };
  };
  const event = { addListener() {}, removeListener() {} };
  w.chrome = {
    i18n: { getMessage(key, args = []) {
      const entry = catalog[key];
      if (!entry) return '';
      return entry.message.replace(/\$(\w+)\$/g, (_, name) =>
        entry.placeholders[name].content.replace(/\$(\d+)/g, (_, n) => String(args[Number(n) - 1] ?? '')));
    } },
    runtime: { id: 'test', getURL: (file) => 'chrome-extension://test/' + file, onMessage: event },
    tabs: {
      query: async () => [{ id: 20, url: remote.sourceUrl }],
      get: async () => ({ id: 20, status: 'complete' }), getCurrent: async () => ({ id: 10 }),
      create: async (options) => { requests.push({ create: options }); return { id: 90 }; },
      remove: async () => {}, onUpdated: event, onRemoved: event,
      sendMessage: async (id, message) => { requests.push(message); return { ok: true, payload: remote }; }
    },
    scripting: { executeScript: async () => {} }
  };
  for (const file of ['i18n.js', 'vendor/markdown-it.min.js', 'vendor/katex.min.js',
    'layout-markdown.js', 'citation-markdown.js', 'conversation-source.js', 'page-layout.js', 'export.js',
    'export-menu.js', 'read-progress.js', 'preview-navigation.js', 'reader-store.js', 'reader-anchor.js', 'reader.js', 'reader-workspace.js']) {
    w.eval(fs.readFileSync(path.join(project, file), 'utf8'));
  }
  // Code fitting has its own tests; JSDOM does not provide a canvas renderer.
  w.ChatGPTPdfExporter.fitCode = async () => {};
  return { dom, w, requests, downloads, factory,
    main: w.document.getElementById('pdf-document'),
    get: (id) => w.document.getElementById(id),
    start: () => w.eval(fs.readFileSync(path.join(project, 'print.js'), 'utf8')) };
}
async function setup(options = {}) {
  const app = fixture(options), value = options.payload || payload();
  await app.w.ChatGPTReaderStore.saveConversation(value);
  await app.w.ChatGPTPdfExporter.render(value, app.main);
  app.get('preview-layout').hidden = false;
  const reader = app.w.ChatGPTReader.init({ main: app.main, layout: app.get('preview-layout') });
  await reader.load(app.w.ChatGPTReaderStore.keyFor(value.sourceUrl));
  return { ...app, reader, payload: value };
}
function select(app, body, start, end) {
  const index = app.w.ChatGPTReaderAnchor.index(body);
  const first = index.nodes.find((entry) => start >= entry.start && start < entry.end);
  const last = index.nodes.find((entry) => end > entry.start && end <= entry.end);
  const range = app.w.document.createRange();
  range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
  app.w.getSelection().removeAllRanges(); app.w.getSelection().addRange(range);
  return range;
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Reader did not reach the expected state');
}
module.exports = { fixture, setup, select, waitFor, payload, IDBFactory };
