const assert = require('node:assert/strict');
const { test } = require('node:test');
const { IDBObjectStore } = require('fake-indexeddb');
const { fixture, payload, waitFor, IDBFactory } = require('./helpers/reader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const key = 'c:test-conversation';

function conversation() {
  const data = payload('First question', '## 一、First section\n\nA long paragraph to resume.\n\nAnother paragraph.');
  data.messages.push({ id: 'user-2', role: 'user', text: 'Second question' },
    { id: 'assistant-2', role: 'assistant', text: '## 一、Another section\n\nA different answer.' },
    { id: 'user-3', role: 'user', text: 'Third question' });
  data.completeness = { verified: true, count: 5, questions: 3, firstMessageId: 'user-1', lastMessageId: 'user-3' };
  return data;
}
// Realistic document geometry with paragraph reflow and folded turns, rather than
// assuming that yesterday's document has the same pixel heights or message order.
function viewport(app) {
  const { w, main } = app;
  let scroll = 0, scale = 1;
  const jumps = [];
  const rect = (top, height, width = 700) => ({ top: top - scroll, bottom: top + height - scroll, height, width, left: 0, right: width });
  function geometry() {
    const boxes = new Map(); let top = 200;
    for (const section of main.querySelectorAll(':scope > .pdf-message')) {
      const folded = section.dataset.readerFolded === 'true';
      const hidden = folded && section.classList.contains('pdf-assistant');
      const body = section.querySelector('.pdf-message-body');
      let next = top + (hidden ? 0 : 50);
      for (const block of body.children) {
        const height = folded ? 0 : (block.tagName === 'P' ? 260 : 60) * scale;
        boxes.set(block, rect(next, height)); next += height;
      }
      const height = hidden ? 0 : folded ? 70 : next - top + 30;
      boxes.set(section, rect(top, height)); boxes.set(body, rect(top + 50, next - top - 50));
      if (height) top += height + 24;
    }
    boxes.set(main, rect(200, top - 200)); return boxes;
  }
  Object.defineProperty(w, 'scrollY', { get: () => scroll });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('reader-bar')) return { top: 0, bottom: 72, height: 72 };
    if (this.id === 'preview-sidebar') return { top: 90, bottom: 600, height: 510 };
    return geometry().get(this) || rect(0, 0);
  };
  w.HTMLElement.prototype.getClientRects = function () { const r = this.getBoundingClientRect(); return r.height ? [r] : []; };
  function move(top) { scroll = Math.max(0, top); w.dispatchEvent(new w.Event('scroll')); }
  w.scrollTo = options => { jumps.push(options.top); move(options.top); };
  w.HTMLElement.prototype.scrollIntoView = function () {
    this.dataset.scrolled = 'true'; move(scroll + this.getBoundingClientRect().top - 96);
  };
  return { jumps, move, reflow(value) { scale = value; },
    read(node, fraction = 0) { const r = node.getBoundingClientRect(); move(scroll + r.top + r.height * fraction - 96); },
    offset(node, fraction = 0) { const r = node.getBoundingClientRect(); return r.top + r.height * fraction; } };
}
async function open(t, { factory = new IDBFactory(), data = conversation(), hash = '', prepare } = {}) {
  const app = fixture({ factory, initial: data.sourceUrl }), view = viewport(app);
  t.after(() => app.w.close());
  if (hash) app.w.history.replaceState(null, '', app.w.location.href + hash);
  await app.w.ChatGPTReaderStore.saveConversation(data);
  if (prepare) await prepare(app);
  await app.start();
  return { ...app, view, data, store: app.w.ChatGPTReaderStore,
    toggle: number => app.get('question-' + number).querySelector('.reader-turn-controls button') };
}
function position(changes = {}) {
  return { messageId: 'assistant-1', questionId: 'user-1', blockIndex: 1, excerpt: 'A long paragraph to resume.',
    fraction: .4, gap: 0, atStart: false, hash: '', ...changes };
}

