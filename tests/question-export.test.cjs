const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

function conversation() {
  const data = payload('Other question sentinel', 'Other answer sentinel');
  data.messages.push({ id: 'user-2', role: 'user', text: 'Selected question', createdAt: '2026-10-22T02:03:04.000Z' },
    { id: 'assistant-2', role: 'assistant', text: '## 一、Selected section\n\nSelected answer with $x+1$ and `literal`.\n\n## 二、More detail\n\nDetail.',
      sources: [{ title: 'Selected source', url: 'https://example.com/source' }],
      assets: [{ label: 'Selected image', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }] },
    { id: 'assistant-extra', role: 'assistant', text: 'Extra answer belonging to the same question.' },
    { id: 'user-3', role: 'user', text: 'Final unanswered question sentinel' });
  data.completeness = { verified: true, count: data.messages.length, questions: 3,
    firstMessageId: data.messages[0].id, lastMessageId: 'user-3' };
  return data;
}
async function open(t, locale = 'en') {
  const data = conversation(), app = fixture({ initial: data.sourceUrl, locale });
  t.after(() => app.w.close());
  app.w.HTMLImageElement.prototype.decode = async () => {};
  const filenames = [];
  app.w.HTMLAnchorElement.prototype.click = function () { filenames.push(this.download); };
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  return { ...app, data, filenames, question: number => app.get('question-' + number),
    exportQuestion(number) { app.get('question-' + number).querySelector('.reader-question-export').click(); } };
}
async function htmlDownload(app) {
  const previous = app.downloads.length; app.get('save-html').click();
  await waitFor(() => app.downloads.length > previous && !app.get('save-html').disabled);
  const html = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads.at(-1));
  });
  return new app.w.DOMParser().parseFromString(html, 'text/html');
}

test('selection includes the question and all its answers until the next question without changing the snapshot', t => {
  const app = fixture(); t.after(() => app.w.close()); const data = conversation(), original = JSON.stringify(data);
  const selected = app.w.ChatGPTQuestionExport.select(data, 'user-2');
  assert.equal(selected.number, 2);
  assert.deepEqual(Array.from(selected.payload.messages, message => message.id), ['user-2', 'assistant-2', 'assistant-extra']);
  assert.deepEqual(plain(selected.payload.completeness), { verified: true, count: 3, questions: 1, firstMessageId: 'user-2', lastMessageId: 'assistant-extra' });
  assert.match(selected.payload.title, /Question 2$/);
  assert.equal(selected.payload.sourceUrl, data.sourceUrl);
  assert.equal(selected.payload.messages[1].assets[0].dataUrl, data.messages[3].assets[0].dataUrl);
  assert.equal(app.w.ChatGPTQuestionExport.select(data, 'user-3').payload.messages.length, 1);
  assert.throws(() => app.w.ChatGPTQuestionExport.select(data, 'assistant-2'), /no longer available/);
  assert.throws(() => app.w.ChatGPTQuestionExport.select(data, 'deleted'), /no longer available/);
  assert.equal(JSON.stringify(data), original);
});

for (const locale of ['en', 'zh-CN']) test('per-question menu has explicit range, supports keyboard navigation, and global export resets to all (' + locale + ')', async t => {
  const app = await open(t, locale), question = app.question(2), button = question.querySelector('.reader-question-export');
  assert.equal(app.main.querySelectorAll('.reader-question-export').length, 3);
  assert.equal(button.getAttribute('aria-label'), locale === 'zh-CN' ? '导出问题 2 及其回答' : 'Export question 2 and its answers');
  const before = app.w.scrollY;
  app.exportQuestion(2);
  assert.equal(app.get('export-scope').value, 'user-2');
  assert.equal(app.get('export-formats').hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(app.w.document.activeElement, app.get('save-html'));
  app.get('save-html').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.get('export-scope').value, 'user-2');
  assert.equal(app.w.document.activeElement, app.get('save-pdf'));
  app.get('save-pdf').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(app.get('export-formats').hidden, true); assert.equal(app.w.document.activeElement, button);
  assert.equal(app.w.scrollY, before);
  app.get('export-toggle').click(); assert.equal(app.get('export-scope').value, '');
  assert.equal(app.get('export-scope').options.length, 4);
});

