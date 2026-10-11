const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, waitFor, IDBFactory } = require('./helpers/reader.cjs');

const project = path.resolve(__dirname, '..');
const hash = 'a'.repeat(64);
const key = 'c:test-conversation';
const read = (messageId, value = true, textHash = hash) => ({ conversationKey: key, messageId, read: value, textHash });
const userToggle = (app) => app.main.querySelector('.pdf-user .reader-read-toggle');
const answerToggle = (app) => app.main.querySelector('.pdf-assistant .reader-read-toggle');

function thread() {
  const value = payload('First question', 'First answer');
  value.messages.push({ id: 'user-2', role: 'user', text: 'Second question' });
  value.completeness = { verified: true, count: 3, questions: 2, firstMessageId: 'user-1', lastMessageId: 'user-2' };
  return value;
}

test('read state is explicit, survives reopening, and an older backup cannot resurrect it', async (t) => {
  const factory = new IDBFactory();
  const app = fixture({ factory, initial: payload().sourceUrl });
  t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore;
  await store.saveConversation(payload());
  await assert.rejects(store.setReads([read('missing')]), /Save the conversation locally/);
  const before = (await store.listConversations())[0].bytes;
  await store.setReads([read('user-1', true)]);
  const marked = (await store.listConversations())[0];
  assert.equal(marked.readCount, 1);
  assert.ok(marked.bytes > before);
  const older = await store.backup();
  await store.setReads([read('user-1', false, 'b'.repeat(64))]);
  await store.restore(older);
  assert.equal((await store.getReads(key))[0].read, false);
  const unreadBytes = (await store.listConversations())[0].bytes;
  assert.equal((await store.listConversations())[0].readCount, 0);
  assert.ok(unreadBytes > before);
  const withoutReads = await store.backup();
  delete withoutReads.reads;
  await store.restore(withoutReads);
  assert.equal((await store.getReads(key))[0].read, false);
  const newer = JSON.parse(JSON.stringify(await store.backup()));
  newer.reads[0].read = true;
  newer.reads[0].updatedAt = '2099-01-01T00:00:00.000Z';
  await store.restore(newer);
  assert.equal((await store.getReads(key))[0].read, true);
  newer.reads[0].messageId = 'missing';
  await assert.rejects(store.restore(newer), /Invalid/);
  const removed = payload('Changed question', 'Changed answer');
  removed.messages[0].id = 'user-9';
  removed.messages[1].id = 'assistant-9';
  removed.capturedAt = '2026-10-10T00:00:00.000Z';
  removed.completeness = { verified: true, count: 2, questions: 1, firstMessageId: 'user-9', lastMessageId: 'assistant-9' };
  await store.saveConversation(removed);
  assert.equal((await store.getReads(key)).length, 0);
  await store.setReads([read('user-9')]);
  await store.deleteConversation(key);
  assert.equal((await store.getReads(key)).length, 0);
  assert.equal((await store.backup()).reads.length, 0);
});

test('version 2 databases upgrade in place and keep saved conversations', async (t) => {
  const factory = new IDBFactory();
  const seeded = fixture({ factory });
  t.after(() => seeded.w.close());
  const snapshot = { key, payload: payload(), savedAt: '2026-10-09T01:02:03.000Z', byteSize: 12 };
  const annotation = { id: 'legacy', conversationKey: key, messageId: 'assistant-1', comment: 'Legacy comment',
    createdAt: snapshot.savedAt, updatedAt: snapshot.savedAt, byteSize: 8,
    anchor: await seeded.w.ChatGPTReaderAnchor.quote('Important text', 0, 9) };
  const old = await new Promise((resolve, reject) => {
    const request = factory.open('chatgpt-conversation-reader', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const conversations = db.createObjectStore('conversations', { keyPath: 'key' });
      conversations.createIndex('summary', ['savedAt', 'payload.title', 'payload.sourceUrl', 'payload.capturedAt', 'payload.completeness.count', 'key', 'byteSize']);
      conversations.put(snapshot);
      const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
      annotations.createIndex('conversationKey', 'conversationKey');
      annotations.createIndex('storageSize', ['conversationKey', 'byteSize']);
      annotations.put(annotation);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  old.close();
  const entries = await seeded.w.ChatGPTReaderStore.listConversations();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].readCount, 0);
  assert.equal((await seeded.w.ChatGPTReaderStore.getAnnotations(key))[0].comment, 'Legacy comment');
  await seeded.w.ChatGPTReaderStore.setReads([read('assistant-1')]);
  assert.equal((await seeded.w.ChatGPTReaderStore.getReads(key))[0].messageId, 'assistant-1');
});

test('reader controls mark answers, filter the sidebar and stay out of HTML', async (t) => {
  const factory = new IDBFactory();
  const data = thread();
  const app = fixture({ factory, initial: data.sourceUrl });
  t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data);
  await app.start();
  assert.equal(userToggle(app), null);
  assert.equal(app.main.querySelector('.reader-read-through'), null);
  assert.equal(answerToggle(app).disabled, false);
  assert.equal(answerToggle(app).dataset.state, 'unread');
  assert.equal(answerToggle(app).textContent, 'Mark as read');
  assert.match(app.get('reader-meta').textContent, /0\/1 read/);
  assert.equal(app.main.querySelector('.pdf-toc .reader-read-toc'), null);
  assert.equal(app.get('preview-sidebar').querySelectorAll('.reader-read-dot').length, 1);
  answerToggle(app).click();
  await waitFor(() => answerToggle(app).dataset.state === 'read');
  assert.equal(answerToggle(app).textContent, 'Mark as unread');
  assert.match(app.get('reader-meta').textContent, /1\/1 read/);
  await waitFor(() => app.get('reader-library-list').textContent.includes('1/1 read'));
  const dots = () => [...app.get('preview-sidebar').querySelectorAll('.preview-toc > ol > li')];
  assert.equal(dots()[0].querySelector('.reader-read-dot').dataset.state, 'read');
  assert.equal(dots()[1].querySelector('.reader-read-dot'), null);
  app.get('preview-sidebar').querySelector('.reader-read-filter-toggle').click();
  assert.equal(app.get('preview-sidebar').querySelector('.reader-read-filter-toggle').textContent, 'Show all');
  assert.equal(dots().every((item) => item.hidden), true);
  assert.match(app.get('preview-sidebar').querySelector('.reader-no-unread').textContent, /marked read/);
  app.get('preview-sidebar').querySelector('.reader-read-filter-toggle').click();
  assert.equal(dots().some((item) => item.hidden), false);
  const reopened = fixture({ factory, initial: data.sourceUrl });
  t.after(() => reopened.w.close());
  await reopened.start();
  assert.equal(reopened.main.querySelectorAll('.reader-read-toggle[data-state="read"]').length, 1);
  app.get('save-html').click();
  await waitFor(() => app.downloads.length === 1);
  const html = await new Promise((resolve, reject) => {
    const reader = new app.w.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(app.downloads[0]);
  });
  const exported = new app.w.DOMParser().parseFromString(html, 'text/html');
  assert.equal(exported.querySelectorAll('.reader-read-controls, .reader-read-toc, .reader-read-filter').length, 0);
  assert.equal(exported.querySelector('.pdf-toc a').textContent, 'First question');
  assert.ok(app.main.querySelector('.reader-read-controls'));
  assert.match(fs.readFileSync(path.join(project, 'style.css'), 'utf8'),
    /\.reader-read-controls, \.reader-read-filter, \.reader-read-toc, \.reader-read-state \{ display: none !important; \}/);
});

