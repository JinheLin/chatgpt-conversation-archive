const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const markdownit = require('../vendor/markdown-it.min.js');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');
const project = path.resolve(__dirname, '..');

function renderer() {
  const context = vm.createContext({});
  for (const file of ['layout-markdown.js', 'chart-markdown.js']) vm.runInContext(fs.readFileSync(path.join(project, file), 'utf8'), context);
  const md = markdownit({ html: false }); context.ChatGPTArchiveLayout.install(md);
  return (data, inline = false) => md.render(`${inline ? 'Before ' : ''}<Chart content={${JSON.stringify(data)}}/>${inline ? ' after.' : ''}`);
}
function chart() {
  return { chartType: 'bar', meta: { title: 'Timings', description: 'Seconds' }, xKey: 'step',
    series: [{ dataKey: 'a', label: 'Plan A', valueSuffix: ' s' }, { dataKey: 'b', label: 'Plan B', valueSuffix: ' s' }],
    data: [{ step: 'Snapshot', a: 0.5, b: 50 }, { step: 'Restore', a: 1, b: 0 }] };
}

test('static bars preserve all categories, series labels, exact values and a common scale', () => {
  const render = renderer(), html = render(chart());
  assert.match(html, /<figure class="archive-chart">/);
  assert.match(html, /<figcaption class="archive-chart-title">Timings<\/figcaption>/);
  assert.match(html, /archive-chart-description">Seconds/);
  assert.equal((html.match(/archive-chart-group"/g) || []).length, 2);
  assert.equal((html.match(/archive-chart-bar"/g) || []).length, 4);
  assert.match(html, /width:1.0000%/); assert.match(html, /width:100.0000%/); assert.match(html, /width:0.0000%/);
  assert.match(html, />0.5 s<\/span>/); assert.match(html, />50 s<\/span>/);
  assert.match(html, /Snapshot/); assert.match(html, /Restore/);
  assert.doesNotMatch(html, /&lt;Chart|<script|<svg/);
  const zero = chart(); zero.data = [{ step: 'Zero', a: 0, b: 0 }];
  assert.doesNotMatch(render(zero), /NaN|Infinity/);
});

test('chart text is escaped and supplied URLs, styles and events cannot become active markup', () => {
  const data = chart();
  data.meta.title = '<script>evil()</script>'; data.meta.description = 'A & B "quoted"';
  data.series[0].label = '<img src=x onerror=evil()>'; data.series[0].color = 'url(https://evil.example)';
  data.series[0].valueSuffix = '<iframe src=x></iframe>'; data.data[0].step = '<a href=x>Category</a>';
  const html = renderer()(data);
  assert.match(html, /&lt;script&gt;evil\(\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B &quot;quoted&quot;/);
  assert.doesNotMatch(html, /<(?:script|img|iframe|a)\b|<[^>]+(?:url\(|href=|src=|onerror=)/);
});

test('unsupported chart types and negative values retain exact data in a semantic table', () => {
  for (const data of [Object.assign(chart(), { chartType: 'line' }), chart()]) {
    data.data[0].a = -0.5;
    const html = renderer()(data);
    assert.match(html, /<table class="archive-chart-table"><thead><tr>/);
    assert.equal((html.match(/<td>/g) || []).length, 6);
    assert.match(html, /<td>-0.5 s<\/td>/);
    assert.doesNotMatch(html, /archive-chart-bar"/);
  }
});

test('inline charts use spans with no block elements inside a Markdown paragraph', () => {
  for (const chartType of ['bar', 'line']) {
    const html = renderer()(Object.assign(chart(), { chartType }), true);
    assert.match(html, /^<p>Before <span class="archive-chart">/);
    assert.match(html, / after\.<\/p>/);
    assert.doesNotMatch(html, /<(?:figure|div|table|tr|td|th|figcaption)\b/);
    if (chartType === 'line') assert.match(html, /role="table"/);
  }
});

test('invalid and excessive chart data falls back to readable source', () => {
  const render = renderer();
  for (const modify of [data => { data.series = []; }, data => { data.xKey = '__proto__'; },
    data => { delete data.data[0].a; }, data => { data.data[0].a = 'evil()'; },
    data => { data.data[0].a = 1e16; }, data => { data.data = Array(201).fill(data.data[0]); },
    data => { data.series = Array(13).fill(data.series[0]); }]) {
    const data = chart(); modify(data);
    const html = render(data);
    assert.match(html, /<pre><code>&lt;Chart/);
    assert.doesNotMatch(html, /class="archive-chart"/);
  }
});

test('offline HTML rerenders saved snapshots with mixed components and keeps original data unchanged', async t => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/component-layout.md'), 'utf8');
  const data = payload('Compare the implementation', source), before = JSON.stringify(data);
  const app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1);
  const text = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  const html = new app.w.DOMParser().parseFromString(text, 'text/html');
  assert.equal(html.querySelectorAll('script').length, 0);
  assert.equal(html.querySelectorAll('.archive-chart-bar').length, 9);
  assert.equal(html.querySelectorAll('.archive-link[href]').length, 2);
  assert.equal(html.querySelectorAll('.pdf-toc-headings a').length, 1);
  assert.match(html.querySelector('.pdf-assistant').textContent, /Keep the nested description[\s\S]*Final passage/);
  assert.doesNotMatch(html.querySelector('.pdf-assistant').textContent, /<\/?(?:box|Link|Cite|Chart)\b|\{#each/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(app.requests.length, 0);
});
