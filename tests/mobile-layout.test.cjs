const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

test('mobile and landscape are mutually exclusive; toggling updates preview, print geometry and HTML', async (t) => {
  const app = fixture({ initial: payload().sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  await app.start();
  const mobile = app.get('mobile-layout'), landscape = app.get('page-layout');
  assert.equal(mobile.checked, false);
  landscape.checked = true;
  landscape.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => !landscape.disabled);
  mobile.checked = true;
  mobile.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => !mobile.disabled);
  assert.equal(landscape.checked, false);
  assert.equal(app.main.dataset.landscape, 'false');
  assert.equal(app.main.dataset.pageLayout, 'mobile');
  assert.equal(app.get('mobile-layout-hint').hidden, false);
  assert.match(app.get('page-direction').textContent, /100mm 180mm; margin: 7mm 6mm 7mm 6mm/);
  assert.deepEqual({ ...app.w.ChatGPTPageLayout.contentSize('mobile') }, { width: 88, height: 166 });
  app.get('save-html').click();
  await waitFor(() => app.downloads.length && !mobile.disabled);
  const html = await new Promise((resolve, reject) => {
    const reader = new app.w.FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = reject;
    reader.readAsText(app.downloads[0]);
  });
  assert.match(html, /data-page-layout="mobile"/);
  assert.match(html, /@page \{ size: 100mm 180mm/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /<script/);
  landscape.checked = true;
  landscape.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => !landscape.disabled);
  assert.equal(mobile.checked, false);
  assert.equal(app.main.dataset.pageLayout, 'landscape');
  assert.equal(app.get('mobile-layout-hint').hidden, true);
  landscape.checked = false;
  landscape.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => !landscape.disabled);
  assert.equal(app.main.dataset.pageLayout, 'portrait');
});

test('mobile code keeps readable type and original text; diagrams fit page width and height without wrapping', async (t) => {
  const app = fixture(); t.after(() => app.w.close());
  const ordinary = 'const value = "' + 'x'.repeat(180) + '";\nconsole.log(value);';
  const diagram = '+--------------------------------------------+\n| wide text diagram                          |\n+--------------------------------------------+';
  const tall = Array.from({ length: 100 }, () => '| tall diagram |').join('\n');
  app.main.innerHTML = '<pre><code class="language-js"></code></pre><pre><code class="language-text"></code></pre><pre><code class="language-text"></code></pre>';
  const blocks = [...app.main.querySelectorAll('pre')];
  [ordinary, diagram, tall].forEach((text, i) => { blocks[i].firstChild.textContent = text; });
  app.w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: text.length * 8 }) });
  app.w.eval(fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8'));
  const progress = [];
  await app.w.ChatGPTPdfExporter.fitCode(app.main, 'mobile', { onProgress: event => progress.push(event.completed) });
  assert.equal(blocks[0].style.fontSize, '10.5pt');
  assert.equal(blocks[0].dataset.diagram, 'false');
  for (const block of blocks.slice(1)) {
    assert.equal(block.dataset.diagram, 'true');
    assert.ok(parseFloat(block.style.fontSize) < 10.5);
  }
  assert.deepEqual(blocks.map(block => block.textContent), [ordinary, diagram, tall]);
  assert.deepEqual(progress, [1, 2, 3]);
  await app.w.ChatGPTPdfExporter.fitCode(app.main, 'portrait');
  assert.ok(parseFloat(blocks[0].style.fontSize) < 10);
  assert.equal(blocks[1].style.fontSize, '10pt');
});