test('changed message text stays marked read until it is confirmed, and one sidebar mark covers every following answer', async (t) => {
  const app = fixture({ locale: 'zh-CN', initial: payload().sourceUrl });
  t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore;
  const original = payload('第一问', '原来的回答');
  await store.saveConversation(original);
  await app.start();
  assert.equal(userToggle(app), null);
  assert.equal(app.main.querySelector('.reader-read-through'), null);
  assert.equal(answerToggle(app).textContent, '标为已读');
  assert.match(app.get('reader-meta').textContent, /已读 0\/1/);
  answerToggle(app).click();
  await waitFor(() => answerToggle(app).dataset.state === 'read');
  const changed = payload('第一问', '更新后的回答');
  changed.capturedAt = '2026-10-10T00:00:00.000Z';
  await store.saveConversation(changed);
  app.get('reader-open').click();
  app.get('reader-library-list').querySelector('.reader-library-open').click();
  await waitFor(() => answerToggle(app)?.dataset.state === 'stale' && !app.get('start-export').disabled);
  assert.ok(app.main.querySelector('.pdf-assistant .reader-read-state'));
  app.get('preview-sidebar').querySelector('.reader-read-filter-toggle').click();
  assert.equal(app.get('preview-sidebar').querySelector('.preview-toc > ol > li').hidden, false);
  answerToggle(app).click();
  await waitFor(() => answerToggle(app).dataset.state === 'read');
  assert.equal(app.main.querySelector('.pdf-assistant .reader-read-state'), null);
  const several = payload('问题', '回答甲');
  several.messages[0].id = 'user-3';
  several.messages[1].id = 'assistant-3';
  several.messages.push({ id: 'assistant-4', role: 'assistant', text: '回答乙' });
  several.capturedAt = '2026-10-11T00:00:00.000Z';
  several.completeness = { verified: true, count: 3, questions: 1, firstMessageId: 'user-3', lastMessageId: 'assistant-4' };
  await store.saveConversation(several);
  app.get('reader-open').click();
  app.get('reader-library-list').querySelector('.reader-library-open').click();
  await waitFor(() => app.main.querySelectorAll('.pdf-assistant').length === 2 && !app.get('start-export').disabled);
  assert.equal(app.get('preview-sidebar').querySelectorAll('.reader-read-dot').length, 1);
  app.get('preview-sidebar').querySelector('.reader-read-dot').click();
  await waitFor(() => [...app.main.querySelectorAll('.pdf-assistant .reader-read-toggle')].every((node) => node.dataset.state === 'read'));
  assert.equal(userToggle(app), null);
  assert.match(app.get('reader-meta').textContent, /已读 2\/2/);
});

test('another reader tab receives read marks without refreshing annotations', async (t) => {
  const channels = new Set();
  class Channel {
    constructor() { channels.add(this); }
    postMessage(data) {
      for (const channel of channels) if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data }));
    }
  }
  const factory = new IDBFactory();
  const url = payload().sourceUrl;
  const first = fixture({ factory, BroadcastChannel: Channel, initial: url });
  const second = fixture({ factory, BroadcastChannel: Channel, initial: url });
  t.after(() => { channels.clear(); first.w.close(); second.w.close(); });
  await first.w.ChatGPTReaderStore.saveConversation(payload());
  await first.start();
  await second.start();
  assert.equal(second.main.querySelectorAll('mark').length, 0);
  answerToggle(first).click();
  await waitFor(() => answerToggle(second).dataset.state === 'read');
  assert.equal(second.main.querySelectorAll('mark').length, 0);
  assert.match(second.get('reader-meta').textContent, /1\/1 read/);
});
