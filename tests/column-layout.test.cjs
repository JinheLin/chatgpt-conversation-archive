const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

const source = fs.readFileSync(path.join(__dirname, 'fixtures/column-layout.md'), 'utf8');
async function readBlob(app, blob) {
  return new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob);
  });
}
function checkDiagram(root) {
  const columns = [...root.querySelectorAll('.archive-layout-grid > .archive-layout-col')];
  assert.equal(columns.length, 2);
  assert.deepEqual(columns.map(col => col.querySelector('strong').textContent), ['EmbeddedIndexSource', 'FileIndexSource']);
  for (const column of columns) {
    assert.equal(column.tagName, 'DIV');
    assert.equal(column.style.alignItems, 'center');
    assert.equal(column.style.getPropertyValue('--archive-layout-gap'), '8px');
    assert.equal(column.firstElementChild.textContent, '↓');
    assert.equal(column.lastElementChild.style.width, '100%');
  }
  assert.match(columns[0].textContent, /同步 slice、零拷贝/);
  assert.match(columns[1].textContent, /异步 mmap_range/);
  assert.doesNotMatch(root.querySelector('.pdf-assistant .pdf-message-body').textContent, /<\/?col\b|align="center"|gap=\{2\}/i);
  assert.equal(root.querySelector('col, pre.archive-layout-fallback'), null);
}

test('column branches render as vertical flex containers with centered arrows and separate source cards', async t => {
  const app = fixture(); t.after(() => app.w.close());
  await app.w.ChatGPTPdfExporter.render(payload('Index architecture?', source), app.main);
  checkDiagram(app.main);
  const column = app.main.querySelector('.archive-layout-col');
  const style = app.w.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  app.w.document.head.append(style);
  const computed = app.w.getComputedStyle(column);
  assert.equal(computed.display, 'flex'); assert.equal(computed.flexDirection, 'column');
});

test('columns support row nesting, uppercase tags and literal loops while ignoring executable attributes', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const value = '<row align="start" gap={3}>{#each ["First","Second"] as label}<COL align="end" justify="between" flex={1} padding={2} gap="3px" onclick="evil()" onClick={()=>evil()} style="display:none"><text>**{label}**</text><col align="start"><text>Nested detail.</text></col></COL>{/each}</row>';
  await app.w.ChatGPTPdfExporter.render(payload('Columns?', value), app.main);
  const columns = [...app.main.querySelectorAll('.archive-layout-row > .archive-layout-col')];
  assert.equal(columns.length, 2);
  assert.deepEqual(columns.map(col => col.querySelector('strong').textContent), ['First', 'Second']);
  for (const column of columns) {
    assert.equal(column.style.alignItems, 'flex-end'); assert.equal(column.style.justifyContent, 'space-between');
    assert.equal(column.style.flexGrow, '1'); assert.equal(column.style.getPropertyValue('--archive-layout-padding'), '8px');
    assert.equal(column.style.getPropertyValue('--archive-layout-gap'), '3px');
    assert.equal(column.querySelector('.archive-layout-col').style.alignItems, 'flex-start');
    assert.equal(column.hasAttribute('onclick'), false); assert.equal(column.style.display, '');
  }
  assert.equal(app.w.evil, undefined);
  assert.doesNotMatch(app.main.querySelector('.pdf-assistant').textContent, /<\/?col|#each|onclick|evil\(/i);
});

test('column tags stay literal inside code and escaped examples, and malformed markup loses no prose', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const component = '<col align="center" gap={2}>Literal example</col>';
  for (const value of ['`' + component + '`', '```xml\n' + component + '\n```', '    ' + component, component.replace(/</g, '\\<')]) {
    await app.w.ChatGPTPdfExporter.render(payload('Example?', value), app.main);
    const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
    assert.ok(body.textContent.includes(component)); assert.equal(body.querySelector('.archive-layout-col'), null);
  }
  for (const value of ['<col>Unclosed prose.', '<col gap={evil()}>Readable prose.</col>']) {
    await app.w.ChatGPTPdfExporter.render(payload('Invalid?', value), app.main);
    assert.match(app.main.querySelector('.pdf-assistant').textContent, /prose\./);
  }
});

test('cached reader and HTML, isolated PDF and Markdown exports preserve column content without changing the snapshot', async t => {
  const data = payload('Index architecture?', source), original = JSON.stringify(data);
  const app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start(); checkDiagram(app.main);
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
  const html = new app.w.DOMParser().parseFromString(await readBlob(app, app.downloads[0]), 'text/html');
  checkDiagram(html);
  const prepared = await app.w.ChatGPTQuestionExport.prepare(data, 'portrait');
  try { checkDiagram(prepared.root); } finally { prepared.dispose(); }
  app.get('save-markdown').click(); await waitFor(() => app.downloads.length === 2 && !app.get('save-markdown').disabled);
  const markdown = await readBlob(app, app.downloads[1]);
  const markdownDoc = new app.w.DOMParser().parseFromString(app.w.markdownit().render(markdown), 'text/html');
  assert.deepEqual([...markdownDoc.querySelectorAll('strong')].map(node => node.textContent),
    ['FTS Query / ClaraIndexReader', 'FtsIndexHandle', 'EmbeddedIndexSource', 'FileIndexSource', 'FtsCache + IA']);
  assert.doesNotMatch(markdown, /<\/?col\b|gap=|align=/i);
  assert.equal(JSON.stringify(data), original); assert.equal(app.requests.length, 0);
  assert.equal((await app.w.ChatGPTReaderStore.getConversation('c:test-conversation')).payload.messages[1].text, source);
});
