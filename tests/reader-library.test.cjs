const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, payload, select, waitFor, IDBFactory } = require('./helpers/reader.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const logicalBytes = value => {
  const { byteSize, ...data } = plain(value);
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
};
function secondPayload() {
  return { ...payload('Another question', 'Another answer'), title: 'Another conversation',
    sourceUrl: 'https://chatgpt.com/c/another-conversation' };
}
async function note(app, id = 'one', key = 'c:test-conversation') {
  const now = new Date().toISOString();
  return app.w.ChatGPTReaderStore.saveAnnotation({ id, conversationKey: key, messageId: 'assistant-1',
    anchor: await app.w.ChatGPTReaderAnchor.quote('An answer with important text and more detail.\n', 15, 29),
    comment: '本地评论', createdAt: now, updatedAt: now });
}
const row = (app, key = 'c:test-conversation') => app.get('reader-library-list').querySelector(`[data-key="${key}"]`);
const total = app => Number(app.get('reader-library-size').dataset.bytes);

test('storage estimates include UTF-8 text, embedded assets and all annotation records, and imports recompute them', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore, first = payload('中文问题');
  first.messages[1].assets = [{ label: 'Embedded image', dataUrl: 'data:image/png;base64,YWJjZA==' }];
  await store.saveConversation(first);
  await store.saveConversation(secondPayload());
  let annotation = await note(app);
  annotation = await store.saveAnnotation({ ...annotation, comment: 'A much longer edited comment.' }, annotation.updatedAt);
  await store.deleteAnnotation(annotation); // Tombstones still occupy local storage.
  const data = await store.backup();
  const entries = await store.listConversations();
  for (const entry of entries) {
    const snapshot = data.conversations.find(value => value.key === entry.key);
    const expected = logicalBytes(snapshot) + data.annotations.filter(value => value.conversationKey === entry.key)
      .reduce((sum, value) => sum + logicalBytes(value), 0);
    assert.equal(entry.bytes, expected);
    assert.equal(snapshot.byteSize, logicalBytes(snapshot));
    assert.equal(entry.payload, undefined); // Library metadata does not carry full bodies/assets.
  }
  const other = fixture(); t.after(() => other.w.close());
  const imported = plain(data);
  for (const entry of [...imported.conversations, ...imported.annotations]) entry.byteSize = -999;
  await other.w.ChatGPTReaderStore.restore(imported);
  assert.deepEqual(plain(await other.w.ChatGPTReaderStore.listConversations()), plain(entries));
  const updated = { ...first, capturedAt: '2026-10-10T00:00:00.000Z', title: 'Updated title' };
  updated.messages[1].text += 'Additional text';
  await store.saveConversation(updated);
  const changed = (await store.listConversations()).find(entry => entry.key === 'c:test-conversation');
  const backup = await store.backup();
  assert.equal(changed.bytes, logicalBytes(backup.conversations.find(entry => entry.key === changed.key)) + logicalBytes(backup.annotations[0]));
});

test('version 1 IndexedDB upgrades preserve old conversations and notes and add size metadata once', async t => {
  const factory = new IDBFactory();
  const app = fixture({ factory }); t.after(() => app.w.close());
  const snapshot = { key: 'c:test-conversation', payload: payload(), savedAt: '2026-10-09T01:02:03.000Z' };
  const annotation = { id: 'legacy', conversationKey: snapshot.key, messageId: 'assistant-1',
    anchor: await app.w.ChatGPTReaderAnchor.quote('Important text', 0, 9), comment: 'Legacy comment',
    createdAt: snapshot.savedAt, updatedAt: snapshot.savedAt };
  const old = await new Promise((resolve, reject) => {
    const request = factory.open('chatgpt-conversation-reader', 1);
    request.onupgradeneeded = () => {
      const conversations = request.result.createObjectStore('conversations', { keyPath: 'key' });
      conversations.createIndex('summary', ['savedAt', 'payload.title', 'payload.sourceUrl', 'payload.capturedAt', 'payload.completeness.count', 'key']);
      conversations.put(plain(snapshot));
      const annotations = request.result.createObjectStore('annotations', { keyPath: 'id' });
      annotations.createIndex('conversationKey', 'conversationKey'); annotations.put(plain(annotation));
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  old.close();
  const entries = await app.w.ChatGPTReaderStore.listConversations();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].bytes, logicalBytes(snapshot) + logicalBytes(annotation));
  assert.deepEqual(plain((await app.w.ChatGPTReaderStore.getConversation(snapshot.key)).payload), snapshot.payload);
  assert.equal((await app.w.ChatGPTReaderStore.getAnnotations(snapshot.key))[0].comment, 'Legacy comment');
  const migrated = await app.w.ChatGPTReaderStore.backup();
  assert.equal(migrated.conversations[0].byteSize, logicalBytes(snapshot));
  assert.equal(migrated.annotations[0].byteSize, logicalBytes(annotation));
});

test('deleting a conversation clears its snapshot and active/deleted annotations, preserves other chats and prevents orphan saves', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore;
  await store.saveConversation(payload()); await store.saveConversation(secondPayload());
  const active = await note(app);
  await store.deleteAnnotation(await note(app, 'deleted'));
  await note(app, 'other-note', 'c:another-conversation');
  const previous = plain(await store.backup());
  await store.deleteConversation('c:test-conversation');
  assert.equal(await store.getConversation('c:test-conversation'), null);
  assert.equal((await store.getAnnotations('c:test-conversation')).length, 0);
  const data = await store.backup();
  assert.deepEqual(data.conversations.map(entry => entry.key), ['c:another-conversation']);
  assert.deepEqual(data.annotations.map(entry => entry.id), ['other-note']);
  await assert.rejects(store.saveAnnotation({ ...active, comment: 'Stale tab' }, active.updatedAt), /Save the conversation locally/);
  await store.deleteConversation('c:test-conversation'); // Idempotent.
  await store.restore(previous); // Explicitly restoring a backup can restore deleted conversations.
  assert.ok(await store.getConversation('c:test-conversation'));
  assert.equal((await store.getAnnotations('c:test-conversation')).length, 1);
});

