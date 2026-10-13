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
  await assert.rejects(app.api.commit(app.pending, { timeout: 0 }), /not fully written/);
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

test('a multiline quote survives paragraph/soft-break conversion and API blank-line normalization', async t => {
  const app = composer(t);
  app.pending.prompt = 'About this passage:\n\nPack boundaries can differ.\n\nDoes that change row counts?';
  await app.api.prepare(app.pending);
  app.input.innerHTML = '<p><span data-prompt-literal-paste="">About this passage:<br><br>Pack boundaries can differ.<br><br>Does that change row counts?</span></p>';
  // Chromium can expose rendered paragraphs differently from native inserted text.
  Object.defineProperty(app.input, 'innerText', { value: 'About this passage:\nPack boundaries can differ.\nDoes that change row counts?', configurable: true });
  await app.api.commit(app.pending);
  assert.equal(app.clicks(), 1);
  const next = payload(); next.messages.push(
    { id: 'user-2', role: 'user', text: 'About this passage:\nPack boundaries can differ.\nDoes that change row counts?' },
    { id: 'assistant-2', role: 'assistant', text: 'New reply' });
  app.current(next);
  assert.equal((await app.api.inspect(app.pending)).complete, true);
});

test('a replaced editor with the same question and a delayed Send button can submit once', async t => {
  const app = composer(t); await app.api.prepare(app.pending);
  const replacement = app.input.cloneNode(false); replacement.textContent = app.pending.prompt;
  app.input.replaceWith(replacement);
  app.button.disabled = true;
  setTimeout(() => { app.button.disabled = false; }, 10);
  await app.api.commit(app.pending, { timeout: 200, interval: 1 });
  assert.equal(app.clicks(), 1);
  await assert.rejects(app.api.commit(app.pending), /not yet confirmed/);
});

test('retrying an identical existing question never overwrites the input; a different draft remains protected', async t => {
  const app = composer(t);
  app.pending.prompt = 'First paragraph\n\nA question'; app.input.innerHTML = '<p>First paragraph</p><p>A question</p>';
  assert.equal((await app.api.prepare(app.pending)).alreadyEntered, true);
  assert.equal(app.input.innerHTML, '<p>First paragraph</p><p>A question</p>');
  app.input.textContent = 'A different draft';
  await assert.rejects(app.api.prepare(app.pending), /already contains a draft/);
  assert.equal(app.clicks(), 0);
});

test('a composer outside main is supported and hidden responsive editors and buttons are ignored', async t => {
  const app = composer(t);
  app.w.document.body.innerHTML = '<main></main><div style="display:none"><div data-composer-markdown contenteditable="true"></div></div><form data-composer-placement="thread"><div data-composer-input><div data-composer-markdown contenteditable="plaintext-only" role="textbox"></div></div><div aria-hidden="true"><button type="submit">Hidden</button></div><button type="submit" aria-label="发送"></button></form>';
  const input = app.w.document.querySelector('form [contenteditable]'); let clicks = 0;
  app.w.document.querySelector('form > button').onclick = () => clicks++;
  await app.api.prepare(app.pending);
  assert.equal(app.w.document.activeElement, input);
  input.textContent = app.pending.prompt;
  await app.api.commit(app.pending);
  assert.equal(clicks, 1);
});

test('different text and a persistently unavailable Send button fail without any click', async t => {
  const app = composer(t); await app.api.prepare(app.pending);
  app.input.textContent = 'A different question';
  await assert.rejects(app.api.commit(app.pending, { timeout: 0 }), /not fully written/);
  app.input.textContent = app.pending.prompt; app.button.disabled = true;
  await assert.rejects(app.api.commit(app.pending, { timeout: 0 }), /Send button is not ready/);
  assert.equal(app.clicks(), 0);
});

test('question comparison preserves wording and code indentation while tolerating blank lines and nonbreaking spaces', t => {
  const app = composer(t); const { same } = app.w.ChatGPTReaderChatText;
  assert.equal(same('Pack boundaries\n\nQuestion?', 'Pack\u00a0boundaries\nQuestion?'), true);
  assert.equal(same('Pack boundaries', 'Pack sizes'), false);
  assert.equal(same('code\n  nested()', 'code\nnested()'), false);
});

test('an identical question already on the current branch is recovered without touching the composer', async t => {
  const app = composer(t), next = payload();
  next.messages.push({ id: 'user-2', role: 'user', text: app.pending.prompt }, { id: 'assistant-2', role: 'assistant', text: 'Reply' });
  next.completeness = { ...next.completeness, count: 4, questions: 2, lastMessageId: 'assistant-2' }; app.current(next);
  app.input.textContent = 'Keep an unrelated draft';
  const result = await app.api.prepare(app.pending);
  assert.equal(result.alreadySubmitted, true); assert.equal(result.userId, 'user-2');
  assert.equal(app.input.textContent, 'Keep an unrelated draft'); assert.equal(app.clicks(), 0);
  next.messages[2].text = 'A different question';
  await assert.rejects(app.api.prepare(app.pending), /branch changed/);
});
