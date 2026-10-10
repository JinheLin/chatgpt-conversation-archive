const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, setup, select, waitFor, payload, IDBFactory } = require('./helpers/reader.cjs');
const plain = (value) => JSON.parse(JSON.stringify(value));
async function saveQuote(app, id, messageId, exact, createdAt = '2026-10-09T00:00:00.000Z') {
  const section = [...app.main.querySelectorAll('.pdf-message')].find(node => node.dataset.messageId === messageId);
  const text = app.w.ChatGPTReaderAnchor.index(section.querySelector('.pdf-message-body')).text;
  const start = text.indexOf(exact);
  assert.ok(start >= 0);
  return app.w.ChatGPTReaderStore.saveAnnotation({ id, conversationKey: 'c:test-conversation', messageId,
    anchor: await app.w.ChatGPTReaderAnchor.quote(text, start, start + exact.length), comment: '', createdAt, updatedAt: createdAt });
}

test('quote anchors restore unchanged text, relocate unique quotes and refuse ambiguous duplicates', async (t) => {
  const app = fixture(); t.after(() => app.dom.window.close());
  const anchors = app.w.ChatGPTReaderAnchor;
  const original = 'A paragraph with important text and context.';
  const start = original.indexOf('important text');
  const quote = await anchors.quote(original, start, start + 14);
  assert.equal(quote.hash.length, 64);
  assert.deepEqual(plain(await anchors.locate(original, quote)), { start, end: start + 14 });
  assert.equal((await anchors.locate('Added paragraph. ' + original, quote)).start, start + 17);
  assert.equal(await anchors.locate('important text and important text', quote), null);
  assert.equal(await anchors.locate('The quote was removed.', quote), null);
  const duplicated = ('x'.repeat(40) + 'same phrase' + 'y'.repeat(40) + '\n').repeat(2);
  const second = duplicated.lastIndexOf('same phrase');
  const stable = await anchors.quote(duplicated, second, second + 11);
  assert.equal((await anchors.locate(duplicated, stable)).start, second);
  assert.equal(await anchors.locate('changed\n' + duplicated, stable), null);
});

test('cross-format and overlapping highlights preserve paragraph, table and code structure', async (t) => {
  const app = await setup({ payload: payload('Question', 'One **bold phrase** and tail.\n\nNext paragraph.\n\n| A | B |\n| - | - |\n| cell one | cell two |\n\n\`\`\`text\n  abc    def\n\`\`\`') });
  t.after(() => app.dom.window.close());
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  const anchors = app.w.ChatGPTReaderAnchor;
  const before = body.textContent, shape = [body.querySelectorAll('p').length, body.querySelectorAll('table').length, body.querySelector('code').textContent];
  const start = anchors.index(body).text.indexOf('bold phrase');
  const first = await anchors.capture(select(app, body, start, start + 'bold phrase and tail.\n\nNext'.length), app.main);
  assert.ok(first);
  const notes = [
    { id: 'a', messageId: 'assistant-1', anchor: first.anchor, comment: '' },
    { id: 'b', messageId: 'assistant-1', anchor: await anchors.quote(before, start + 5, start + 20), comment: 'Nested note' },
    { id: 'c', messageId: 'assistant-1', anchor: await anchors.quote(before, before.indexOf('cell one'), before.indexOf('cell one') + 8), comment: '' },
    { id: 'd', messageId: 'assistant-1', anchor: await anchors.quote(before, before.indexOf('abc'), before.indexOf('abc') + 10), comment: '' }
  ];
  const result = await anchors.apply(app.main, notes);
  assert.ok([...result.values()].every((value) => value && value.end > value.start));
  assert.equal(body.textContent, before);
  assert.equal(body.querySelectorAll('p').length, shape[0]);
  assert.equal(body.querySelectorAll('table').length, shape[1]);
  assert.equal(body.querySelector('code').textContent, shape[2]);
  assert.ok(body.querySelector('strong mark'));
  assert.ok(body.querySelector('td mark'));
  assert.ok(body.querySelector('code mark'));
  assert.ok([...body.querySelectorAll('mark')].some((node) => JSON.parse(node.dataset.annotationIds).length === 2));
  await anchors.apply(app.main, notes);
  assert.equal(body.textContent, before);
  assert.equal(body.querySelectorAll('mark mark').length, 0);
  anchors.clear(app.main);
  assert.equal(body.textContent, before);
  assert.equal(body.querySelectorAll('mark').length, 0);
});

