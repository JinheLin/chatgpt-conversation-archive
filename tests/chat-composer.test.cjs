const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, payload } = require('./helpers/reader.cjs');

function composer(t) {
  const app = fixture(); t.after(() => app.w.close());
  app.w.history.replaceState(null, '', app.w.location.href); // Use a DOM with the real source origin below.
  app.dom.reconfigure({ url: payload().sourceUrl });
  app.w.document.body.innerHTML = '<main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button></main>';
  let current = payload(), clicks = 0;
  app.w.ChatGPTPdfSource.read = async () => current;
  const input = app.w.document.getElementById('prompt-textarea');
  const button = app.w.document.querySelector('button'); button.onclick = () => clicks++;
  app.w.eval(fs.readFileSync(require.resolve('../chat-composer.js'), 'utf8'));
  const pending = { source: payload().sourceUrl, headId: 'assistant-1', prompt: 'Why does this work?', requestId: 'one', expiresAt: Date.now() + 60000 };
  return { ...app, input, button, api: app.w.ChatGPTReaderComposer, pending,
    current(value) { current = value; }, clicks: () => clicks };
}

test('a prepared prompt is clicked once, only in the matching visible composer and unchanged branch', async t => {
  const app = composer(t);
  await app.api.prepare(app.pending);
  assert.equal(app.w.document.activeElement, app.input);
  app.input.textContent = app.pending.prompt;
  await app.api.commit(app.pending);
  assert.equal(app.clicks(), 1);
  await assert.rejects(app.api.commit(app.pending), /not yet confirmed/);
  assert.equal(app.clicks(), 1);
});

test('existing drafts, wrong conversations, branch changes and mismatched input never send', async t => {
  const app = composer(t);
  app.input.textContent = 'Existing ChatGPT draft';
  await assert.rejects(app.api.prepare(app.pending), /already contains a draft/);
  assert.equal(app.input.textContent, 'Existing ChatGPT draft');
  await assert.rejects(app.api.prepare({ ...app.pending, source: 'https://chatgpt.com/c/different' }), /no longer matches/);
  app.input.textContent = '';
  await app.api.prepare(app.pending);
  app.input.textContent = 'Unexpected text';
  await assert.rejects(app.api.commit(app.pending), /Could not find/);
  app.input.textContent = app.pending.prompt;
  app.current({ ...payload(), completeness: { ...payload().completeness, lastMessageId: 'changed' } });
  await assert.rejects(app.api.commit(app.pending), /branch changed/);
  assert.equal(app.clicks(), 0);
});

test('reply detection requires the exact submitted question and its single user message', async t => {
  const app = composer(t);
  assert.equal((await app.api.inspect(app.pending)).waiting, true);
  const next = payload();
  next.messages.push({ id: 'user-2', role: 'user', text: app.pending.prompt });
  app.current(next);
  assert.equal((await app.api.inspect(app.pending)).generating, true);
  next.messages.push({ id: 'assistant-2', role: 'assistant', text: 'New answer' });
  const result = await app.api.inspect(app.pending);
  assert.equal(result.complete, true); assert.equal(result.userId, 'user-2');
  next.messages[2].text = 'Someone else asked this';
  await assert.rejects(app.api.inspect(app.pending), /branch changed/);
  next.messages[2].text = app.pending.prompt;
  next.messages.push({ id: 'user-3', role: 'user', text: 'Another question' });
  await assert.rejects(app.api.inspect(app.pending), /branch changed/);
});

test('in-progress payloads are polled without premature completion', async t => {
  const app = composer(t);
  app.w.ChatGPTPdfSource.read = async () => { const error = new Error('Generating'); error.code = 'GENERATING'; throw error; };
  assert.equal((await app.api.inspect(app.pending)).generating, true);
});

test('the current id-less markdown composer and localized submit button are supported without broad content matching', async t => {
  const app = composer(t);
  app.w.document.body.innerHTML = '<main><div contenteditable="true" role="textbox">Unrelated editor</div><form><div data-composer-markdown contenteditable="true" role="textbox" aria-label="询问 ChatGPT"><p><br></p></div><button type="submit" aria-label="发送"></button></form></main>';
  const input = app.w.document.querySelector('[data-composer-markdown]');
  let clicks = 0; app.w.document.querySelector('button').onclick = () => clicks++;
  await app.api.prepare(app.pending);
  assert.equal(app.w.document.activeElement, input);
  input.textContent = app.pending.prompt;
  await app.api.commit(app.pending);
  assert.equal(clicks, 1);
});

test('a delayed or expired commit never clicks after the reader has stopped waiting', async t => {
  const app = composer(t);
  await app.api.prepare(app.pending); app.input.textContent = app.pending.prompt;
  await assert.rejects(app.api.commit({ ...app.pending, expiresAt: Date.now() - 1 }), /not yet confirmed/);
  assert.equal(app.clicks(), 0);
});
