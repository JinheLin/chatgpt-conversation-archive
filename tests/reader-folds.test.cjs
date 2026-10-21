const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, setup, select, waitFor } = require('./helpers/reader.cjs');

function conversation() {
  const data = payload('First question', '## 一、Background\n\nFirst reply with **important text**.\n\n## 二、Details\n\nMore details.');
  data.messages.push({ id: 'assistant-extra', role: 'assistant', text: 'Second part of first reply.' },
    { id: 'user-2', role: 'user', text: 'Second question' }, { id: 'assistant-2', role: 'assistant', text: 'Another reply.' },
    { id: 'user-3', role: 'user', text: 'Question without an answer yet.' });
  data.completeness = { verified: true, count: 6, questions: 3, firstMessageId: 'user-1', lastMessageId: 'user-3' };
  return data;
}
async function open(t, locale = 'en') {
  const data = conversation(), app = fixture({ locale, initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  return { ...app, data, turn: number => app.get('question-' + number),
    toggle: number => app.get('question-' + number).querySelector('.reader-turn-controls button') };
}
async function markGroupRead(app, number = 1) {
  const mark = app.get('preview-sidebar').querySelector(`a[href="#question-${number}"]`).parentElement.querySelector('.reader-read-dot');
  mark.click();
  await waitFor(() => app.get('preview-sidebar').querySelector(`a[href="#question-${number}"]`).parentElement.querySelector('.reader-read-dot')?.dataset.state === 'read');
}

for (const locale of ['en', 'zh-CN']) test('a folded question displays read only after every answer is marked and clears when unread (' + locale + ')', async t => {
  const app = await open(t, locale);
  const firstAnswer = () => app.get('message-2').querySelector('.reader-read-toggle');
  assert.equal(app.turn(1).querySelector('.reader-turn-read-state'), null);
  firstAnswer().click(); await waitFor(() => firstAnswer().dataset.state === 'read' && !firstAnswer().disabled);
  app.toggle(1).click();
  assert.equal(app.turn(1).querySelector('.reader-turn-read-state'), null);
  const secondAnswer = () => app.get('message-3').querySelector('.reader-read-toggle');
  secondAnswer().click(); await waitFor(() => app.turn(1).querySelector('.reader-turn-read-state'));
  const badge = app.turn(1).querySelector('.reader-turn-read-state');
  assert.equal(badge.closest('.pdf-role').closest('.pdf-user'), app.turn(1));
  assert.equal(badge.textContent, locale === 'zh-CN' ? '已读' : 'Read');
  assert.equal(badge.getAttribute('aria-label'), locale === 'zh-CN' ? '所有回答已标记为已读' : 'All answers marked as read');
  assert.ok(badge.querySelector('svg[aria-hidden="true"]'));
  assert.equal(app.turn(1).dataset.readerFolded, 'true');
  assert.equal(app.turn(2).querySelector('.reader-turn-read-state'), null);
  assert.equal(app.turn(3).querySelector('.reader-turn-read-state'), null);
  await waitFor(() => !app.get('preview-sidebar').querySelector('.reader-read-dot').disabled);
  app.get('preview-sidebar').querySelector('.reader-read-dot').click();
  await waitFor(() => firstAnswer().dataset.state === 'unread' && !firstAnswer().disabled);
  assert.equal(app.turn(1).querySelector('.reader-turn-read-state'), null);
  assert.equal(app.turn(1).dataset.readerFolded, 'true');
});

test('restored read marks show on folded questions and changed or newly added answers remove the badge', async t => {
  const app = await open(t); await markGroupRead(app);
  const reopen = async data => {
    if (data) await app.w.ChatGPTReaderStore.saveConversation(data);
    const next = fixture({ factory: app.factory, initial: app.data.sourceUrl }); t.after(() => next.w.close());
    await next.start(); next.get('question-1').querySelector('.reader-turn-controls button').click();
    return next;
  };
  const restored = await reopen();
  assert.ok(restored.get('question-1').querySelector('.reader-turn-read-state'));
  const changed = JSON.parse(JSON.stringify(app.data));
  changed.capturedAt = '2026-10-21T12:00:00.000Z'; changed.messages[1].text += '\n\nChanged text.';
  const updated = await reopen(changed);
  assert.equal(updated.get('message-2').querySelector('.reader-read-toggle').dataset.state, 'stale');
  assert.equal(updated.get('question-1').querySelector('.reader-turn-read-state'), null);
  const extended = JSON.parse(JSON.stringify(app.data));
  extended.capturedAt = '2026-10-21T13:00:00.000Z';
  extended.messages.splice(3, 0, { id: 'new-answer', role: 'assistant', text: 'An additional answer.' });
  extended.completeness.count++;
  const added = await reopen(extended);
  assert.equal(added.get('question-1').querySelector('.reader-turn-read-state'), null);
  assert.equal(added.get('message-4').querySelector('.reader-read-toggle').dataset.state, 'unread');
});

for (const locale of ['en', 'zh-CN']) test('question folds default to expanded and include every answer up to the next question (' + locale + ')', async t => {
  const app = await open(t, locale), original = JSON.stringify(app.data);
  assert.equal(app.main.querySelectorAll('.reader-turn-controls button').length, 3);
  assert.ok([...app.main.querySelectorAll('.reader-turn-controls button')].every(node => node.getAttribute('aria-expanded') === 'true'));
  const toggle = app.toggle(1); toggle.focus(); toggle.click();
  assert.equal(toggle.textContent, locale === 'zh-CN' ? '展开' : 'Expand');
  assert.equal(toggle.getAttribute('aria-label'), locale === 'zh-CN' ? '展开问题 1' : 'Expand question 1');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(app.turn(1).dataset.readerFolded, 'true');
  assert.equal(app.get('message-2').dataset.readerFolded, 'true');
  assert.equal(app.get('message-3').dataset.readerFolded, 'true');
  assert.equal(app.turn(2).dataset.readerFolded, 'false');
  assert.equal(app.turn(1).querySelector('.reader-turn-summary').hidden, false);
  assert.equal(app.turn(1).querySelector('.reader-turn-summary').textContent, 'First question');
  for (const id of toggle.getAttribute('aria-controls').split(' ')) assert.ok(app.get(id));
  assert.equal(app.w.document.activeElement, toggle);
  toggle.click();
  assert.equal(app.get('message-2').dataset.readerFolded, 'false');
  assert.equal(app.turn(1).querySelector('.reader-turn-summary').hidden, true);
  assert.equal(JSON.stringify(app.data), original);
  assert.equal((await app.w.ChatGPTReaderStore.getConversation(app.w.ChatGPTReaderStore.keyFor(app.data.sourceUrl))).payload.messages[1].text, app.data.messages[1].text);
});

test('collapse all and expand all include unanswered questions and respect the output lock', async t => {
  const app = await open(t);
  const [collapse, expand] = app.get('preview-sidebar').querySelectorAll('.reader-fold-tools button');
  collapse.click();
  assert.equal(app.main.querySelectorAll('.pdf-message[data-reader-folded="true"]').length, 6);
  assert.equal(app.toggle(3).getAttribute('aria-expanded'), 'false');
  expand.click();
  assert.equal(app.main.querySelectorAll('.pdf-message[data-reader-folded="true"]').length, 0);
  const controller = app.w.ChatGPTReaderFolds.init({ main: app.main, sidebar: app.get('preview-sidebar') });
  controller.load('lock-test'); controller.setLocked(true);
  assert.ok([...app.main.querySelectorAll('.reader-turn-controls button')].every(node => node.disabled));
  app.main.querySelector('.reader-turn-controls button').click();
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  controller.setLocked(false);
  app.toggle(1).click(); assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
});

test('directory question and chapter links expand the right group before navigation, including the current hash', async t => {
  const app = await open(t), side = app.get('preview-sidebar');
  app.toggle(1).click();
  const chapter = side.querySelector('a[href="#answer-heading-2-1"]');
  chapter.dispatchEvent(new app.w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  const click = link => link.dispatchEvent(new app.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  click(chapter); assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  app.toggle(1).click(); click(side.querySelector('a[href="#question-1"]'));
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  await new Promise(resolve => app.w.setTimeout(resolve, 0));
  app.toggle(1).click(); click(side.querySelector('a[href="#question-1"]'));
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  app.toggle(2).click();
  app.w.history.replaceState(null, '', '#message-5'); app.w.dispatchEvent(new app.w.Event('hashchange'));
  assert.equal(app.toggle(2).getAttribute('aria-expanded'), 'true');
  assert.equal(app.get('message-5').dataset.scrolled, 'true');
});

test('fold choices survive an update within this reading session and remain separate for each conversation', async t => {
  const app = await open(t);
  const side = app.get('preview-sidebar'), folds = app.w.ChatGPTReaderFolds.init({ main: app.main, sidebar: side });
  folds.load('first'); app.toggle(1).click();
  folds.unload();
  assert.equal(app.main.querySelector('.reader-turn-controls, [data-reader-folded], [data-reader-fold-body]'), null);
  await app.w.ChatGPTPdfExporter.render(app.data, app.main);
  folds.load('first');
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  folds.load('other'); assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'true');
  folds.load('first'); assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  assert.equal(app.main.querySelectorAll('.reader-turn-controls').length, 3);
  assert.equal(side.querySelectorAll('.reader-fold-tools').length, 1);
});

test('jumping from an annotation unfolds its original question without losing the highlight or comment', async t => {
  const app = await setup({ payload: conversation() }); t.after(() => app.w.close());
  const folds = app.w.ChatGPTReaderFolds.init({ main: app.main, sidebar: app.get('preview-sidebar') });
  folds.load('annotations');
  const body = app.get('message-2').querySelector('.pdf-message-body');
  const start = app.w.ChatGPTReaderAnchor.index(body).text.indexOf('important text');
  select(app, body, start, start + 14);
  app.w.document.dispatchEvent(new app.w.Event('mouseup')); await waitFor(() => !app.get('reader-selection').hidden);
  app.get('reader-highlight').click();
  await waitFor(() => app.main.querySelector('mark.reader-highlight') && app.get('reader-annotation-list').querySelector('.reader-quote'));
  const toggle = app.get('question-1').querySelector('.reader-turn-controls button'); toggle.click();
  app.get('reader-annotation-list').querySelector('.reader-quote').click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(app.main.querySelector('mark.reader-highlight').dataset.scrolled, 'true');
});

test('offline HTML strips fold UI and state while print styles always include full questions and answers', async t => {
  const app = await open(t), original = app.data.messages.map(message => message.text);
  await markGroupRead(app);
  app.toggle(1).click(); app.toggle(2).click();
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
  const html = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  const doc = new app.w.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('.reader-turn-controls, .reader-turn-summary, .reader-turn-read-state, [data-reader-folded], [data-reader-fold-body]'), null);
  assert.equal(doc.querySelectorAll('.pdf-message').length, 6);
  assert.match(doc.getElementById('message-3').textContent, /Second part of first reply/);
  assert.match(doc.getElementById('message-5').textContent, /Another reply/);
  assert.equal(app.toggle(1).getAttribute('aria-expanded'), 'false');
  assert.deepEqual(app.data.messages.map(message => message.text), original);
  const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  assert.match(css, /@media screen \{[\s\S]*?\.pdf-message\[data-reader-folded="true"\]\.pdf-assistant,/);
  assert.match(css, /@media print \{ \.reader-turn-controls, \.reader-turn-summary, \.reader-fold-tools, \.reader-turn-read-state \{ display: none !important;/);
});