test('selection uses element boundaries safely and excludes math, SVG and cross-message selections', async (t) => {
  const app = await setup({ payload: payload('Question', 'Plain text with $x+1$ and trailing text.') });
  t.after(() => app.dom.window.close());
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  const paragraph = body.querySelector('p'), range = app.w.document.createRange();
  range.setStart(paragraph, 0); range.setEnd(paragraph, 1);
  const quote = await app.w.ChatGPTReaderAnchor.capture(range, app.main);
  assert.equal(quote.anchor.exact, 'Plain text with ');
  range.selectNodeContents(paragraph);
  assert.equal(await app.w.ChatGPTReaderAnchor.capture(range, app.main), null);
  range.setStart(app.main.querySelector('.pdf-user p').firstChild, 0);
  range.setEnd(paragraph.lastChild, 1);
  assert.equal(await app.w.ChatGPTReaderAnchor.capture(range, app.main), null);
  body.innerHTML = '<p>Text <svg><text>diagram</text></svg> tail</p>';
  range.selectNodeContents(body.querySelector('p'));
  assert.equal(await app.w.ChatGPTReaderAnchor.capture(range, app.main), null);
});

test('highlights and comments survive closing the reader and reopening the same conversation', async (t) => {
  const factory = new IDBFactory();
  const app = await setup({ factory, locale: 'zh-CN' });
  t.after(() => app.dom.window.close());
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  const text = app.w.ChatGPTReaderAnchor.index(body).text, start = text.indexOf('important');
  select(app, body, start, start + 14);
  app.w.document.dispatchEvent(new app.w.MouseEvent('mouseup'));
  await waitFor(() => !app.get('reader-selection').hidden);
  app.get('reader-add-comment').click();
  assert.equal(app.get('reader-editor').hidden, false);
  app.get('reader-comment').value = '重点理解这里 <script>alert(1)</script>';
  app.get('reader-save-comment').click();
  await waitFor(() => app.get('reader-status').textContent === '批注已保存到本地。');
  assert.equal(app.main.querySelector('mark').dataset.comment, 'true');
  assert.ok(app.get('reader-annotation-list').textContent.includes('<script>alert(1)</script>'));
  assert.equal(app.get('reader-annotation-list').querySelector('script'), null);
  const reopened = await setup({ factory });
  t.after(() => reopened.dom.window.close());
  assert.equal(reopened.main.querySelector('mark').textContent, 'important text');
  assert.equal(reopened.get('reader-annotations').hidden, false);
  reopened.get('reader-annotation-list').querySelector('.reader-quote').click();
  assert.equal(reopened.main.querySelector('mark').dataset.scrolled, 'true');
  reopened.get('reader-annotation-list').querySelector('.reader-note-controls button').click();
  reopened.get('reader-comment').value = 'Edited comment';
  reopened.get('reader-save-comment').click();
  await waitFor(() => reopened.get('reader-status').textContent === 'Annotation saved locally.');
  assert.equal((await reopened.w.ChatGPTReaderStore.getAnnotations('c:test-conversation'))[0].comment, 'Edited comment');
  reopened.get('reader-annotation-list').querySelectorAll('.reader-note-controls button')[1].click();
  await waitFor(async () => (await reopened.w.ChatGPTReaderStore.getAnnotations('c:test-conversation')).length === 0);
  await waitFor(() => reopened.main.querySelectorAll('mark').length === 0);
});

test('annotation cards follow message and text position, use creation time for ties and retain order after editing and reopening', async (t) => {
  const data = payload('First question', 'Alpha passage followed by **Omega passage**.');
  data.messages.push({ id: 'user-2', role: 'user', text: 'Second question' },
    { id: 'assistant-2', role: 'assistant', text: 'Last response' });
  Object.assign(data.completeness, { count: 4, questions: 2, lastMessageId: 'assistant-2' });
  const app = await setup({ payload: data }); t.after(() => app.w.close());
  await saveQuote(app, 'z-last', 'assistant-2', 'Last response', '2026-10-09T00:00:00.000Z');
  await saveQuote(app, 'a-omega', 'assistant-1', 'Omega passage', '2026-10-09T00:00:01.000Z');
  await saveQuote(app, 'a-alpha-newer', 'assistant-1', 'Alpha passage', '2026-10-09T00:00:03.000Z');
  const older = await saveQuote(app, 'z-alpha-older', 'assistant-1', 'Alpha passage', '2026-10-09T00:00:02.000Z');
  await saveQuote(app, 'a-second-question', 'user-2', 'Second question', '2026-10-09T00:00:04.000Z');
  await saveQuote(app, 'z-first-question', 'user-1', 'First question', '2026-10-09T00:00:05.000Z');
  const expected = ['z-first-question', 'z-alpha-older', 'a-alpha-newer', 'a-omega', 'a-second-question', 'z-last'];
  const order = app => [...app.get('reader-annotation-list').children].map(node => node.dataset.annotationId);
  await app.reader.refresh();
  assert.deepEqual(order(app), expected);
  await app.w.ChatGPTReaderStore.saveAnnotation({ ...older, comment: 'Edited later' }, older.updatedAt);
  await app.reader.refresh();
  assert.deepEqual(order(app), expected);
  app.get('reader-annotation-list').querySelector('.reader-quote').click();
  assert.equal(app.main.querySelector('.pdf-user mark').dataset.scrolled, 'true');
  const reopened = await setup({ factory: app.factory, payload: data }); t.after(() => reopened.w.close());
  assert.deepEqual(order(reopened), expected);
});