for (const locale of ['en', 'zh-CN']) {
  test('library shows per-conversation/total estimates and tracks notes, including tombstones (' + locale + ')', async t => {
    const app = fixture({ locale }); t.after(() => app.w.close());
    const store = app.w.ChatGPTReaderStore;
    await store.saveConversation(payload()); await store.saveConversation(secondPayload());
    await app.start();
    const entries = await store.listConversations();
    assert.equal(total(app), entries.reduce((sum, entry) => sum + entry.bytes, 0));
    assert.match(app.get('reader-library-size').textContent, locale === 'zh-CN' ? /本地数据总大小：约/ : /Total local data: approximately/);
    for (const entry of entries) {
      const size = row(app, entry.key).querySelector('.reader-library-entry-size');
      assert.equal(Number(size.dataset.bytes), entry.bytes);
      assert.match(size.textContent, /(?:B|KiB|MiB|GiB)$/);
      assert.match(row(app, entry.key).querySelector('.reader-library-delete').getAttribute('aria-label'), new RegExp(entry.title));
    }
    const before = total(app);
    let annotation = await note(app);
    await waitFor(() => total(app) > before);
    const saved = total(app);
    annotation = await store.saveAnnotation({ ...annotation, comment: 'x'.repeat(5000) }, annotation.updatedAt);
    await waitFor(() => total(app) > saved);
    await store.deleteAnnotation(annotation);
    const expected = (await store.listConversations()).reduce((sum, entry) => sum + entry.bytes, 0);
    await waitFor(() => total(app) === expected);
    assert.ok(total(app) > before);
  });
}

test('cancelled deletion keeps data, deleting another conversation preserves the current document and unsaved comment', async t => {
  const app = fixture({ initial: payload().sourceUrl }); t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore;
  await store.saveConversation(payload()); await store.saveConversation(secondPayload());
  await app.start();
  select(app, app.main.querySelector('.pdf-assistant .pdf-message-body'), 0, 9);
  app.w.document.dispatchEvent(new app.w.MouseEvent('mouseup'));
  await waitFor(() => !app.get('reader-selection').hidden);
  app.get('reader-add-comment').click(); app.get('reader-comment').value = 'Keep this draft';
  const original = app.main.innerHTML;
  const confirmations = [];
  app.w.confirm = text => { confirmations.push(text); return false; };
  row(app, 'c:another-conversation').querySelector('.reader-library-delete').click();
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /Another conversation/);
  assert.match(confirmations[0], /highlights and comments/);
  assert.ok(await store.getConversation('c:another-conversation'));
  app.w.confirm = () => true;
  row(app, 'c:another-conversation').querySelector('.reader-library-delete').click();
  await waitFor(() => !row(app, 'c:another-conversation') && !app.get('start-export').disabled);
  assert.equal(app.main.innerHTML, original);
  assert.equal(app.get('reader-comment').value, 'Keep this draft');
  assert.equal(app.get('reader-editor').hidden, false);
  assert.equal(app.w.document.body.dataset.readerState, 'reading');
  assert.ok(await store.getConversation('c:test-conversation'));
  assert.equal(app.requests.length, 0);
});