test('scrolling checkpoints a paragraph and closing/reopening restores it after reflow without touching ChatGPT', async t => {
  const factory = new IDBFactory(), app = await open(t, { factory });
  const paragraph = app.main.querySelector('.pdf-assistant p');
  app.view.read(paragraph, .4);
  const saved = await waitFor(async () => (await app.store.getReaderState(key))?.position);
  assert.equal(saved.messageId, 'assistant-1'); assert.equal(saved.blockIndex, 1);
  assert.ok(Math.abs(saved.fraction - .4) < .001);
  const snapshot = plain((await app.store.getConversation(key)).payload);
  app.w.dispatchEvent(new app.w.Event('pagehide'));
  app.w.close();
  const reopened = await open(t, { factory });
  assert.ok(Math.abs(reopened.view.offset(reopened.main.querySelector('.pdf-assistant p'), .4) - 96) < 1);
  assert.equal(reopened.requests.length, 0);
  assert.deepEqual(plain((await reopened.store.getConversation(key)).payload), snapshot);
});

test('message IDs and paragraph excerpts survive inserted messages, inserted paragraphs and a different width', async t => {
  const data = conversation();
  const app = await open(t, { prepare: async app => {
    await app.w.ChatGPTReaderStore.saveReaderState(key, { position: position() });
  } });
  const newer = plain(data);
  newer.messages[1].text = 'New introduction.\n\n' + newer.messages[1].text;
  newer.messages.unshift({ id: 'new-user', role: 'user', text: 'Earlier inserted question' });
  newer.capturedAt = '2026-10-22T00:00:00.000Z';
  newer.completeness.count++; newer.completeness.questions++; newer.completeness.firstMessageId = 'new-user';
  const reopened = fixture({ factory: app.factory, initial: data.sourceUrl }), view = viewport(reopened);
  t.after(() => reopened.w.close()); view.reflow(1.6);
  await reopened.w.ChatGPTReaderStore.saveConversation(newer); await reopened.start();
  const paragraph = [...reopened.main.querySelectorAll('.pdf-assistant p')].find(node => node.textContent.trim() === 'A long paragraph to resume.');
  assert.ok(Math.abs(view.offset(paragraph, .4) - 96) < 1);
  assert.equal(reopened.get('question-1').dataset.messageId, 'new-user');
});

test('individual and bulk fold choices survive reopening, stay per conversation and leave new questions expanded', async t => {
  const factory = new IDBFactory(), app = await open(t, { factory });
  app.toggle(1).click(); app.toggle(3).click();
  await waitFor(async () => (await app.store.getReaderState(key))?.collapsed?.length === 2);
  const another = { ...conversation(), sourceUrl: 'https://chatgpt.com/c/another-conversation' };
  await app.store.saveConversation(another);
  await app.store.saveReaderState('c:another-conversation', { collapsed: ['user-2'] });
  app.w.close();
  const updated = conversation();
  updated.messages.push({ id: 'user-4', role: 'user', text: 'New question' });
  updated.capturedAt = '2026-10-22T00:00:00.000Z';
  updated.completeness.count++; updated.completeness.questions++; updated.completeness.lastMessageId = 'user-4';
  const reopened = await open(t, { factory, data: updated });
  assert.equal(reopened.toggle(1).getAttribute('aria-expanded'), 'false');
  assert.equal(reopened.toggle(2).getAttribute('aria-expanded'), 'true');
  assert.equal(reopened.toggle(3).getAttribute('aria-expanded'), 'false');
  assert.equal(reopened.toggle(4).getAttribute('aria-expanded'), 'true');
  reopened.get('preview-sidebar').querySelector('.reader-fold-tools button').click();
  await waitFor(async () => (await reopened.store.getReaderState(key))?.collapsed?.length === 4);
  reopened.get('preview-sidebar').querySelectorAll('.reader-fold-tools button')[1].click();
  await waitFor(async () => (await reopened.store.getReaderState(key))?.collapsed?.length === 0);
  assert.deepEqual(plain((await reopened.store.getReaderState('c:another-conversation')).collapsed), ['user-2']);
  const third = await open(t, { factory });
  assert.ok([...third.main.querySelectorAll('.reader-turn-controls button')].every(node => node.getAttribute('aria-expanded') === 'true'));
});

