const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, payload } = require('./helpers/reader.cjs');

function setup(t, handler) {
  const app = fixture(); t.after(() => app.w.close());
  const calls = [], pending = { requestId: 'one', headId: 'assistant-1', prompt: 'A follow-up question', startedAt: new Date().toISOString() };
  const next = payload(); next.messages.push({ id: 'user-2', role: 'user', text: pending.prompt }, { id: 'assistant-2', role: 'assistant', text: 'New reply' });
  next.completeness = { verified: true, count: 4, questions: 2, firstMessageId: 'user-1', lastMessageId: 'assistant-2' };
  app.w.navigator.locks = { request: async (name, options, run) => { calls.push(['lock', name, options]); return run({}); } };
  app.w.chrome.tabs.query = async () => { throw new Error('Must not reuse user tabs'); };
  app.w.chrome.tabs.get = async id => ({ id, status: 'complete', url: payload().sourceUrl });
  app.w.chrome.tabs.remove = async id => calls.push(['remove', id]);
  app.w.chrome.tabs.create = async options => { calls.push(['create', options]); return { id: 90 }; };
  app.w.chrome.scripting.executeScript = async options => calls.push(['inject', options]);
  app.w.chrome.debugger = {
    attach: async target => calls.push(['attach', target]), detach: async target => calls.push(['detach', target]),
    sendCommand: async (target, method, args) => calls.push(['input', target, method, args])
  };
  app.w.chrome.tabs.sendMessage = async (id, message) => {
    calls.push([message.type, id, message]);
    if (handler) { const response = await handler(message, next); if (response !== undefined) return response; }
    if (message.type === 'CHAT_INSPECT') return { ok: true, complete: true, userId: 'user-2' };
    if (message.type === 'READ_FULL_CONVERSATION') return { ok: true, payload: next };
    return { ok: true };
  };
  return { ...app, calls, pending, next, send: options => app.w.ChatGPTReaderChatSession.send(payload(), pending, { interval: 0, ...options }) };
}

test('send creates a background tab and persists intent before its single click; closes and detaches afterward', async t => {
  const app = setup(t);
  const result = await app.send({ beforeCommit: async () => app.calls.push(['persist']) });
  assert.equal(result.payload.messages.length, 4);
  assert.equal(app.calls.find(x => x[0] === 'create')[1].active, false);
  assert.equal(app.calls.find(x => x[0] === 'input')[2], 'Input.insertText');
  assert.ok(app.calls.findIndex(x => x[0] === 'persist') < app.calls.findIndex(x => x[0] === 'CHAT_COMMIT'));
  assert.equal(app.calls.filter(x => x[0] === 'CHAT_COMMIT').length, 1);
  assert.deepEqual(app.calls.filter(x => ['attach', 'detach', 'remove'].includes(x[0])).map(x => [x[0], x[1].tabId || x[1]]),
    [['attach', 90], ['detach', 90], ['remove', 90]]);
});

test('ambiguous sends keep their own tab and check-reply never inserts or sends a question again', async t => {
  let fail = true;
  const app = setup(t, message => { if (message.type === 'CHAT_COMMIT' && fail) throw new Error('Connection lost'); });
  await assert.rejects(app.send(), error => error.uncertain === true);
  assert.equal(app.calls.filter(x => x[0] === 'remove').length, 0);
  assert.equal(app.calls.filter(x => x[0] === 'detach').length, 1);
  fail = false; app.calls.length = 0;
  await app.send({ checking: true });
  assert.equal(app.calls.filter(x => ['input', 'CHAT_PREPARE', 'CHAT_COMMIT'].includes(x[0])).length, 0);
  assert.equal(app.calls.filter(x => x[0] === 'remove').length, 1);
});

test('storage failure before commit and known branch rejection do not send and clean up the owned tab', async t => {
  const app = setup(t, message => message.type === 'CHAT_COMMIT' ? { ok: false, error: 'Branch changed' } : undefined);
  await assert.rejects(app.send({ beforeCommit: async () => { throw new Error('Storage full'); } }), error => !error.uncertain);
  assert.equal(app.calls.filter(x => x[0] === 'CHAT_COMMIT').length, 0);
  assert.equal(app.calls.filter(x => x[0] === 'remove').length, 1);
  app.calls.length = 0;
  await assert.rejects(app.send(), error => !error.uncertain);
  assert.equal(app.calls.filter(x => x[0] === 'CHAT_COMMIT').length, 1);
  assert.equal(app.calls.filter(x => x[0] === 'remove').length, 1);
});

test('another reader lock, shared conversations and wrong tab URLs block sending', async t => {
  const app = setup(t);
  app.w.navigator.locks.request = async (_, __, run) => run(null);
  await assert.rejects(app.send(), /Another reader/); assert.equal(app.calls.length, 0);
  app.w.navigator.locks.request = async (_, __, run) => run({});
  await assert.rejects(app.w.ChatGPTReaderChatSession.send({ ...payload(), sourceUrl: 'https://chatgpt.com/share/test-conversation' }, app.pending), /read-only/);
  app.w.chrome.tabs.get = async () => ({ url: 'https://chatgpt.com/c/different', status: 'complete' });
  await assert.rejects(app.send(), /no longer matches/);
  assert.equal(app.calls.filter(x => x[0] === 'CHAT_COMMIT').length, 0);
});

test('a lost commit response is bounded, saved as uncertain and is never automatically retried', async t => {
  const app = setup(t, message => message.type === 'CHAT_COMMIT' ? new Promise(() => {}) : undefined);
  await assert.rejects(app.send({ responseTimeout: 20 }), error => error.uncertain === true);
  const commits = app.calls.filter(x => x[0] === 'CHAT_COMMIT');
  assert.equal(commits.length, 1); assert.ok(commits[0][2].expiresAt > 0);
  assert.equal(app.calls.filter(x => x[0] === 'remove').length, 0);
});