test('annotation order follows relocated quotes after a message changes rather than stale saved offsets', async (t) => {
  const app = await setup({ payload: payload('Question', 'Alpha passage. ' + 'Context. '.repeat(20) + 'Omega passage.') });
  t.after(() => app.w.close());
  await saveQuote(app, 'alpha', 'assistant-1', 'Alpha passage');
  await saveQuote(app, 'omega', 'assistant-1', 'Omega passage');
  await app.reader.refresh();
  const changed = payload('Question', 'Omega passage. ' + 'New context. '.repeat(25) + 'Alpha passage.');
  await app.w.ChatGPTPdfExporter.render(changed, app.main);
  await app.w.ChatGPTReaderStore.saveConversation(changed);
  await app.reader.load('c:test-conversation');
  const order = app => [...app.get('reader-annotation-list').children].map(node => node.dataset.annotationId);
  assert.deepEqual(order(app), ['omega', 'alpha']);
  assert.deepEqual([...app.main.querySelectorAll('mark')].map(node => node.textContent), ['Omega passage', 'Alpha passage']);
  const saved = await app.w.ChatGPTReaderStore.getAnnotations('c:test-conversation');
  assert.ok(saved.find(note => note.id === 'alpha').anchor.start < saved.find(note => note.id === 'omega').anchor.start);
  const reopened = await setup({ factory: app.factory, payload: changed }); t.after(() => reopened.w.close());
  assert.deepEqual(order(reopened), ['omega', 'alpha']);
});

test('unresolved annotations retain their saved position and annotations for missing messages remain at the end', async (t) => {
  const app = await setup({ payload: payload('First question', 'Alpha passage followed by Omega passage.') });
  t.after(() => app.w.close());
  await saveQuote(app, 'missing-message', 'user-1', 'First question');
  await saveQuote(app, 'missing-quote', 'assistant-1', 'Alpha passage');
  await saveQuote(app, 'resolved', 'assistant-1', 'Omega passage');
  const changed = payload('Replacement question', 'Changed passage followed by Omega passage.');
  changed.messages[0].id = changed.completeness.firstMessageId = 'user-replacement';
  await app.w.ChatGPTPdfExporter.render(changed, app.main);
  await app.reader.load('c:test-conversation');
  const cards = [...app.get('reader-annotation-list').children];
  assert.deepEqual(cards.map(node => node.dataset.annotationId), ['missing-quote', 'resolved', 'missing-message']);
  assert.equal(cards.filter(node => node.querySelector('.reader-unresolved')).length, 2);
  assert.equal(app.main.querySelector('mark').textContent, 'Omega passage');
});

test('changed messages preserve unresolved annotations and do not put them on a different message', async (t) => {
  const app = await setup(); t.after(() => app.dom.window.close());
  const store = app.w.ChatGPTReaderStore, anchors = app.w.ChatGPTReaderAnchor;
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body'), text = anchors.index(body).text;
  const start = text.indexOf('important');
  const now = new Date().toISOString();
  await store.saveAnnotation({ id: 'annotation', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor: await anchors.quote(text, start, start + 14), comment: 'Keep this note', createdAt: now, updatedAt: now });
  const changed = payload('Question', 'A different answer.');
  changed.messages[1].id = changed.completeness.lastMessageId = 'assistant-replacement';
  changed.messages.push({ id: 'assistant-2', role: 'assistant', text: 'important text' });
  changed.completeness.count = 3; changed.completeness.lastMessageId = 'assistant-2';
  await app.w.ChatGPTPdfExporter.render(changed, app.main);
  await app.reader.load('c:test-conversation');
  assert.equal(app.main.querySelectorAll('mark').length, 0);
  assert.match(app.get('reader-annotation-list').textContent, /Original text changed/);
  assert.match(app.get('reader-annotation-list').textContent, /Keep this note/);
  assert.equal((await store.getAnnotations('c:test-conversation')).length, 1);
});