test('deleting the current conversation returns to an empty library and clears automatic reimport URL and annotations', async t => {
  const app = fixture({ initial: payload().sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload()); await note(app);
  await app.start(); app.w.location.hash = '#question-1';
  assert.ok(app.main.querySelector('mark'));
  row(app).querySelector('.reader-library-delete').click();
  await waitFor(() => app.w.document.body.dataset.readerState === 'opening' && !app.get('start-export').disabled);
  assert.equal(app.main.hidden, true); assert.equal(app.main.childElementCount, 0);
  assert.equal(app.get('preview-layout').hidden, true);
  assert.equal(app.get('reader-annotations').hidden, true);
  assert.equal(app.get('reader-workspace').hidden, false);
  assert.equal(app.get('output-actions').hidden, true);
  assert.equal(app.get('conversation-url').value, '');
  assert.equal(app.w.location.search, ''); assert.equal(app.w.location.hash, '');
  assert.equal(total(app), 0); assert.match(app.get('reader-library-size').textContent, /0 B/);
  const backup = await app.w.ChatGPTReaderStore.backup();
  assert.equal(backup.conversations.length, 0); assert.equal(backup.annotations.length, 0);
  assert.equal(app.requests.length, 0);
});

test('a current draft blocks deletion and a failed delete keeps the current view and unlocks all controls', async t => {
  const app = fixture({ initial: payload().sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload()); await app.start();
  select(app, app.main.querySelector('.pdf-assistant .pdf-message-body'), 0, 9);
  app.w.document.dispatchEvent(new app.w.MouseEvent('mouseup'));
  await waitFor(() => !app.get('reader-selection').hidden);
  app.get('reader-add-comment').click(); app.get('reader-comment').value = 'Unsaved comment';
  app.w.confirm = () => false;
  row(app).querySelector('.reader-library-delete').click();
  assert.ok(await app.w.ChatGPTReaderStore.getConversation('c:test-conversation'));
  assert.equal(app.get('reader-comment').value, 'Unsaved comment');
  app.w.confirm = () => true;
  let rejectDelete;
  app.w.ChatGPTReaderStore.deleteConversation = () => new Promise((resolve, reject) => { rejectDelete = reject; });
  const before = app.main.innerHTML;
  row(app).querySelector('.reader-library-delete').click();
  assert.equal(row(app).querySelector('.reader-library-delete').disabled, true);
  assert.equal(row(app).querySelector('.reader-library-open').disabled, true);
  assert.equal(app.get('reader-update').disabled, true);
  rejectDelete(new Error('Disk failure'));
  await waitFor(() => !app.get('start-export').disabled);
  assert.match(app.get('export-status').textContent, /Could not delete.*Disk failure/);
  assert.equal(app.get('export-status').dataset.level, 'error');
  assert.equal(app.main.innerHTML, before); assert.equal(app.main.hidden, false);
  assert.equal(app.get('reader-comment').value, 'Unsaved comment');
  assert.ok(await app.w.ChatGPTReaderStore.getConversation('c:test-conversation'));
  assert.equal(row(app).querySelector('.reader-library-delete').disabled, false);
  assert.equal(app.requests.length, 0);
});

test('another reader tab updates library size and deletion without overwriting an editing draft', async t => {
  const channels = new Set();
  class Channel {
    constructor() { channels.add(this); }
    postMessage(data) { for (const channel of channels) if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data })); }
  }
  const factory = new IDBFactory();
  const first = fixture({ factory, BroadcastChannel: Channel });
  const second = fixture({ factory, BroadcastChannel: Channel, initial: payload().sourceUrl });
  t.after(() => { channels.clear(); first.w.close(); second.w.close(); });
  await first.w.ChatGPTReaderStore.saveConversation(payload());
  await first.start(); await second.start();
  select(second, second.main.querySelector('.pdf-assistant .pdf-message-body'), 0, 9);
  second.w.document.dispatchEvent(new second.w.MouseEvent('mouseup'));
  await waitFor(() => !second.get('reader-selection').hidden);
  second.get('reader-add-comment').click(); second.get('reader-comment').value = 'Draft in second tab';
  const before = total(second);
  await note(first); await waitFor(() => total(second) > before);
  await first.w.ChatGPTReaderStore.deleteConversation('c:test-conversation');
  await waitFor(() => total(second) === 0);
  assert.equal(second.get('reader-comment').value, 'Draft in second tab');
  assert.equal(second.get('reader-editor').hidden, false);
  second.get('reader-save-comment').click();
  await waitFor(() => second.get('reader-status').textContent.includes('Save the conversation locally'));
  assert.equal(second.get('reader-comment').value, 'Draft in second tab');
  assert.equal((await first.w.ChatGPTReaderStore.backup()).annotations.length, 0);
});

test('deleting the original source after switching conversations clears the stale source URL without closing the current view', async t => {
  const app = fixture({ initial: payload().sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  await app.w.ChatGPTReaderStore.saveConversation(secondPayload());
  await app.start();
  row(app, 'c:another-conversation').querySelector('.reader-library-open').click();
  await waitFor(() => app.get('reader-heading').textContent === 'Another conversation' && !app.get('start-export').disabled);
  const original = app.main.innerHTML;
  row(app).querySelector('.reader-library-delete').click();
  await waitFor(() => !row(app) && !app.get('start-export').disabled);
  assert.equal(app.main.innerHTML, original);
  assert.equal(app.w.document.body.dataset.readerState, 'reading');
  assert.equal(app.w.location.search, '');
  assert.equal(app.requests.length, 0);
});
