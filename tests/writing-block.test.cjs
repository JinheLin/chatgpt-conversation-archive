const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

const article = fs.readFileSync(path.join(__dirname, 'fixtures/writing-block.md'), 'utf8');
const title = 'Scope: What This Article Does Not Cover';
async function readBlob(app, blob) {
  return new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob);
  });
}

test('WritingBlock renders its same-line Markdown heading and closing paragraph without wrapper tags', async t => {
  const app = fixture(); t.after(() => app.w.close());
  await app.w.ChatGPTPdfExporter.render(payload('Article scope?', article), app.main);
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  assert.equal(body.querySelector(':scope > h2')?.textContent, title);
  assert.equal(body.querySelectorAll(':scope > p').length, 5);
  assert.deepEqual([...body.querySelectorAll('code')].map(code => code.textContent), ['fsync', 'fdatasync']);
  assert.equal(body.querySelector('strong').textContent, 'WAL write-path prototype');
  assert.match(body.lastElementChild.textContent, /not a complete, crash-recoverable WAL implementation\.$/);
  assert.doesNotMatch(body.textContent, /<\/?WritingBlock|58321|variant=|## Scope/);
  assert.equal(app.main.querySelector('.pdf-toc-headings a').textContent, title);
});

test('writing blocks preserve surrounding prose, multiple blocks, case and multiline attributes with nested content', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const source = 'Before.\n\n<WRITINGBLOCK\nvariant="email"\nid="two"\nrecipient="example@example.com"\n>\n## 一、First section\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n</WRITINGBLOCK>\n\nBetween.\n\n<WritingBlock id="three" variant="standard">## 二、Second section\n\n<box><text>Nested layout with **detail**.</text></box>\n\nMath $x+1$.\n</WritingBlock>\n\nAfter.';
  await app.w.ChatGPTPdfExporter.render(payload('Sections?', source), app.main);
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  assert.match(body.textContent, /^Before\.[\s\S]*Between\.[\s\S]*After\.\s*$/);
  assert.deepEqual([...body.querySelectorAll(':scope > h2')].map(node => node.textContent), ['一、First section', '二、Second section']);
  assert.equal(body.querySelectorAll('li').length, 2); assert.equal(body.querySelector('table td').textContent, 'A');
  assert.ok(body.querySelector('.katex')); assert.equal(body.querySelector('strong').textContent, 'detail');
  assert.deepEqual([...app.main.querySelectorAll('.pdf-toc-headings a')].map(node => node.textContent), ['一、First section', '二、Second section']);
  assert.doesNotMatch(body.textContent, /WritingBlock|WRITINGBLOCK|example@example.com/);
});

test('writing block examples in inline, fenced, indented and escaped code remain literal', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const component = '<WritingBlock id="example" variant="standard">## Literal</WritingBlock>';
  for (const source of ['`' + component + '`', '```xml\n' + component + '\n```', '    ' + component, component.replace(/</g, '\\<')]) {
    await app.w.ChatGPTPdfExporter.render(payload('Example?', source), app.main);
    const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
    assert.match(body.textContent, /<WritingBlock id="example" variant="standard">## Literal<\/WritingBlock>/);
    assert.equal(body.querySelector('h2'), null);
  }
  const source = '<WritingBlock id="outer">## Real title\n\n```xml\n' + component + '\n```\n\nText after the example.</WritingBlock>';
  await app.w.ChatGPTPdfExporter.render(payload('Nested example?', source), app.main);
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  assert.equal(body.querySelector('h2').textContent, 'Real title');
  assert.equal(body.querySelector('pre code').textContent.trim(), component);
  assert.match(body.textContent, /Text after the example\.$/m);
});

test('writing attributes and untrusted HTML cannot become executable output; unclosed blocks retain readable text', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const source = '<WritingBlock id="payload" variant="standard" onclick="window.injected=true" style="display:none" src="https://example.com/track">## Safe title\n\n<script>window.injected=true</script>\n\n[Bad](javascript:alert(1))\n\nVisible prose.</WritingBlock>';
  await app.w.ChatGPTPdfExporter.render(payload('Safe?', source), app.main);
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  assert.equal(body.querySelector('script, [onclick], [src], [style], a[href^="javascript:"]'), null);
  assert.equal(body.querySelector('h2').textContent, 'Safe title'); assert.match(body.textContent, /Visible prose/);
  assert.equal(app.w.injected, undefined);
  await app.w.ChatGPTPdfExporter.render(payload('Incomplete?', '<WritingBlock id="open">Important remaining prose.'), app.main);
  assert.match(app.main.querySelector('.pdf-assistant').textContent, /Important remaining prose/);
});

test('cached reader, isolated PDF content, offline HTML and Markdown share writing block rendering without changing snapshots', async t => {
  const data = payload('Article scope?', article), original = JSON.stringify(data);
  const app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  const check = root => {
    const body = root.querySelector('.pdf-assistant .pdf-message-body');
    assert.equal(body.querySelector('h2').textContent, title);
    assert.doesNotMatch(body.textContent, /<\/?WritingBlock|## Scope/);
    assert.equal(root.querySelector('.pdf-toc-headings a').textContent, title);
  };
  check(app.main);
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
  check(new app.w.DOMParser().parseFromString(await readBlob(app, app.downloads[0]), 'text/html'));
  const prepared = await app.w.ChatGPTQuestionExport.prepare(data, 'portrait');
  try { check(prepared.root); } finally { prepared.dispose(); }
  app.get('save-markdown').click(); await waitFor(() => app.downloads.length === 2 && !app.get('save-markdown').disabled);
  const markdown = await readBlob(app, app.downloads[1]);
  assert.match(markdown, /#### Scope: What This Article Does Not Cover/);
  assert.match(markdown, /\*\*WAL write\\-path prototype\*\*/);
  assert.doesNotMatch(markdown, /WritingBlock|58321/);
  assert.equal(JSON.stringify(data), original); assert.equal(app.requests.length, 0);
  const saved = await app.w.ChatGPTReaderStore.getConversation('c:test-conversation');
  assert.equal(saved.payload.messages[1].text, article);
});