test('failed local writes keep the comment draft and never display a saved highlight', async (t) => {
  const app = await setup(); t.after(() => app.dom.window.close());
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  select(app, body, 0, 9);
  app.w.document.dispatchEvent(new app.w.MouseEvent('mouseup'));
  await waitFor(() => !app.get('reader-selection').hidden);
  app.get('reader-add-comment').click();
  app.get('reader-comment').value = 'Unsaved but retained';
  app.w.ChatGPTReaderStore.saveAnnotation = async () => { throw new Error('Disk full'); };
  app.get('reader-save-comment').click();
  await waitFor(() => app.get('reader-status').textContent.includes('Disk full'));
  assert.equal(app.get('reader-comment').value, 'Unsaved but retained');
  assert.equal(app.get('reader-editor').hidden, false);
  assert.equal(app.main.querySelectorAll('mark').length, 0);
  app.w.confirm = () => false;
  assert.equal(app.reader.canLeave(), false);
});

test('IndexedDB backup merges newer notes, keeps deletions, rejects malformed imports atomically and strips unknown fields', async (t) => {
  const app = await setup(); t.after(() => app.dom.window.close());
  const store = app.w.ChatGPTReaderStore;
  const now = new Date().toISOString();
  const note = await store.saveAnnotation({
    id: 'one', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor: await app.w.ChatGPTReaderAnchor.quote('Important text', 0, 9),
    comment: 'Original', createdAt: now, updatedAt: now, accessToken: 'must-not-be-saved'
  });
  assert.equal(note.accessToken, undefined);
  const original = plain(await store.backup());
  const second = await setup({ factory: new IDBFactory() }); t.after(() => second.dom.window.close());
  await second.w.ChatGPTReaderStore.restore(original);
  assert.equal((await second.w.ChatGPTReaderStore.getAnnotations('c:test-conversation'))[0].comment, 'Original');
  const edited = await store.saveAnnotation({ ...note, comment: 'Newer' }, note.updatedAt);
  await assert.rejects(store.saveAnnotation({ ...note, comment: 'Stale tab' }, note.updatedAt), /another reader tab/);
  await store.restore(original);
  assert.equal((await store.getAnnotations('c:test-conversation'))[0].comment, 'Newer');
  await store.deleteAnnotation(edited);
  await store.restore(original);
  assert.equal((await store.getAnnotations('c:test-conversation')).length, 0);
  const invalid = plain(original);
  invalid.annotations[0].anchor.end = -1;
  await assert.rejects(store.restore(invalid), /Invalid/);
  assert.equal((await store.getAnnotations('c:test-conversation')).length, 0);
  assert.equal((await store.listConversations()).length, 1);
  const unrelated = plain(original);
  unrelated.annotations[0].conversationKey = 'c:unknown';
  await assert.rejects(store.restore(unrelated), /Invalid/);
});

