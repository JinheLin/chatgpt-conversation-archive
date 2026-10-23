const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function text(app, blob = app.downloads.at(-1)) {
  return new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob);
  });
}
async function open(t, data, locale = 'en') {
  const app = fixture({ initial: data.sourceUrl, locale }); t.after(() => app.w.close());
  const filenames = [];
  app.w.HTMLAnchorElement.prototype.click = function () { filenames.push(this.download); };
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  return { ...app, filenames };
}

test('Markdown keeps code whitespace, fences, nested lists, tables, math and literal markup without executing it', async t => {
  const code = '  const value = "```";\n\n\n  return value;  \n';
  const source = [
    '# Section', '', '**Strong** and *emphasis* with ~~deleted~~ and `` `literal` ``.', '',
    '1. First', '   - Nested item', '2. Second', '', '> Quoted **text**', '',
    '| Name | Value |', '| --- | --- |', '| A | `x\\|y` |', '',
    'Inline $x+1$ and \\(y+2\\).', '', '$$', '\\frac{a}{b}', '$$', '',
    '````javascript', code + '````', '', '<script>window.untrusted = true</script>', '',
    '`<Cite ref="example"/>` and <Cite ref="missing"/>', '', '**one**\n*two*'
  ].join('\n');
  const app = fixture(); t.after(() => app.w.close());
  const output = await app.w.ChatGPTMarkdownExport.create(payload('Question?', source));
  const md = app.w.markdownit({ html: true }), doc = new app.w.DOMParser().parseFromString(md.render(output), 'text/html');
  assert.equal(doc.querySelector('pre code').textContent, code);
  assert.equal(doc.querySelector('pre code').className, 'language-javascript');
  assert.ok(doc.querySelector('ol li ul li')); assert.ok(doc.querySelector('blockquote strong'));
  assert.equal(doc.querySelector('table tbody td:nth-child(2)').textContent, 'x|y');
  assert.ok(doc.querySelector('h3')); assert.ok(doc.querySelector('s'));
  assert.match(output, /Inline \$x\+1\$ and \$y\+2\$\\\./);
  assert.match(output, /\$\$\n\\frac\{a\}\{b\}\n\$\$/);
  assert.equal(doc.querySelector('script'), null); assert.match(doc.body.textContent, /<script>window.untrusted = true<\/script>/);
  assert.match(output, /`<Cite ref="example"\/>`/); assert.doesNotMatch(output, /ref="missing"/);
  assert.match(doc.body.textContent, /one two/); assert.equal(app.w.untrusted, undefined);
});

