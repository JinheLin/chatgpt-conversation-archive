const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { installI18n } = require('./helpers/i18n.cjs');

function renderer() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.hidden = true; }
    getContext() { return { measureText: text => ({ width: text.length * 8 }) }; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren() { this.children = []; }
    setAttribute(name, value) { this[name] = value; }
    set innerHTML(value) { this.html = value; }
    get textContent() { return this.text ?? (this.html || '').replace(/<[^>]*>/g, '') + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...((selector === 'section.pdf-message' && child.tag === 'section' && child.className.includes('pdf-message')) ||
          (selector === 'pre' && child.tag === 'pre') ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }
  }
  let now = 0;
  const context = vm.createContext({
    document: { createElement: tag => new Node(tag) }, setTimeout,
    performance: { now: () => now += 10 },
    getComputedStyle: () => ({ fontSize: '13.333px', fontFamily: 'monospace' }),
    markdownit: require('../vendor/markdown-it.min.js'), katex: require('../vendor/katex.min.js')
  });
  installI18n(context);
  for (const file of ['layout-markdown.js', 'citation-markdown.js', 'export.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { ...context.ChatGPTPdfExporter, main: new Node('main'), pre: text => { const node = new Node('pre'); node.textContent = text; return node; } };
}
const payload = {
  title: 'Cooperative rendering', capturedAt: '2026-10-09T00:00:00Z',
  messages: Array.from({ length: 20 }, (_, index) => ({ id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', text: `Message ${index}` })),
  completeness: { verified: true, count: 20, questions: 10 }
};

test('rendering yields to the event loop before completion while preserving message order and counts', async () => {
  const { render, main } = renderer();
  const progress = [];
  const pending = render(payload, main, { onProgress: event => progress.push(event.completed) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(main.hidden, true);
  assert.ok(progress.at(-1) < payload.messages.length);
  await pending;
  assert.equal(main.hidden, false);
  assert.deepEqual(main.querySelectorAll('section.pdf-message').map(node => node.dataset.messageId), payload.messages.map(message => message.id));
  assert.equal(progress.at(-1), 20);
});

test('code fitting yields and keeps the same width calculation, tab expansion and final font sizes', async () => {
  const { fitCode, main, pre } = renderer();
  const small = pre('\tA\nabcdef'), large = pre('x'.repeat(200));
  main.appendChild(small); main.appendChild(large);
  const completed = [];
  const pending = fitCode(main, false, { onProgress: event => completed.push(event.completed) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(completed.length < 2);
  await pending;
  const width = (210 - 34) * 96 / 25.4 - 26;
  assert.equal(small.style.fontSize, '10pt');
  assert.equal(large.style.fontSize, `${10 * width / 1600}pt`);
  assert.deepEqual(completed, [1, 2]);
});

test('cancelling during a render batch stops further messages and keeps the partial document hidden', async () => {
  const { render, main } = renderer();
  let cancelled = false;
  await assert.rejects(render(payload, main, {
    isCancelled: () => cancelled,
    onProgress: event => { if (event.completed > 0) cancelled = true; }
  }), /cancelled/);
  assert.equal(main.hidden, true);
  assert.equal(main.querySelectorAll('section.pdf-message').length, 1);
});

test('full export connects inline citations to each message source list and keeps TOC titles clean', async () => {
  const { render, main } = renderer();
  const citation = '<cite refs={["turn1search0"]}/>';
  await render({
    title: 'Citation export', capturedAt: '2026-10-09T00:00:00Z',
    messages: [
      { id: 'q1', role: 'user', text: `Question ${citation}` },
      { id: 'a1', role: 'assistant', text: `Answer ${citation}\n\n\`${citation}\``,
        sources: [{ title: 'Reference', url: 'https://example.com/reference' }] },
      { id: 'a2', role: 'assistant', text: `Answer ${citation}`,
        sources: [{ title: 'Unavailable', url: 'javascript:evil()' }] }
    ],
    completeness: { verified: true, count: 3, questions: 1 }
  }, main);
  const sections = main.querySelectorAll('section.pdf-message');
  const body = sections[1].children.find(node => node.className === 'pdf-message-body');
  assert.match(body.html, /href="#sources-2"/);
  assert.match(body.html, /<code>&lt;cite refs=/);
  const sources = body.children.find(node => node.className === 'pdf-sources');
  assert.equal(sources.id, 'sources-2');
  assert.equal(sources.children[1].children[0].children[0].href, 'https://example.com/reference');
  const unresolved = sections[2].children.find(node => node.className === 'pdf-message-body');
  assert.match(unresolved.html, /Source details unavailable/);
  assert.doesNotMatch(unresolved.html, /href=|turn1search/);
  assert.equal(unresolved.children.length, 0);
  const toc = main.children.find(node => node.tag === 'nav');
  assert.equal(toc.children[1].children[0].children[0].textContent, 'Question');
});
