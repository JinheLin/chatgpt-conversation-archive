const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const markdownit = require('../vendor/markdown-it.min.js');
const { installI18n } = require('./helpers/i18n.cjs');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

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
const singular = '<Cite ref="turn430449search44"/>';
const legacy = 'citeturn1search0turn1search1';

test('new citation components, including wrapped refs, render as localized sources links', () => {
  for (const [locale, label] of [['en-US', 'Sources'], ['zh-CN', '来源']]) {
    const { render } = renderer(locale);
    for (const citation of [component, component.replace('cite', 'Cite'), component.replace('cite', 'CiTe'),
      '<Cite refs=\n{["turn1search0",\n"turn1search1"]}/>', singular, singular.replace('Cite', 'cite'),
      '<CITE REF="turn430449search44"/>', "<Cite ref='turn430449search44'/>",
      '<Cite ref={"turn430449search44"}/>', "<Cite ref={'turn430449search44'}/>",
      '<Cite\nref =\n"turn430449search44"\n/>']) {
      const html = render(`正文 **格式**。 ${citation} 后文。`);
      assert.match(html, /<strong>格式<\/strong>/);
      assert.ok(html.includes(`<a class="pdf-citation" href="#sources-34">[${label}]</a>`));
      assert.match(html, /后文。/);
      assert.doesNotMatch(html, /&lt;cite|turn\d+search|\brefs?=/i);
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
  for (const citation of [component, component.replace('cite', 'Cite'), singular, legacy]) {
    for (const source of [`\`\`\`xml\n${citation}\n\`\`\``, `~~~xml\n${citation}\n~~~`,
      `    ${citation}`, `\`${citation}\``]) {
      const html = render(source);
      assert.match(html, /<code/);
      assert.match(html, /turn\d+search/);
      assert.doesNotMatch(html, /pdf-citation/);
    }
  }
  assert.match(render(`\\${component}`), /&lt;cite/);
  assert.doesNotMatch(render(`\\${component}`), /pdf-citation/);
});

test('missing source details and TOC labels omit citations while preserving surrounding text', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    const { render } = renderer(locale);
    for (const citation of [component, component.replace('cite', 'Cite'), singular, legacy]) {
      const html = render(`Before ${citation} after.`, {});
      assert.equal(html, '<p>Before  after.</p>\n');
      assert.doesNotMatch(html, /pdf-citation|href=|turn\d+search|&lt;cite/i);
      assert.equal(render(`Before ${citation} after.`, { archiveHideCitations: true }), '<p>Before  after.</p>\n');
    }
    assert.equal(render(component, { archiveSourcesId: '" onclick="evil()' }), '<p></p>\n');
  }
});

test('citations in Markdown links never generate nested anchors', () => {
  const { render } = renderer();
  for (const citation of [component, singular, legacy]) {
    const html = render(`[Text ${citation}](https://example.com)`);
    assert.equal((html.match(/<a\b/g) || []).length, 1);
    assert.match(html, /<span class="pdf-citation">\[Sources\]<\/span>/);
  }
  for (const source of [`[<text>${component}</text>](https://example.com)`,
    `<Link url="https://example.com"><text>${component}</text></Link>`]) {
    const html = render(source);
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
    '<cite ref={globalThis.executed=true}/>', '<cite ref=""/>',
    '<cite ref="turn430449search44" onclick="evil()"/>', '<cite ref="turn430449search44\'/>',
    '<cite ref="' + 'x'.repeat(129) + '"/>', '<cite ref="<img src=x>"/>',
    '<cite refs={["turn1search0"]}', '<cite refs={[' + ' '.repeat(14000) + '"turn1search0"]}/>']) {
    const html = render(citation);
    assert.match(html, /&lt;cite/);
    assert.doesNotMatch(html, /pdf-citation|<(?:cite|img|script)\b/);
  }
  assert.equal(context.executed, false);
  assert.match(render('<script>evil()</script>'), /&lt;script&gt;/);
});

for (const withSources of [false, true]) {
  test('saved reader and offline HTML handle singular refs without changing code examples (' + (withSources ? 'source present' : 'source absent') + ')', async t => {
    const data = payload('Question ' + singular, [
      '## Answer with a citation',
      'Surrounding text and formatting remain intact. ' + singular,
      '```xml\n' + singular + '\n```'
    ].join('\n\n'));
    if (withSources) data.messages[1].sources = [{ title: 'Paper', url: 'https://example.com/paper' }];
    const app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
    await app.w.ChatGPTReaderStore.saveConversation(data);
    await app.start();
    const check = root => {
      const body = root.querySelector('.pdf-assistant .pdf-message-body');
      assert.ok(body.querySelector('p').textContent.includes('Surrounding text and formatting remain intact.'));
      assert.doesNotMatch(body.querySelector('p').textContent, /<Cite|ref=|turn430449/);
      assert.equal(body.querySelector('code').textContent.trim(), singular);
      assert.equal(body.querySelectorAll('.pdf-citation').length, withSources ? 1 : 0);
      assert.doesNotMatch(root.querySelector('.pdf-toc').textContent, /<Cite|ref=|turn430449/);
      if (withSources) assert.equal(body.querySelector('.pdf-citation').getAttribute('href'), '#sources-2');
    };
    check(app.main);
    app.get('save-html').click();
    await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
    const html = await new Promise(resolve => {
      const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
    });
    check(new app.w.DOMParser().parseFromString(html, 'text/html'));
    assert.equal(app.requests.length, 0);
  });
}

test('export page loads the citation parser before the exporter', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'print.html'), 'utf8');
  assert.ok(page.indexOf('src="citation-markdown.js"') >= 0);
  assert.ok(page.indexOf('src="citation-markdown.js"') < page.indexOf('src="export.js"'));
});