test('layout cards, custom tables and lists become Markdown while SVG diagrams and image data remain available', async t => {
  const components = fs.readFileSync(path.join(__dirname, 'fixtures/component-layout.md'), 'utf8');
  const source = components + '\n\n<list marker="number"><list-item>First step</list-item><list-item>Second step</list-item></list>' +
    '\n\n<table><table-row><table-cell>Name</table-cell><table-cell>Count</table-cell></table-row><table-row><table-cell>Items</table-cell><table-cell>7</table-cell></table-row></table>' +
    '\n\n<svg viewBox="0 0 100 40"><rect x="1" y="1" width="98" height="38"/><text x="10" y="25">Diagram label</text></svg>' +
    '\n\n<AsyncImage query="cached image"/>';
  const data = payload('Layouts', source);
  data.messages[1].layoutImages = [{ slot: 0, query: 'cached image', dataUrl: gif }];
  const before = JSON.stringify(data), app = fixture(); t.after(() => app.w.close());
  const output = await app.w.ChatGPTMarkdownExport.create(data);
  assert.doesNotMatch(output, /<\/?(?:box|row|Link|Cite|Chart|AsyncImage|list-item|table-cell)\b|\{#each/);
  assert.match(output, /Keep the nested description/); assert.match(output, /Final passage/);
  assert.match(output, /\[Read PDF\]\(<https:\/\/example.com\/paper.pdf>\)/);
  assert.match(output, /1\. First step\n2\. Second step/);
  assert.match(output, /\| Name \| Count \|\n\| --- \| --- \|\n\| Items \| 7 \|/);
  assert.match(output, /Example timings/); assert.match(output, /Snapshot/); assert.match(output, /55 s/);
  assert.match(output, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(output, /Diagram label<\/text>/); assert.match(output, /!\[cached image\]\[asset-1\]/);
  assert.ok(output.includes('[asset-1]: <' + gif + '>'));
  assert.equal(JSON.stringify(data), before); assert.equal(app.requests.length, 0);
});

for (const locale of ['en', 'zh-CN']) test('Markdown menu exports UTF-8 with message times, cached assets and sources (' + locale + ')', async t => {
  const data = payload('中文问题', '## 答案标题\n\n回答正文。\n\n![same image](' + gif + ')');
  data.title = '中文对话'; data.messages[0].createdAt = '2026-10-23T02:03:04Z';
  data.messages[1].createdAt = '2026-10-23T02:03:45Z';
  data.messages[1].assets = [{ label: 'same image', dataUrl: gif },
    { label: 'notes.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }];
  data.messages[1].sources = [{ title: 'Reference', url: 'https://example.com/paper?q=a&x=2' }];
  const app = await open(t, data, locale), before = plain(await app.w.ChatGPTReaderStore.backup());
  app.get('export-toggle').click();
  app.get('save-pdf').focus();
  app.get('save-pdf').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(app.w.document.activeElement, app.get('save-markdown'));
  app.get('save-markdown').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-markdown').disabled);
  const output = await text(app);
  assert.equal(app.filenames[0], '中文对话.md'); assert.match(app.downloads[0].type, /^text\/markdown;charset=utf-8$/);
  assert.match(output, /^# 中文对话\n/); assert.match(output, /#### 答案标题/);
  assert.match(output, /02:03:04|10:03:04/); assert.match(output, /02:03:45|10:03:45/);
  assert.ok(output.includes(locale === 'zh-CN' ? '## 问题 1' : '## Question 1'));
  assert.match(output, /\[Reference\]\(<https:\/\/example.com\/paper\?q=a&x=2>\)/);
  assert.equal((output.match(/\[asset-1\]: /g) || []).length, 1);
  assert.equal((output.match(/\[asset-1\]/g) || []).length, 3);
  assert.ok(output.includes('[asset-2]: <data:text/plain;base64,aGVsbG8=>'));
  assert.equal(app.get('export-formats').hidden, true);
  const after = plain(await app.w.ChatGPTReaderStore.backup());
  assert.deepEqual(after.conversations, before.conversations); assert.equal(app.requests.length, 0);
});

test('single-question Markdown includes every answer even when folded, keeps the original number and leaves reading state intact', async t => {
  const data = payload('Other question sentinel', 'Other answer sentinel');
  data.messages.push({ id: 'u2', role: 'user', text: 'Selected question' },
    { id: 'a2', role: 'assistant', text: 'Selected answer' },
    { id: 'a2-extra', role: 'assistant', text: 'Extra selected answer' },
    { id: 'u3', role: 'user', text: 'Final unanswered' });
  data.completeness = { verified: true, count: 6, questions: 3, firstMessageId: 'user-1', lastMessageId: 'u3' };
  const app = await open(t, data), question = app.get('question-2');
  question.querySelector('.reader-turn-controls button').click();
  const before = app.main.innerHTML;
  question.querySelector('.reader-question-export').click(); app.get('save-markdown').click();
  await waitFor(() => app.downloads.length === 1 && !app.get('save-markdown').disabled);
  const output = await text(app);
  assert.match(output, /## Question 2/); assert.match(output, /Selected question/);
  assert.match(output, /Selected answer/); assert.match(output, /Extra selected answer/);
  assert.doesNotMatch(output, /Other question sentinel|Other answer sentinel|Final unanswered|Read status|Collapse|Export this question/);
  assert.match(app.filenames[0], /-Question 2\.md$/); assert.equal(app.main.innerHTML, before);
  assert.equal(app.get('pdf-excerpt'), null);
  app.get('question-3').querySelector('.reader-question-export').click(); app.get('save-markdown').click();
  await waitFor(() => app.downloads.length === 2 && !app.get('save-markdown').disabled);
  const unanswered = await text(app);
  assert.match(unanswered, /## Question 3/); assert.doesNotMatch(unanswered, /## Answer|Invalid Date/);
});

test('Markdown render failures restore controls and create no partial download; busy exports cannot start twice', async t => {
  const app = await open(t, payload()), original = app.w.ChatGPTMarkdownExport.create;
  let release, calls = 0;
  app.w.ChatGPTMarkdownExport.create = () => { calls++; return new Promise((resolve, reject) => { release = () => reject(new Error('Conversion failed')); }); };
  app.get('save-markdown').click();
  assert.equal(app.get('save-markdown').disabled, true); assert.equal(app.get('save-html').disabled, true);
  app.get('save-markdown').dispatchEvent(new app.w.Event('click'));
  assert.equal(calls, 1); release(); await waitFor(() => !app.get('save-markdown').disabled);
  assert.equal(app.downloads.length, 0); assert.match(app.get('export-status').textContent, /Conversion failed/);
  app.w.ChatGPTMarkdownExport.create = original;
  app.get('save-markdown').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-markdown').disabled);
  assert.match(await text(app), /## Question 1/);
  await assert.rejects(app.w.ChatGPTMarkdownExport.create({ ...payload(), completeness: { verified: false, count: 2 } }), /count|match|verified/i);
});
