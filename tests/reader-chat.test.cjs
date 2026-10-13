const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, payload, select, waitFor, IDBFactory } = require('./helpers/reader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

async function open(t, options = {}) {
  const app = fixture({ initial: payload().sourceUrl, ...options }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  await app.start();
  app.get('reader-chat-toggle').click();
  return app;
}
function type(app, value) {
  app.get('reader-chat-input').value = value;
  app.get('reader-chat-input').dispatchEvent(new app.w.Event('input', { bubbles: true }));
}
function send(app) { app.get('reader-chat-form').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true })); }
function result(question) {
  const next = payload();
  next.capturedAt = '2026-10-13T02:03:04.000Z';
  next.messages.push({ id: 'user-2', role: 'user', text: question }, { id: 'assistant-2', role: 'assistant', text: '## A new reply\n\nUseful **details** for this follow-up.' });
  next.completeness = { verified: true, count: 4, questions: 2, firstMessageId: 'user-1', lastMessageId: 'assistant-2' };
  return { payload: next, userId: 'user-2', answers: [next.messages[3]] };
}

test('Enter inserts a newline in the textarea and does not submit, even with modifiers or IME', async t => {
  const app = await open(t); let sends = 0;
  app.w.ChatGPTReaderChatSession.send = async () => { sends++; };
  type(app, 'First line');
  for (const options of [{}, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) {
    const event = new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    assert.equal(app.get('reader-chat-input').dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(app.get('reader-chat-input').tagName, 'TEXTAREA');
  assert.equal(sends, 0);
});

test('drafts and selected quotes are saved per conversation and restored after reopening', async t => {
  const factory = new IDBFactory(), app = await open(t, { factory });
  type(app, 'Why does this work?\nPlease explain.');
  await waitFor(async () => (await app.w.ChatGPTReaderStore.getDraft('c:test-conversation'))?.text.includes('Please explain'));
  app.w.document.dispatchEvent(new app.w.CustomEvent('reader-quote-question', { detail: { messageId: 'assistant-1', quote: 'important text' } }));
  await waitFor(async () => (await app.w.ChatGPTReaderStore.getDraft('c:test-conversation'))?.quote === 'important text');
  const reopened = fixture({ factory, initial: payload().sourceUrl }); t.after(() => reopened.w.close());
  await reopened.start(); reopened.get('reader-chat-toggle').click();
  assert.equal(reopened.get('reader-chat-input').value, 'Why does this work?\nPlease explain.');
  assert.equal(reopened.get('reader-chat-quote-text').textContent, 'important text');
  assert.equal(reopened.get('reader-annotations').hidden, true);
  reopened.get('reader-toggle').click();
  assert.equal(reopened.get('reader-chat').hidden, true);
  assert.equal(reopened.get('reader-annotations').hidden, false);
  const other = { ...payload(), sourceUrl: 'https://chatgpt.com/c/another', title: 'Another chat' };
  await reopened.w.ChatGPTReaderStore.saveConversation(other);
  reopened.get('conversation-url').value = other.sourceUrl;
  reopened.get('export-form').dispatchEvent(new reopened.w.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => reopened.get('reader-heading').textContent === 'Another chat' && !reopened.get('start-export').disabled);
  reopened.get('reader-chat-toggle').click();
  assert.equal(reopened.get('reader-chat-input').value, '');
  assert.equal(reopened.get('reader-chat-quote').hidden, true);
});

test('a follow-up is saved before sending, adds a new question/reply and preserves notes, read marks and reading position', async t => {
  const app = await open(t);
  const key = 'c:test-conversation', store = app.w.ChatGPTReaderStore;
  const body = app.main.querySelector('[data-message-id="assistant-1"] .pdf-message-body');
  const range = select(app, body, 15, 29);
  const anchor = await app.w.ChatGPTReaderAnchor.capture(range, app.main);
  const now = new Date().toISOString();
  await store.saveAnnotation({ id: 'note', conversationKey: key, messageId: 'assistant-1', anchor: anchor.anchor,
    comment: 'Keep this', createdAt: now, updatedAt: now });
  await waitFor(() => app.main.querySelector('mark.reader-highlight'));
  app.main.querySelector('.reader-read-toggle').click();
  await waitFor(async () => (await store.getReads(key))[0]?.read === true);
  let sends = 0;
  app.w.ChatGPTReaderChatSession.send = async (_, pending, options) => {
    sends++; await options.beforeCommit();
    assert.equal((await store.getDraft(key)).pending.prompt, 'A follow-up');
    return result(pending.prompt);
  };
  let scroll;
  Object.defineProperty(app.w, 'scrollY', { value: 700 });
  app.w.scrollTo = value => { scroll = value; };
  type(app, 'A follow-up'); send(app);
  await waitFor(() => app.get('reader-chat-status').textContent.includes('saved locally'));
  assert.equal(sends, 1);
  assert.equal(app.main.querySelectorAll('.pdf-message').length, 4);
  assert.equal(app.get('preview-sidebar').querySelectorAll('.preview-question-link').length || app.main.querySelectorAll('.pdf-toc > ol > li').length, 2);
  assert.equal(app.main.querySelector('mark.reader-highlight').textContent, 'important text');
  assert.equal((await store.getAnnotations(key))[0].comment, 'Keep this');
  assert.equal((await store.getReads(key))[0].read, true);
  assert.equal(app.main.querySelector('[data-message-id="assistant-2"] .reader-read-toggle').dataset.state, 'unread');
  assert.equal(app.get('reader-chat').hidden, false);
  assert.equal(app.get('reader-chat-input').value, '');
  assert.equal((await store.getDraft(key)).pending, undefined);
  assert.equal(scroll.top, 700);
  const ids = [...app.w.document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('an uncertain send is restored with Check reply; no automatic send on reload or manual check', async t => {
  const factory = new IDBFactory(), app = await open(t, { factory });
  app.w.ChatGPTReaderChatSession.send = async (_, pending, options) => {
    await options.beforeCommit(); const error = new Error('Lost connection'); error.uncertain = true; throw error;
  };
  type(app, 'An uncertain question'); send(app);
  await waitFor(() => !app.get('reader-chat-check').hidden && !app.get('reader-chat-check').disabled);
  const reopened = fixture({ factory, initial: payload().sourceUrl }); t.after(() => reopened.w.close());
  let checks = 0;
  reopened.w.ChatGPTReaderChatSession.send = async (_, pending, options) => {
    checks++; assert.equal(options.checking, true); return result(pending.prompt);
  };
  await reopened.start(); reopened.get('reader-chat-toggle').click();
  assert.equal(checks, 0);
  assert.equal(reopened.get('reader-chat-input').value, 'An uncertain question');
  assert.equal(reopened.get('reader-chat-send').hidden, true);
  reopened.get('reader-chat-check').click();
  await waitFor(() => reopened.get('reader-chat-status').textContent.includes('saved locally'));
  assert.equal(checks, 1);
});

test('restoring an uncertain draft requires confirmation and never sends on its own', async t => {
  const app = await open(t); let sends = 0;
  app.w.ChatGPTReaderChatSession.send = async (_, __, options) => {
    sends++; await options.beforeCommit(); const error = new Error('Lost connection'); error.uncertain = true; throw error;
  };
  type(app, 'Uncertain question'); send(app);
  await waitFor(() => !app.get('reader-chat-restore').hidden);
  app.w.confirm = () => false; app.get('reader-chat-restore').click();
  assert.ok((await app.w.ChatGPTReaderStore.getDraft('c:test-conversation')).pending);
  app.w.confirm = () => true; app.get('reader-chat-restore').click();
  await waitFor(() => !app.get('reader-chat-input').disabled);
  assert.equal(app.get('reader-chat-input').value, 'Uncertain question');
  assert.equal((await app.w.ChatGPTReaderStore.getDraft('c:test-conversation')).pending, undefined);
  assert.equal(sends, 1);
});

test('an already submitted question uses recovery feedback and clears the draft only after saving its reply', async t => {
  const app = await open(t);
  app.w.ChatGPTReaderChatSession.send = async (_, pending, options) => {
    await options.beforeCommit(); options.onState('recovering');
    assert.match(app.get('reader-chat-status').textContent, /already in ChatGPT/);
    return result(pending.prompt);
  };
  type(app, 'Already sent question'); send(app);
  await waitFor(() => app.get('reader-chat-status').textContent.includes('saved locally'));
  assert.equal(app.main.querySelectorAll('.pdf-message').length, 4);
  assert.equal(app.get('reader-chat-input').value, '');
});

test('draft storage failures prevent sending and retain the question', async t => {
  const app = await open(t); let sends = 0;
  app.w.ChatGPTReaderStore.saveDraft = async () => { throw new Error('Disk full'); };
  app.w.ChatGPTReaderChatSession.send = async () => { sends++; };
  type(app, 'Keep my question'); send(app);
  await waitFor(() => app.get('reader-chat-draft-status').textContent.includes('Disk full'));
  assert.equal(sends, 0);
  assert.equal(app.get('reader-chat-input').value, 'Keep my question');
});

test('an in-flight autosave failure blocks switching conversations and preserves the unsaved question', async t => {
  const app = await open(t);
  await app.w.ChatGPTReaderStore.saveConversation({ ...payload(), title: 'Another', sourceUrl: 'https://chatgpt.com/c/another' });
  let reject;
  app.w.ChatGPTReaderStore.saveDraft = () => new Promise((_, fail) => { reject = fail; });
  type(app, 'Do not lose this draft');
  await waitFor(() => typeof reject === 'function');
  app.get('conversation-url').value = 'https://chatgpt.com/c/another';
  app.get('export-form').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
  reject(new Error('Storage full'));
  await waitFor(() => !app.get('start-export').disabled);
  assert.equal(app.get('reader-heading').textContent, 'Reader fixture');
  assert.equal(app.get('reader-chat-input').value, 'Do not lose this draft');
});

test('restoring malformed or orphaned pending drafts fails before changing local conversations', async t => {
  const app = fixture(); t.after(() => app.w.close()); const store = app.w.ChatGPTReaderStore;
  await store.saveConversation(payload());
  const backup = plain(await store.backup());
  backup.drafts = [{ key: 'c:test-conversation', text: 'Question', pending: { requestId: '', prompt: 'Question', headId: 'assistant-1', startedAt: new Date().toISOString() } }];
  await assert.rejects(store.restore(backup));
  assert.equal(await store.getDraft('c:test-conversation'), null);
  assert.equal((await store.listConversations()).length, 1);
  backup.drafts = [{ key: 'c:orphan', text: 'Question' }];
  await assert.rejects(store.restore(backup));
});

test('drafts are included in backup, storage totals and deletion; stale writers cannot overwrite them', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const store = app.w.ChatGPTReaderStore; await store.saveConversation(payload());
  const before = (await store.listConversations())[0].bytes;
  const saved = await store.saveDraft({ key: 'c:test-conversation', text: 'Draft', quote: 'Quoted text', quoteMessageId: 'assistant-1' });
  assert.equal((await store.listConversations())[0].bytes, before + saved.byteSize);
  await assert.rejects(store.saveDraft({ ...saved, text: 'Stale' }, { expectedUpdatedAt: null }), /another reader/);
  const backup = plain(await store.backup()); assert.equal(backup.drafts.length, 1);
  const other = fixture(); t.after(() => other.w.close()); await other.w.ChatGPTReaderStore.restore(backup);
  assert.equal((await other.w.ChatGPTReaderStore.getDraft(saved.key)).quote, 'Quoted text');
  delete backup.drafts; assert.equal(store.validateBackup(backup).drafts.length, 0);
  await store.deleteConversation(saved.key);
  assert.equal(await store.getDraft(saved.key), null);
});