test('an unchanged URL fragment resumes the latest position while a different explicit chapter unfolds and wins', async t => {
  const factory = new IDBFactory();
  const app = await open(t, { factory, hash: '#question-1', prepare: async app => {
    await app.w.ChatGPTReaderStore.saveReaderState(key, {
      collapsed: ['user-1'], position: position({ messageId: 'assistant-2', questionId: 'user-2', blockIndex: 1,
        excerpt: 'A different answer.', hash: '#question-1' })
    });
  } });
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  assert.ok(Math.abs(app.view.offset(app.get('message-4').querySelector('p'), .4) - 96) < 1);
  const linked = await open(t, { factory, hash: '#answer-heading-2-1' });
  assert.equal(linked.toggle(1).getAttribute('aria-expanded'), 'true');
  assert.equal(linked.get('answer-heading-2-1').dataset.scrolled, 'true');
  await waitFor(async () => !(await linked.store.getReaderState(key)).collapsed.includes('user-1'));
});

test('a persisted fold wins over an older position inside its answer, and a deleted answer falls back to its question', async t => {
  const app = await open(t, { prepare: app => app.w.ChatGPTReaderStore.saveReaderState(key, {
    collapsed: ['user-1'], position: position()
  }) });
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  assert.ok(Math.abs(app.view.offset(app.get('question-1')) - 96) < 1);
  const missing = await open(t, { prepare: app => app.w.ChatGPTReaderStore.saveReaderState(key, {
    position: position({ messageId: 'deleted-answer', questionId: 'user-2' })
  }) });
  assert.ok(Math.abs(missing.view.offset(missing.get('question-2')) - 96) < 1);
});

test('switching conversations flushes immediately, restores independent positions and can remember returning to the top', async t => {
  const app = await open(t), another = { ...conversation(), sourceUrl: 'https://chatgpt.com/c/another-conversation' };
  await app.store.saveConversation(another);
  app.view.read(app.get('message-4').querySelector('p'), .3);
  app.get('conversation-url').value = another.sourceUrl;
  app.get('export-form').dispatchEvent(new app.w.Event('submit', { cancelable: true }));
  await waitFor(() => !app.get('start-export').disabled && app.w.location.search.includes('another-conversation'));
  assert.equal((await app.store.getReaderState(key)).position.messageId, 'assistant-2');
  assert.equal(app.w.scrollY, 0);
  app.get('conversation-url').value = app.data.sourceUrl;
  app.get('export-form').dispatchEvent(new app.w.Event('submit', { cancelable: true }));
  await waitFor(() => !app.get('start-export').disabled && !app.w.location.search.includes('another-conversation'));
  assert.ok(Math.abs(app.view.offset(app.get('message-4').querySelector('p'), .3) - 96) < 1);
  app.view.move(0); app.w.dispatchEvent(new app.w.Event('pagehide'));
  await waitFor(async () => (await app.store.getReaderState(key))?.position.atStart);
  const reopened = await open(t, { factory: app.factory }); assert.equal(reopened.w.scrollY, 0);
});