test('the full reader opens an offline snapshot without reading ChatGPT and restores annotations on explicit update', async (t) => {
  const app = fixture({ initial: 'https://chatgpt.com/c/test-conversation' });
  t.after(() => app.dom.window.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  const anchor = await app.w.ChatGPTReaderAnchor.quote('An answer with important text and more detail.\n', 15, 29);
  const now = new Date().toISOString();
  await app.w.ChatGPTReaderStore.saveAnnotation({ id: 'one', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor, comment: 'My comment', createdAt: now, updatedAt: now });
  await app.start();
  assert.equal(app.requests.length, 0);
  assert.match(app.get('export-status').textContent, /local conversation/);
  assert.equal(app.main.querySelector('mark').textContent, 'important text');
  app.get('reader-update').click();
  await waitFor(() => app.requests.length === 1 && !app.get('start-export').disabled);
  assert.equal(app.main.querySelector('mark').textContent, 'important text');
  assert.equal(app.get('reader-library-list').querySelectorAll('.reader-library-open').length, 1);
});

test('HTML export keeps the original formatted document and excludes private annotations and reader controls', async (t) => {
  const app = fixture({ initial: 'https://chatgpt.com/c/test-conversation' });
  t.after(() => app.dom.window.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  const now = new Date().toISOString();
  await app.w.ChatGPTReaderStore.saveAnnotation({
    id: 'one', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor: await app.w.ChatGPTReaderAnchor.quote('An answer with important text and more detail.\n', 15, 29),
    comment: 'A private comment only for the reader', createdAt: now, updatedAt: now
  });
  await app.start();
  assert.ok(app.main.querySelector('mark'));
  app.get('save-html').click();
  await waitFor(() => app.downloads.length === 1);
  const text = await new Promise((resolve, reject) => {
    const reader = new app.w.FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject;
    reader.readAsText(app.downloads[0]);
  });
  const exported = new app.w.DOMParser().parseFromString(text, 'text/html');
  assert.equal(exported.querySelectorAll('mark, script, #reader-annotations, #reader-selection').length, 0);
  assert.equal(exported.querySelector('strong').textContent, 'important text');
  assert.equal(exported.querySelector('.pdf-toc a').getAttribute('href'), '#question-1');
  assert.ok(!exported.body.textContent.includes('A private comment only for the reader'));
  assert.ok(app.main.querySelector('mark')); // Export never mutates the live reader.
});

test('backup and restore controls work without a current conversation and expose imported offline snapshots', async (t) => {
  const app = fixture(); t.after(() => app.dom.window.close());
  await app.start();
  assert.equal(app.requests.length, 0);
  const source = await setup(); t.after(() => source.dom.window.close());
  const backup = await source.w.ChatGPTReaderStore.backup();
  const fileInput = app.get('reader-backup-file');
  Object.defineProperty(fileInput, 'files', { value: [{ size: 5000, text: async () => JSON.stringify(backup) }], configurable: true });
  fileInput.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => app.get('export-status').textContent.includes('Backup merged'));
  assert.equal(app.get('reader-library-list').querySelectorAll('.reader-library-open').length, 1);
  app.get('reader-library-list').querySelector('.reader-library-open').click();
  await waitFor(() => !app.main.hidden && !app.get('start-export').disabled);
  assert.equal(app.requests.length, 0);
  app.get('reader-backup').click();
  await waitFor(() => app.downloads.length === 1);
  const exported = await new Promise((resolve) => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(JSON.parse(reader.result));
    reader.readAsText(app.downloads[0]);
  });
  assert.equal(exported.conversations.length, 1);
  assert.equal(exported.version, 1);
});

test('reader tabs synchronize persisted notes and preserve a conflicting edit as a draft', async (t) => {
  const channels = new Set();
  class Channel {
    constructor() { channels.add(this); }
    postMessage(data) {
      for (const channel of channels) if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data }));
    }
  }
  const factory = new IDBFactory();
  const first = await setup({ factory, BroadcastChannel: Channel });
  const second = await setup({ factory, BroadcastChannel: Channel });
  t.after(() => { channels.clear(); first.dom.window.close(); second.dom.window.close(); });
  const now = new Date().toISOString();
  const value = await first.w.ChatGPTReaderStore.saveAnnotation({
    id: 'one', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor: await first.w.ChatGPTReaderAnchor.quote('An answer with important text and more detail.\n', 15, 29),
    comment: 'Shared local note', createdAt: now, updatedAt: now
  });
  await waitFor(() => second.main.querySelector('mark') && first.main.querySelector('mark'));
  second.get('reader-annotation-list').querySelector('.reader-note-controls button').click();
  second.get('reader-comment').value = 'My unsaved edit';
  await first.w.ChatGPTReaderStore.saveAnnotation({ ...plain(value), comment: 'Changed in first tab' }, value.updatedAt);
  await waitFor(() => second.get('reader-annotation-list').textContent.includes('Changed in first tab'));
  second.get('reader-save-comment').click();
  await waitFor(() => second.get('reader-status').textContent.includes('another reader tab'));
  assert.equal(second.get('reader-comment').value, 'My unsaved edit');
  assert.equal((await first.w.ChatGPTReaderStore.getAnnotations('c:test-conversation'))[0].comment, 'Changed in first tab');
});

test('a colliding imported annotation aborts all imported snapshot writes', async (t) => {
  const app = await setup(); t.after(() => app.dom.window.close());
  const store = app.w.ChatGPTReaderStore, now = new Date().toISOString();
  await store.saveAnnotation({
    id: 'collision', conversationKey: 'c:test-conversation', messageId: 'assistant-1',
    anchor: await app.w.ChatGPTReaderAnchor.quote('Important', 0, 9),
    comment: 'Original', createdAt: now, updatedAt: now
  });
  const data = plain(await store.backup());
  data.conversations[0].key = 'c:another-conversation';
  data.conversations[0].payload.sourceUrl = 'https://chatgpt.com/c/another-conversation';
  data.annotations[0].conversationKey = 'c:another-conversation';
  await assert.rejects(store.restore(data), /Invalid/);
  assert.equal((await store.listConversations()).length, 1);
  assert.equal(await store.getConversation('c:another-conversation'), null);
  assert.equal((await store.getAnnotations('c:test-conversation'))[0].comment, 'Original');
});
