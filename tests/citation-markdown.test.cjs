const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const markdownit = require('../vendor/markdown-it.min.js');
const { installI18n } = require('./helpers/i18n.cjs');

function renderer(locale = 'en-US') {
  const context = vm.createContext({});
  installI18n(context, locale);
  for (const file of ['layout-markdown.js', 'citation-markdown.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const md = markdownit({ html: false, linkify: true });
  context.ChatGPTArchiveLayout.install(md);
  context.ChatGPTPdfCitations.install(md);
  return { render: (source, env = { archiveSourcesId: 'sources-34' }) => md.render(source, env), context };
}

const component = '<cite refs={["turn1search0","turn1search1"]}/>';
const legacy = 'citeturn1search0turn1search1';

test('new citation components, including wrapped refs, render as localized sources links', () => {
  for (const [locale, label] of [['en-US', 'Sources'], ['zh-CN', '来源']]) {
    const { render } = renderer(locale);
    for (const citation of [component, '<cite refs=\n{["turn1search0",\n"turn1search1"]}/>']) {
      const html = render(`正文 **格式**。 ${citation} 后文。`);
      assert.match(html, /<strong>格式<\/strong>/);
      assert.ok(html.includes(`<a class="pdf-citation" href="#sources-34">[${label}]</a>`));
      assert.match(html, /后文。/);
      assert.doesNotMatch(html, /&lt;cite|turn1search|refs=/);
    }
  }
});

test('legacy citations retain surrounding text, repeated citations and layout component context', () => {
  const { render } = renderer();
  for (const source of [`Before ${legacy} after ${component}.`,
    `<box><text>Before ${legacy} after ${component}.</text></box>`]) {
    const html = render(source);
    assert.equal((html.match(/href="#sources-34"/g) || []).length, 2);
    assert.match(html, /Before /);
    assert.match(html, / after /);
    assert.doesNotMatch(html, /|turn1search|&lt;cite/);
  }
});

test('fenced, indented and inline code keeps both citation formats literal', () => {
  const { render } = renderer();
  for (const citation of [component, legacy]) {
    for (const source of [`\`\`\`xml\n${citation}\n\`\`\``, `~~~xml\n${citation}\n~~~`,
      `    ${citation}`, `\`${citation}\``]) {
      const html = render(source);
      assert.match(html, /<code/);
      assert.match(html, /turn1search0/);
      assert.doesNotMatch(html, /pdf-citation/);
    }
  }
  assert.match(render(`\\${component}`), /&lt;cite/);
  assert.doesNotMatch(render(`\\${component}`), /pdf-citation/);
});

test('missing source details show an honest localized label and TOC labels omit citations', () => {
  for (const [locale, label] of [['en-US', 'Source details unavailable'], ['zh-CN', '来源信息不可用']]) {
    const { render } = renderer(locale);
    for (const citation of [component, legacy]) {
      const html = render(`Before ${citation} after.`, {});
      assert.ok(html.includes(`[${label}]`));
      assert.doesNotMatch(html, /href=|turn1search|&lt;cite/);
      assert.equal(render(`Before ${citation} after.`, { archiveHideCitations: true }), '<p>Before  after.</p>\n');
    }
    assert.doesNotMatch(render(component, { archiveSourcesId: '" onclick="evil()' }), /href=|onclick=/);
  }
});

test('citations in Markdown links never generate nested anchors', () => {
  const { render } = renderer();
  for (const citation of [component, legacy]) {
    const html = render(`[Text ${citation}](https://example.com)`);
    assert.equal((html.match(/<a\b/g) || []).length, 1);
    assert.match(html, /<span class="pdf-citation">\[Sources\]<\/span>/);
  }
});

test('invalid refs expressions stay inert and unsupported HTML stays escaped', () => {
  const { render, context } = renderer();
  context.executed = false;
  for (const citation of ['<cite refs={globalThis.executed=true}/>',
    '<cite refs={["turn1search0", globalThis.executed=true]}/>',
    '<cite refs={["<img src=x onerror=evil()>"]}/>', '<cite refs={[]}/>',
    '<cite refs={[42]}/>', '<cite refs={["turn1search0"]} onclick="evil()"/>',
    '<cite refs={["turn1search0"]}', '<cite refs={[' + ' '.repeat(14000) + '"turn1search0"]}/>']) {
    const html = render(citation);
    assert.match(html, /&lt;cite/);
    assert.doesNotMatch(html, /pdf-citation|<(?:cite|img|script)\b/);
  }
  assert.equal(context.executed, false);
  assert.match(render('<script>evil()</script>'), /&lt;script&gt;/);
});

test('export page loads the citation parser before the exporter', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'print.html'), 'utf8');
  assert.ok(page.indexOf('src="citation-markdown.js"') >= 0);
  assert.ok(page.indexOf('src="citation-markdown.js"') < page.indexOf('src="export.js"'));
});