test('positions and folds merge independently, count toward local sizes, round-trip in backups and delete with the conversation', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore; await store.saveConversation(conversation());
  const baseline = (await store.listConversations())[0].bytes;
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    assert.notEqual(this.name, 'conversations', 'Scroll checkpoints must not clone transcripts/assets');
    return get.apply(this, args);
  };
  try {
    await Promise.all([store.saveReaderState(key, { position: position() }), store.saveReaderState(key, { collapsed: ['user-1'] }),
      store.saveReaderState(key, { tocCollapsed: ['user-2'] })]);
  } finally { IDBObjectStore.prototype.get = get; }
  const state = await store.getReaderState(key);
  assert.deepEqual(plain(state.collapsed), ['user-1']); assert.equal(state.position.messageId, 'assistant-1');
  assert.deepEqual(plain(state.tocCollapsed), ['user-2']);
  assert.equal((await store.listConversations())[0].bytes, baseline + state.byteSize);
  const backup = plain(await store.backup());
  const destination = fixture(); t.after(() => destination.w.close());
  await destination.w.ChatGPTReaderStore.restore(backup);
  assert.deepEqual(plain(await destination.w.ChatGPTReaderStore.getReaderState(key)), plain(state));
  await store.saveReaderState(key, { collapsed: [] });
  await store.saveReaderState(key, { tocCollapsed: [] });
  await store.restore(backup); assert.deepEqual(plain((await store.getReaderState(key)).collapsed), []);
  assert.deepEqual(plain((await store.getReaderState(key)).tocCollapsed), []);
  assert.deepEqual(plain((await store.getReaderState(key)).position), plain(state.position));
  await store.deleteConversation(key);
  await store.saveReaderState(key, { position: position(), collapsed: ['user-2'] });
  assert.equal(await store.getReaderState(key), null);
  assert.equal((await store.backup()).readerStates.length, 0);
  delete backup.readerStates; assert.equal(store.validateBackup(backup).readerStates.length, 0);
});

test('malformed and unrelated imported state is rejected before changing local data', async t => {
  const app = fixture(); t.after(() => app.w.close()); const store = app.w.ChatGPTReaderStore;
  await store.saveConversation(conversation());
  await store.saveReaderState(key, { position: position(), collapsed: ['user-1'] });
  const original = plain(await store.backup());
  for (const update of [state => { state.position.fraction = Infinity; }, state => { state.key = 'c:unrelated'; },
    state => { state.position.blockIndex = -9; }, state => { state.collapsed = 'all'; }, state => { state.position.hash = 'x'.repeat(2001); },
    state => { state.tocCollapsed = 'all'; }, state => { state.tocCollapsed = ['']; state.tocUpdatedAt = state.foldsUpdatedAt; }]) {
    const invalid = structuredClone(original); update(invalid.readerStates[0]);
    await assert.rejects(store.restore(invalid));
    assert.deepEqual(plain((await store.backup()).readerStates), original.readerStates);
  }
});

test('user scrolling during image decoding cancels automatic restoration instead of jumping back', async t => {
  const app = fixture(), view = viewport(app); t.after(() => app.w.close());
  const data = conversation(); await app.w.ChatGPTReaderStore.saveConversation(data);
  await app.w.ChatGPTPdfExporter.render(data, app.main);
  const image = app.w.document.createElement('img'); app.main.querySelector('.pdf-message-body').append(image);
  Object.defineProperty(image, 'complete', { value: false });
  let decoded; image.decode = () => new Promise(resolve => { decoded = resolve; });
  const controller = app.w.ChatGPTReaderPosition.init({ main: app.main });
  const loaded = controller.load(key, position());
  await waitFor(() => decoded);
  app.w.dispatchEvent(new app.w.Event('wheel')); view.move(1000); decoded(); await loaded;
  assert.equal(app.w.scrollY, 1000); assert.equal(view.jumps.length, 0);
  await controller.flush();
  assert.equal((await app.w.ChatGPTReaderStore.getReaderState(key)).position.atStart, false);
  // Input that occurred earlier in the asynchronous rendering phase also wins.
  await controller.unload(); image.remove();
  app.w.dispatchEvent(new app.w.Event('wheel')); view.move(700);
  await controller.load(key, position());
  assert.equal(app.w.scrollY, 700); assert.equal(view.jumps.length, 0);
});