test('single-question HTML retains all selected answers, timestamps, math, sources and images with working internal links', async t => {
  const app = await open(t), store = app.w.ChatGPTReaderStore;
  app.question(2).querySelector('.reader-turn-controls button').click();
  const before = app.question(2).querySelector('.pdf-message-body').innerHTML;
  const original = plain((await store.getConversation('c:test-conversation')).payload);
  app.exportQuestion(2); const doc = await htmlDownload(app);
  assert.match(app.filenames.at(-1), /-Question 2\.html$/);
  assert.deepEqual([...doc.querySelectorAll('.pdf-message')].map(node => node.dataset.messageId), ['user-2', 'assistant-2', 'assistant-extra']);
  assert.match(doc.title, /Question 2$/);
  assert.match(doc.querySelector('.pdf-meta').textContent, /^Selected question · 3 messages/);
  assert.equal(doc.querySelector('.pdf-message-time').dateTime, '2026-10-22T02:03:04.000Z');
  assert.ok(doc.querySelector('.katex')); assert.ok(doc.querySelector('.pdf-sources a[href="https://example.com/source"]'));
  assert.match(doc.querySelector('img').src, /^data:image\/gif;base64,/);
  assert.doesNotMatch(doc.body.textContent, /Other question sentinel|Other answer sentinel|Final unanswered/);
  for (const link of doc.querySelectorAll('a[href^="#"]')) assert.ok(doc.getElementById(link.hash.slice(1)), link.href);
  assert.equal(doc.querySelector('.reader-question-export, .reader-turn-controls, .reader-read-controls, .reader-highlight, [inert], [data-reader-folded]'), null);
  assert.equal(doc.getElementById('pdf-document').hasAttribute('aria-hidden'), false);
  assert.equal(app.question(2).dataset.readerFolded, 'true');
  assert.equal(app.question(2).querySelector('.pdf-message-body').innerHTML, before);
  assert.deepEqual(plain((await store.getConversation('c:test-conversation')).payload), original);
  assert.equal(app.get('pdf-excerpt'), null); assert.equal(app.w.document.body.dataset.exportExcerpt, undefined);
  app.get('export-toggle').click(); const full = await htmlDownload(app);
  assert.equal(app.filenames.at(-1), 'Reader fixture.html');
  assert.equal(full.querySelectorAll('.pdf-message').length, 6);
  assert.equal(full.querySelector('.reader-question-export'), null);
});

for (const layout of ['portrait', 'landscape', 'mobile', 'hanwang-n10']) test('selected PDF uses only its isolated question, selected layout and bookmarks, then restores the reader (' + layout + ')', async t => {
  const app = await open(t);
  const control = layout === 'landscape' ? 'page-layout' : layout === 'mobile' ? 'mobile-layout' : layout === 'hanwang-n10' ? 'n10-layout' : null;
  if (control) { app.get(control).checked = true; app.get(control).dispatchEvent(new app.w.Event('change')); await waitFor(() => !app.get('save-pdf').disabled); }
  app.question(2).querySelector('.reader-turn-controls button').click();
  const before = app.main.querySelectorAll('.pdf-message').length;
  let captured = false, outlined = false;
  app.w.ChatGPTPdfCapture = { capture: async options => {
    captured = true; assert.equal(options.pageLayout, layout);
    assert.equal(app.w.document.body.dataset.exportExcerpt, 'true');
    const root = app.get('pdf-excerpt'); assert.equal(root.dataset.pageLayout, layout);
    assert.deepEqual([...root.querySelectorAll('.pdf-message')].map(node => node.dataset.messageId), ['user-2', 'assistant-2', 'assistant-extra']);
    assert.ok(root.querySelector('#excerpt-question-1')); assert.ok(root.querySelector('#excerpt-answer-heading-2-1'));
    assert.equal(app.main.hidden, false); assert.equal(app.main.querySelectorAll('.pdf-message').length, before);
    assert.equal(app.question(2).dataset.readerFolded, 'true');
    const ids = [...app.w.document.querySelectorAll('[id]')].map(node => node.id); assert.equal(ids.length, new Set(ids).size);
    assert.equal(app.question(1).querySelector('.reader-question-export').disabled, true);
    assert.equal(app.get('export-scope').disabled, true);
    return new Uint8Array([1]);
  } };
  app.w.ChatGPTPdfOutline = { add: async (bytes, metadata) => {
    outlined = true; assert.equal(metadata.idPrefix, 'excerpt-'); assert.equal(metadata.sourceUrl, app.data.sourceUrl);
    assert.equal(metadata.questions.length, 1); assert.equal(metadata.questions[0].id, 'excerpt-question-1');
    assert.equal(metadata.questions[0].title, 'Selected question'); assert.equal(metadata.questions[0].headings.length, 2);
    return { bytes: new Uint8Array([2]), questions: 1, pages: 2 };
  } };
  app.exportQuestion(2); app.get('save-pdf').click();
  await waitFor(() => app.downloads.length === 1 && !app.get('save-pdf').disabled);
  assert.equal(captured, true); assert.equal(outlined, true);
  assert.equal(app.filenames[0], 'Reader fixture-Question 2' + (['mobile', 'hanwang-n10'].includes(layout) ? '-' + layout : '') + '.pdf');
  assert.equal(app.get('pdf-excerpt'), null); assert.equal(app.w.document.body.dataset.exportExcerpt, undefined);
  assert.equal(app.main.querySelectorAll('.pdf-message').length, before); assert.equal(app.question(2).dataset.readerFolded, 'true');
});

