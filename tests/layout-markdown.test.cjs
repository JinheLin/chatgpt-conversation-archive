const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const markdownit = require('../vendor/markdown-it.min.js');
const { installI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');

function renderer() {
  let md;
  const context = vm.createContext({ markdownit: options => (md = markdownit(options)),
    katex: require('../vendor/katex.min.js') });
  installI18n(context);
  for (const file of ['layout-markdown.js', 'citation-markdown.js', 'export.js']) {
    vm.runInContext(fs.readFileSync(path.join(project, file), 'utf8'), context);
  }
  return { md, render: source => md.render(context.ChatGPTPdfExporter.preserveDiagrams(source)) };
}

test('the SST diagram renders nested boxes, a two-column index, caption and Markdown', () => {
  const { render } = renderer();
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/sst-layout.md'), 'utf8');
  for (const input of [source, source.replace(/\n(?=<\/?(?:box|text|grid|grid-item|caption)\b)/g, ' ')]) {
    const html = render(input);
    assert.match(html, /<h3>1\. 当前 SST 的核心结构<\/h3>/);
    assert.match(html, /<code>Builder::finish<\/code>/);
    assert.match(html, /archive-layout-box archive-layout-border" style="border-radius:8px;--archive-layout-padding:12px;--archive-layout-gap:8px"/);
    assert.match(html, /archive-layout-grid" style="--archive-layout-gap:8px;--archive-layout-columns:2"/);
    assert.equal((html.match(/class="archive-layout archive-layout-grid-item"/g) || []).length, 2);
    assert.match(html, /font-weight:600[^>]*>Main Data Blocks/);
    assert.match(html, /archive-layout-secondary[^>]*>每个 Key 的主版本/);
    assert.match(html, /<strong>Aux Index · BinaryFuse8<\/strong>/);
    assert.match(html, /archive-layout-caption[^>]*>各区域按此顺序序列化/);
    assert.doesNotMatch(html, /&lt;\/?(?:box|grid|grid-item|text|caption)\b/);
    assert.doesNotMatch(html, /<p>\s*<div/);
  }
});

test('component content retains math, lists, links and adjacent inline whitespace', () => {
  const { render } = renderer();
  const html = render('<box>\n- **first**\n- [second](https://example.com)\n\n<text>Hello <text>world</text> ! $x^2$</text>\n</box>');
  assert.match(html, /<ul>\n<li><strong>first<\/strong><\/li>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /Hello <div[^>]*>world<\/div> ! /);
  assert.match(html, /class="katex"/);
  const inline = render('Before <box border><text>**middle**</text></box> after.');
  assert.match(inline, /<p>Before <span[^>]*><span[^>]*><strong>middle<\/strong><\/span><\/span> after\.<\/p>/);
});

test('layout markup inside fenced, indented and inline code or escaped tags stays literal', () => {
  const { render } = renderer();
  for (const source of ['```xml\n<box border><text>code</text></box>\n```',
    '~~~xml\n<box border><text>code</text></box>\n~~~',
    '    <box border><text>code</text></box>',
    '`<box border><text>code</text></box>`',
    '\\<box border>escaped\\</box>']) {
    const html = render(source);
    assert.match(html, /&lt;box/);
    assert.doesNotMatch(html, /class="archive-layout/);
  }
  const nested = render('<box>\n```xml\n<text>code</text>\n</box>\n```\n</box>');
  assert.match(nested, /<pre><code class="language-xml">&lt;text&gt;code&lt;\/text&gt;\n&lt;\/box&gt;/);
  assert.equal((nested.match(/class="archive-layout/g) || []).length, 1);
});

test('only fixed layout tags and bounded presentation values become HTML', () => {
  const { render, md } = renderer();
  assert.equal(md.options.html, false);
  const html = render('<box border onclick="alert(1)" style="background:url(https://evil.example)" id="question-index" class="evil" padding={999} gap={-2} radius="url(evil)" background="url(evil)">\n<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe>\n<text weight="bold" size="sm" color="secondary" onload="alert(1)">safe</text>\n<grid columns={999}><grid-item>content</grid-item></grid>\n</box>');
  assert.match(html, /archive-layout-box archive-layout-border/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /font-weight:700;font-size:\.9rem/);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b/);
  assert.doesNotMatch(html, /<[^>]+(?:onclick|onload|onerror|id=|url\(|class="evil)/);
  assert.doesNotMatch(html, /--archive-layout-(?:columns|padding|gap):/);
  assert.match(render('<box padding={0} gap={12} border={false}>safe</box>'), /--archive-layout-padding:0px;--archive-layout-gap:48px/);
  assert.doesNotMatch(render('<box border={false}>safe</box>'), /archive-layout-border/);
});

test('unknown and malformed markup keeps its content and ordinary Markdown is unchanged', () => {
  const { render } = renderer();
  for (const source of ['<box>unfinished', '<box><text>mismatched</box>',
    '<box padding=3>unquoted</box>', '<unknown>content</unknown>']) {
    const html = render(source);
    assert.match(html, /&lt;/);
    assert.match(html, /unfinished|mismatched|unquoted|content/);
  }
  const plain = '# Heading\n\nA **bold** paragraph.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
  assert.equal(render(plain), markdownit({ html: false, linkify: true }).render(plain));
  assert.match(render('┌───┐\n│ A │\n└───┘'), /<pre><code class="language-text">/);
});

test('the export page loads the layout renderer before the exporter', () => {
  const page = fs.readFileSync(path.join(project, 'print.html'), 'utf8');
  assert.ok(page.indexOf('src="layout-markdown.js"') < page.indexOf('src="export.js"'));
});

test('indented component content is Markdown and camel-case presentation attributes work', () => {
  const { render } = renderer();
  const html = render('<box border>\n  <row align="start" justify="between" gap={3}>\n    <badge width={36}>P0</badge>\n    <box flex={1}>\n      **Heading**\n\n      Paragraph with `code`.\n    </box>\n  </row>\n  <divider color="subtle"/>\n  <title textAlign="center" size="lg" tabularNums>10500</title>\n  <icon name="arrow-down"/>\n  <box background="rgba(44,122,92,0.08)">中文</box>\n</box>');
  assert.match(html, /<strong>Heading<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.doesNotMatch(html, /<pre>/);
  assert.match(html, /align-items:flex-start;justify-content:space-between/);
  assert.match(html, /text-align:center;font-variant-numeric:tabular-nums/);
  assert.match(html, /archive-layout-icon[^>]*>↓/);
  assert.match(html, /background-color:rgba\(44,122,92,0.08\)/);
});

test('literal-array loops expand SVG geometry, numeric expressions and text', () => {
  const { render } = renderer();
  const html = render('<box>\n<svg viewBox="0 0 330 75" width="100%">\n{#each [0,1,2,3] as i}\n<rect x={9+i*78} y="12" width="72" height="31" rx="3" fill="#D9E9FC" stroke="#83A6D8"/>\n<text x={45+i*78} y="31" fontSize="10.5" fill="#284466" textAnchor="middle">K{i} + {i===0?"V0":"Handle"}</text>\n{/each}\n<path d="M10 48 L312 48" strokeWidth="1.7" strokeDasharray="4 3" stroke="#64748B"/>\n</svg>\n</box>');
  assert.equal((html.match(/<rect /g) || []).length, 4);
  assert.match(html, /<rect x="243"/);
  assert.match(html, /<text x="279"[^>]*font-size="10.5"[^>]*text-anchor="middle"/);
  assert.match(html, />K0 \+ V0<\/text>/);
  assert.match(html, />K3 \+ Handle<\/text>/);
  assert.match(html, /stroke-width="1.7" stroke-dasharray="4 3"/);
  assert.doesNotMatch(html, /\{#each|\{i\}|&lt;svg|archive-layout-text/);
});

test('layout loops preserve row order and conditional background without executing JavaScript', () => {
  const { render } = renderer();
  const html = render('<box>\n{#each [["First", "4 B"], ["Second", "8 B"]] as item,i}\n<row background={i<1?"surface-secondary":undefined} justify="between">\n<text>{item[0]}</text><text>{item[1]}</text>\n</row>\n{/each}\n</box>');
  assert.equal((html.match(/archive-layout-row/g) || []).length, 2);
  assert.equal((html.match(/archive-layout-surface-secondary/g) || []).length, 1);
  assert.ok(html.indexOf('First') < html.indexOf('Second'));
  assert.match(html, />4 B<\/div>/);
  assert.doesNotMatch(html, /\{#each|\{item/);
  const malicious = render('<box>{#each ["<img src=x onerror=evil()>", "**literal**"] as item}<text>{item}</text>{/each}</box>');
  assert.doesNotMatch(malicious, /<img|<strong>literal/);
  assert.match(malicious, /&lt;img/);
  assert.match(malicious, /\*\*literal\*\*/);
  assert.match(render('<box>{#each fetch("https://evil.example") as item}<text>{item}</text>{/each}</box>'), /&lt;box/);
  const attrs = render('<svg viewBox="0 0 30 30">{#each [0] as i}<rect x={globalThis.alert(1)} y={i=2} width={constructor.constructor("evil")()} height="10"/>{/each}</svg>');
  assert.doesNotMatch(attrs, /\sx=|\sy=|\swidth=|alert\(|constructor/);
});

test('object-array loops render every CSE entry field, byte size, background and pixel gap', () => {
  const { render } = renderer();
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/cse-entry-layout.md'), 'utf8');
  for (const input of [source, source.replace(/\n\s*/g, ' ')]) {
    const html = render(input);
    assert.equal((html.match(/class="archive-layout archive-layout-row/g) || []).length, 7);
    assert.equal((html.match(/>8 B<\/div>/g) || []).length, 2);
    assert.equal((html.match(/>变长<\/div>/g) || []).length, 2);
    assert.match(html, /--archive-layout-gap:2px/);
    assert.match(html, /background-color:rgba\(55,120,195,0.12\)/);
    assert.match(html, /background-color:rgba\(44,150,95,0.07\)/);
    assert.match(html, /CSE Data Block Entry/);
    const fields = ['Key Suffix Length', 'Key Suffix', 'Meta', 'Version', 'Old Version（可选）',
      'User Meta Length', 'User Meta / Value / BlobRef'];
    let previous = -1;
    for (const field of fields) {
      const position = html.indexOf(`>${field}</div>`);
      assert.ok(position > previous, field);
      previous = position;
    }
    assert.doesNotMatch(html, /&lt;box|\{#each|\{\/each\}|\{x\./);
  }
  for (const input of [`\`\`\`html\n${source}\n\`\`\``, `\`${source.replace(/\n\s*/g, ' ')}\``]) {
    const html = render(input);
    assert.match(html, /&lt;box/);
    assert.match(html, /\{x\.name\}/);
    assert.doesNotMatch(html, /class="archive-layout/);
  }
});

test('literal object data supports nested fields, escaped strings and trailing commas', () => {
  const { render } = renderer();
  const html = render('<box>{#each [{name: "contains as x} text", nested: {value: "中文\\nnext"}, sizes: [2, 8,],}, {name: \'it\\\'s a field\', nested: {value: "\\u4e2d"}, sizes: [1, 4]}] as x,i}<row><text>{i}: {x.name}</text><text>{x.nested.value} / {x.sizes[1]} / {x["name"]}</text></row>{/each}</box>');
  assert.equal((html.match(/archive-layout-row/g) || []).length, 2);
  assert.match(html, /0: contains as x} text/);
  assert.match(html, /中文\nnext \/ 8/);
  assert.match(html, /1: it's a field/);
  assert.match(html, /中 \/ 4/);
  assert.doesNotMatch(html, /\{#each|\{x\./);
});

test('object loops reject executable syntax and prototype fields while escaping literal values', () => {
  const { render } = renderer();
  for (const data of ['[{name: evil()}]', '[{get name(){return "bad"}}]', '[{...other}]',
    '[{["name"]:"bad"}]', '[{name: globalThis.location}]', '[{__proto__: {name:"bad"}}]',
    '[{"constructor": "bad"}]', '[{name:"one",name:"two"}]', '[{name: "unterminated}]']) {
    const html = render(`<box>{#each ${data} as x}<text>{x.name}</text>{/each}</box>`);
    assert.match(html, /&lt;box/);
    assert.doesNotMatch(html, /archive-layout-box/);
  }
  const html = render('<box>{#each [{name:"<img src=x onerror=evil()>", color:"url(https://evil.example)"}] as x}<row background={x.color} onclick={x.name}><text>{x.name}</text><text>{x.constructor}</text></row>{/each}</box>');
  assert.match(html, /&lt;img/);
  assert.match(html, /\{x\.constructor\}/);
  assert.doesNotMatch(html, /<img|<[^>]+(?:onclick|url\()/);
});

test('snapshot layout tables preserve SVG, all rows and bold comparison operators', () => {
  const { render } = renderer();
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/snapshot-table-layout.md'), 'utf8');
  for (const input of [source, source.replace(/\n\s*/g, ' ')]) {
    const html = render(input);
    assert.match(html, /<svg viewBox="0 0 400 60"/);
    assert.match(html, /<table class="archive-layout archive-layout-table"><tbody>/);
    assert.equal((html.match(/<tr /g) || []).length, 3);
    assert.equal((html.match(/<td /g) || []).length, 6);
    assert.match(html, /<strong>T &lt; MinTS<\/strong>/);
    assert.match(html, /<strong>MinTS ≤ T &lt; MaxTS<\/strong>/);
    assert.match(html, /<strong>T ≥ MaxTS<\/strong>/);
    assert.match(html, /所有记录都在未来，跳过 Block/);
    assert.match(html, /部分版本可见，继续查找/);
    assert.match(html, /可免去逐条上界比较/);
    assert.doesNotMatch(html, /&lt;\/?(?:table|table-row|table-cell|escape)\b|<escape|<table-(?:row|cell)/);
    assert.doesNotMatch(html, /<p>\s*<(?:table|tr|td)/);
  }
});

test('table loops and inline layouts retain valid structure, Markdown, math and links', () => {
  const { render } = renderer();
  const html = render('<table>{#each [{label:"First"},{label:"Second"}] as x}<table-row><table-cell>**{x.label}**</table-cell><table-cell>[link](https://example.com) $x^2$</table-cell></table-row>{/each}</table>');
  assert.equal((html.match(/<tr /g) || []).length, 2);
  assert.equal((html.match(/<td /g) || []).length, 4);
  assert.match(html, /<strong>First<\/strong>/);
  assert.match(html, /<strong>Second<\/strong>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /class="katex"/);
  const inline = render('Before <table><table-row><table-cell>**cell**</table-cell></table-row></table> after.');
  assert.match(inline, /<span class="archive-layout archive-layout-table" role="table">/);
  assert.match(inline, /role="row"/);
  assert.match(inline, /role="cell"><strong>cell<\/strong>/);
  assert.doesNotMatch(inline, /<table\b|<tr\b|<td\b/);
});

test('escape components emit literal characters without parsing their content or changing code examples', () => {
  const { render } = renderer();
  assert.match(render('**T <escape>&lt;</escape> MinTS**'), /<strong>T &lt; MinTS<\/strong>/);
  const literal = render('<box><text><escape><box>**literal** <script>evil()</script></escape></text></box>');
  assert.match(literal, /&lt;box&gt;\*\*literal\*\* &lt;script&gt;evil\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(literal, /<script|<strong>literal/);
  for (const input of ['```html\n<table><table-row><table-cell><escape><</escape></table-cell></table-row></table>\n```',
    '`<escape><</escape>`', '\\<escape><\\</escape>']) {
    const html = render(input);
    assert.match(html, /&lt;escape/);
    assert.doesNotMatch(html, /archive-layout-table|<table\b/);
  }
});

test('malformed table structure stays readable and untrusted table attributes are discarded', () => {
  const { render } = renderer();
  for (const source of ['<table-row><table-cell>orphan</table-cell></table-row>',
    '<table><table-cell>missing row</table-cell></table>', '<table>unexpected text</table>',
    '<table><table-row>missing cell</table-row></table>']) {
    const html = render(source);
    assert.match(html, /&lt;table/);
    assert.doesNotMatch(html, /<(?:table|tr|td)\b/);
  }
  const html = render('<table onclick="evil()"><table-row id="question-index"><table-cell style="background:url(evil)" onload="evil()">safe</table-cell></table-row></table>');
  assert.match(html, /<td class="archive-layout archive-layout-table-cell"><p>safe<\/p>/);
  assert.doesNotMatch(html, /<[^>]+(?:onclick|onload|style=|id=|url\()/);
});

test('SVG output strips executable elements, external references and untrusted attributes', () => {
  const { render } = renderer();
  const html = render('<svg viewBox="0 0 30 30" onload="evil()" style="color:red">\n<script>evil()</script><foreignObject><iframe src="https://evil.example"></iframe></foreignObject>\n<g fontSize="12" fill="currentColor" textAnchor="middle"><text x="15" y="20">中文 &amp; A</text></g>\n<rect width="30" height="30" fill="url(https://evil.example)" onclick="evil()"/>\n<path d="M0 0 L30 30" stroke="#000" href="https://evil.example"/>\n</svg>');
  assert.match(html, /<svg viewBox="0 0 30 30"/);
  assert.match(html, /<g font-size="12" fill="currentColor" text-anchor="middle"/);
  assert.match(html, /<text x="15" y="20">中文 &amp; A<\/text>/);
  assert.doesNotMatch(html, /<(?:script|foreignObject|iframe)\b/);
  assert.doesNotMatch(html, /<[^>]+(?:onload|onclick|href|style=|url\()/);
});

test('excessive loop expansion falls back to readable source instead of dropping content', () => {
  const { render } = renderer();
  const values = JSON.stringify(Array.from({ length: 100 }, (_, i) => i));
  const html = render(`<box>{#each ${values} as i}{#each ${values} as j}<text>{i} {j}</text>{/each}{/each}</box>`);
  assert.match(html, /^<pre><code>&lt;box&gt;/);
  assert.match(html, /\{#each/);
});