test('version 5 databases add reader state in place without rewriting existing snapshots or annotations', async t => {
  const factory = new IDBFactory(), data = conversation();
  const snapshot = { key, payload: data, savedAt: data.capturedAt, byteSize: 12345 };
  const old = await new Promise((resolve, reject) => {
    const request = factory.open('chatgpt-conversation-reader', 5);
    request.onupgradeneeded = () => {
      const db = request.result;
      const chats = db.createObjectStore('conversations', { keyPath: 'key' });
      chats.createIndex('summary', ['savedAt', 'payload.title', 'payload.sourceUrl', 'payload.capturedAt', 'payload.completeness.count', 'payload.completeness.questions', 'key', 'byteSize']);
      chats.put(snapshot);
      const notes = db.createObjectStore('annotations', { keyPath: 'id' });
      notes.createIndex('conversationKey', 'conversationKey'); notes.createIndex('storageSize', ['conversationKey', 'byteSize']);
      const reads = db.createObjectStore('reads', { keyPath: ['conversationKey', 'messageId'] }); reads.createIndex('conversationKey', 'conversationKey');
      db.createObjectStore('drafts', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); old.close();
  const app = fixture({ factory }); t.after(() => app.w.close());
  assert.deepEqual(plain(await app.w.ChatGPTReaderStore.getConversation(key)), snapshot);
  await app.w.ChatGPTReaderStore.saveReaderState(key, { position: position(), collapsed: ['user-2'] });
  assert.deepEqual(plain((await app.w.ChatGPTReaderStore.getReaderState(key)).collapsed), ['user-2']);
  assert.equal((await app.w.ChatGPTReaderStore.listConversations())[0].bytes > 12345, true);
});

for (const locale of ['en', 'zh-CN']) test('directory folds survive reopening by stable question ID and stay separate from document folds (' + locale + ')', async t => {
  const factory = new IDBFactory(), app = await open(t, { factory });
  const button = app.get('preview-sidebar').querySelector('.preview-headings-toggle');
  button.click();
  await waitFor(async () => (await app.store.getReaderState(key))?.tocCollapsed?.includes('user-1'));
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  assert.equal(app.get('question-1').dataset.readerFolded, 'false');
  assert.equal(app.main.querySelector('.pdf-toc-headings').hidden, false);
  app.toggle(2).click();
  await waitFor(async () => (await app.store.getReaderState(key))?.collapsed?.includes('user-2'));
  app.w.close();
  const updated = conversation();
  updated.messages.unshift({ id: 'earlier-question', role: 'user', text: 'An earlier question' });
  updated.completeness.count++; updated.completeness.questions++; updated.completeness.firstMessageId = 'earlier-question';
  updated.capturedAt = '2026-10-22T00:00:00.000Z';
  const reopened = fixture({ factory, initial: updated.sourceUrl, locale }); t.after(() => reopened.w.close());
  viewport(reopened);
  await reopened.w.ChatGPTReaderStore.saveConversation(updated); await reopened.start();
  const nav = reopened.get('preview-sidebar'), folded = nav.querySelector('#preview-answer-sections-question-2');
  assert.equal(reopened.get('question-2').dataset.messageId, 'user-1');
  assert.equal(folded.hidden, true);
  assert.equal(reopened.get('question-2').dataset.readerFolded, 'false');
  assert.equal(reopened.get('question-3').dataset.readerFolded, 'true');
  assert.equal(nav.querySelector('#preview-answer-sections-question-3').hidden, false);
  const toggle = nav.querySelector('[aria-controls="' + folded.id + '"]');
  assert.equal(toggle.getAttribute('aria-label'), locale === 'zh-CN' ? '展开问题 2 下的回答标题' : 'Expand answer headings under question 2');
  toggle.click();
  await waitFor(async () => (await reopened.w.ChatGPTReaderStore.getReaderState(key))?.tocCollapsed?.length === 0);
});

test('folded directory lists are reader-only: HTML exports keep every heading and omit the preview controls', async t => {
  const app = await open(t);
  app.get('preview-sidebar').querySelector('.preview-headings-toggle').click();
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
  const html = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  const doc = new app.w.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('.preview-headings-toggle, [id^="preview-answer-sections-"]'), null);
  assert.equal(doc.querySelectorAll('.pdf-toc-headings a').length, 2);
  assert.equal(doc.querySelector('.pdf-toc-headings[hidden]'), null);
  assert.equal(app.get('preview-sidebar').querySelector('.pdf-toc-headings').hidden, true);
});