test('PDF failure cleans up and fallback printing and outline repair retain the attempted single-question range', async t => {
  const app = await open(t); let printed = 0;
  app.w.ChatGPTPdfCapture = { capture: async () => { throw new Error('Capture interrupted'); } };
  app.exportQuestion(2); app.get('save-pdf').click();
  await waitFor(() => !app.get('save-pdf').disabled && !app.get('pdf-fallback').hidden);
  assert.match(app.get('export-status').textContent, /Capture interrupted/);
  assert.match(app.get('pdf-fallback-scope').textContent, /Question 2/);
  assert.equal(app.get('pdf-excerpt'), null); assert.equal(app.downloads.length, 0);
  app.get('export-scope').value = 'user-3';
  app.w.print = () => {
    printed++; assert.equal(app.w.document.body.dataset.exportExcerpt, 'true');
    assert.deepEqual([...app.get('pdf-excerpt').querySelectorAll('.pdf-message')].map(node => node.dataset.messageId), ['user-2', 'assistant-2', 'assistant-extra']);
  };
  app.get('print-again').click(); await waitFor(() => printed && !app.get('print-again').disabled);
  assert.equal(app.get('pdf-excerpt'), null); assert.equal(app.w.document.body.dataset.exportExcerpt, undefined);
  app.w.ChatGPTPdfOutline = { MAX_BYTES: 1000, add: async (bytes, metadata) => {
    assert.equal(metadata.idPrefix, 'excerpt-'); assert.equal(metadata.questions.length, 1);
    assert.equal(metadata.questions[0].title, 'Selected question'); return { bytes: new Uint8Array([3]), questions: 1, pages: 1 };
  } };
  Object.defineProperty(app.get('pdf-outline-file'), 'files', { value: [{ name: 'Question.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }] });
  app.get('pdf-outline-file').dispatchEvent(new app.w.Event('change'));
  await waitFor(() => app.downloads.length === 1 && !app.get('add-pdf-outline').disabled);
});

test('render preparation errors leave no partial output or print state and unanswered questions can still export', async t => {
  const app = await open(t); const fit = app.w.ChatGPTPdfExporter.fitCode;
  app.w.ChatGPTPdfExporter.fitCode = async () => { throw new Error('Layout failure'); };
  app.exportQuestion(2); app.get('save-html').click();
  await waitFor(() => !app.get('save-html').disabled && /Layout failure/.test(app.get('export-status').textContent));
  assert.equal(app.get('pdf-excerpt'), null); assert.equal(app.downloads.length, 0);
  assert.equal(app.w.document.body.dataset.exportExcerpt, undefined);
  app.w.ChatGPTPdfExporter.fitCode = fit;
  app.exportQuestion(3); const doc = await htmlDownload(app);
  assert.equal(doc.querySelectorAll('.pdf-message').length, 1); assert.equal(doc.querySelector('.pdf-assistant'), null);
  assert.match(doc.querySelector('.pdf-user').textContent, /Final unanswered/);
});
