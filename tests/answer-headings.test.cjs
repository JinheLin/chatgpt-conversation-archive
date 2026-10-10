const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

function conversation() {
  const messages = [
    { id: 'q1', role: 'user', text: 'First question' },
    { id: 'a1', role: 'assistant', text: [
      '## 第一节：**存储布局**', '正文。', '### 二级小节', '更多正文。',
      '## 重复标题', '```markdown\n# Code example, not a heading\n```',
      '> # Quoted heading', '- Item\n\n  # Heading inside a list'
    ].join('\n\n') },
    { id: 'a2', role: 'assistant', text: '# 重复标题\n\n## Nested section\n\n# 另一节' },
    { id: 'q2', role: 'user', text: 'Second question' },
    { id: 'a3', role: 'assistant', text: '### Third-level top section\n\n#### Nested section\n\n### Another top section' },
    { id: 'a4', role: 'assistant', text: 'A final answer without headings.' }
  ];
  return { ...payload(), title: 'Heading navigation fixture', messages,
    completeness: { verified: true, count: messages.length, questions: 2, firstMessageId: 'q1', lastMessageId: 'a4' } };
}

test('each answer adds only its top-level Markdown headings below the preceding question, with distinct stable targets', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const data = conversation();
  await app.w.ChatGPTPdfExporter.render(data, app.main);
  const questions = app.main.querySelectorAll('.pdf-toc > ol > li');
  assert.equal(questions.length, 2);
  const titles = question => [...question.querySelectorAll('.pdf-toc-headings a')].map(link => link.textContent);
  assert.deepEqual(titles(questions[0]), ['第一节：存储布局', '重复标题', '重复标题', '另一节']);
  assert.deepEqual(titles(questions[1]), ['Third-level top section', 'Another top section']);
  const links = [...app.main.querySelectorAll('.pdf-toc-headings a')];
  const ids = links.map(link => link.hash.slice(1));
  assert.equal(new Set(ids).size, 6);
  for (const link of links) {
    const target = app.w.document.getElementById(link.hash.slice(1));
    assert.equal(target.tagName.match(/^H[1-6]$/)?.[0], target.tagName);
    assert.equal(target.closest('.pdf-assistant').dataset.messageId, link.dataset.questionId === 'question-2' ? 'a3' :
      target.id.startsWith('answer-heading-2-') ? 'a1' : 'a2');
    assert.ok(target.classList.contains('pdf-answer-heading'));
  }
  const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
  assert.ok(body.querySelector('blockquote h1')); assert.ok(body.querySelector('li h1'));
  assert.equal(body.querySelector('pre code').textContent.trim(), '# Code example, not a heading');
  assert.equal(body.querySelector('h3').id, '');
  assert.ok(body.querySelector('h2 strong')); // Navigation does not alter heading formatting.
  await app.w.ChatGPTPdfExporter.render(data, app.main);
  assert.deepEqual([...app.main.querySelectorAll('.pdf-toc-headings a')].map(link => link.hash.slice(1)), ids);
});

test('Setext headings are supported and inline code, links, math and citations produce clean plain-text labels', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const data = payload('Question', [
    'Setext **heading**', '=================', 'Text.', '## Lower level is excluded',
    '# `SST` [布局](https://example.com) $MinTS = 100$ <cite refs={["turn1search0"]}/>',
    '# <cite refs={["turn1search0"]}/>'
  ].join('\n\n').replace('heading**\n\n===', 'heading**\n==='));
  data.messages[1].sources = [{ title: 'Source', url: 'https://example.com' }];
  await app.w.ChatGPTPdfExporter.render(data, app.main);
  const links = [...app.main.querySelectorAll('.pdf-toc-headings a')];
  assert.deepEqual(links.map(link => link.textContent), ['Setext heading', 'SST 布局 MinTS = 100']);
  assert.equal(links[1].querySelector('a, .katex, .pdf-citation'), null);
  assert.ok(app.main.querySelector('.pdf-assistant h1 .katex'));
  assert.ok(app.main.querySelector('.pdf-assistant h1 .pdf-citation'));
});

test('preview navigation copies the complete question/heading hierarchy without duplicating destination IDs', async t => {
  const app = fixture(); t.after(() => app.w.close());
  await app.w.ChatGPTPdfExporter.render(conversation(), app.main);
  const navigation = app.w.ChatGPTPdfPreviewNavigation.init({ main: app.main, sidebar: app.get('preview-sidebar'), layout: app.get('preview-layout') });
  navigation.refresh();
  const sidebar = app.get('preview-sidebar');
  assert.equal(sidebar.querySelectorAll('.preview-toc > ol > li').length, 2);
  assert.equal(sidebar.querySelectorAll('.pdf-toc-headings a').length, 6);
  assert.equal(sidebar.querySelectorAll('.preview-toc [id]').length, 0);
  for (const link of sidebar.querySelectorAll('a')) assert.ok(app.w.document.getElementById(link.hash.slice(1)));
  const ids = [...app.w.document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(ids.length, new Set(ids).size);
  navigation.refresh();
  assert.equal(sidebar.querySelectorAll('.preview-toc').length, 1);
});

test('answers without headings and headings in questions leave the original question-only index intact', async t => {
  const app = fixture(); t.after(() => app.w.close());
  await app.w.ChatGPTPdfExporter.render(payload('# Question heading', '> # Quoted title\n\n```text\n# Example\n```'), app.main);
  assert.equal(app.main.querySelectorAll('.pdf-toc a').length, 1);
  assert.equal(app.main.querySelectorAll('.pdf-answer-heading').length, 0);
});

test('offline HTML retains nested heading links, destinations and original formatting', async t => {
  const data = conversation(), app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1);
  const text = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  const html = new app.w.DOMParser().parseFromString(text, 'text/html');
  assert.equal(html.querySelectorAll('.pdf-toc > ol > li').length, 2);
  assert.equal(html.querySelectorAll('.pdf-toc-headings a').length, 6);
  for (const link of html.querySelectorAll('.pdf-toc a')) assert.ok(html.getElementById(link.getAttribute('href').slice(1)));
  assert.equal(html.querySelectorAll('script, #preview-sidebar').length, 0);
  assert.equal(html.querySelector('.pdf-assistant h2 strong').textContent, '存储布局');
  assert.equal(app.requests.length, 0);
});

test('direct and fallback PDF export group answer headings below question metadata instead of treating them as extra questions', async t => {
  const data = conversation(), app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  const calls = [];
  app.w.ChatGPTPdfCapture = { capture: async () => new Uint8Array([1]) };
  app.w.ChatGPTPdfOutline = { MAX_BYTES: 100000,
    add: async (bytes, metadata) => { calls.push(metadata); return { bytes: new Uint8Array([2]), questions: 2, headings: 6, pages: 3 }; } };
  app.get('save-pdf').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-pdf').disabled);
  const file = app.get('pdf-outline-file');
  Object.defineProperty(file, 'files', { value: [{ size: 1, name: 'Fixture.pdf', arrayBuffer: async () => new ArrayBuffer(1) }] });
  file.dispatchEvent(new app.w.Event('change')); await waitFor(() => app.downloads.length === 2);
  assert.equal(calls.length, 2);
  for (const metadata of calls) {
    assert.equal(metadata.questions.length, 2);
    assert.equal(metadata.questions[0].headings.length, 4);
    assert.equal(metadata.questions[1].headings.length, 2);
    assert.equal(metadata.questions[1].headings[0].id, 'answer-heading-5-1');
  }
});

test('numbered Chinese chapters replace the answer title and exclude decimal subsections', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const data = payload('Question', [
    '# 全文总标题', '开场说明。', '## 一、技术演进', '正文。', '## 二、共享存储',
    '### 2.1 页面版本', '### 2.2 恢复过程', '## 三、存储分层', '## 四、总体评价', '## 最后：阅读建议'
  ].join('\n\n'));
  await app.w.ChatGPTPdfExporter.render(data, app.main);
  const links = [...app.main.querySelectorAll('.pdf-toc-headings a')];
  assert.deepEqual(links.map(a => a.textContent), ['一、技术演进', '二、共享存储', '三、存储分层', '四、总体评价', '最后：阅读建议']);
  assert.equal(app.main.querySelector('.pdf-assistant h1').id, '');
  assert.equal(app.main.querySelector('.pdf-assistant h3').id, '');
  for (const link of links) assert.equal(app.w.document.getElementById(link.hash.slice(1)).tagName, 'H2');
});

test('a standalone answer title or title/subtitle is skipped even without numbering', async t => {
  const app = fixture(); t.after(() => app.w.close());
  for (const source of ['# 总标题\n\n## 背景\n\n### 子问题\n\n## 实现\n\n## 总结',
    '# 总标题\n\n## 副标题\n\n### 背景\n\n#### 子问题\n\n### 实现\n\n### 总结']) {
    await app.w.ChatGPTPdfExporter.render(payload('Question', source), app.main);
    assert.deepEqual([...app.main.querySelectorAll('.pdf-toc-headings a')].map(a => a.textContent), ['背景', '实现', '总结']);
  }
});

test('common numbering forms support Chinese, Arabic, parentheses, chapters and Roman numerals', async t => {
  const app = fixture(); t.after(() => app.w.close());
  for (const titles of [['一、背景', '二、实现'], ['十、背景', '十一、实现'], ['1. Background', '2. Implementation'],
    ['１．背景', '２．实现'], ['1、背景', '2、实现'], ['（一）背景', '（二）实现'], ['1) Background', '2) Implementation'],
    ['第一章 背景', '第二章 实现'], ['Chapter 1: Background', 'Chapter 2: Implementation'], ['Part I: Background', 'Part II: Implementation'],
    ['I. Background', 'II. Implementation']]) {
    await app.w.ChatGPTPdfExporter.render(payload('Question', '# Overall title\n\n' + titles.map(title => '## ' + title).join('\n\n')), app.main);
    assert.deepEqual([...app.main.querySelectorAll('.pdf-toc-headings a')].map(a => a.textContent), titles);
  }
});

test('consistent chapter numbering survives mixed Markdown levels and bold or plain paragraph headings', async t => {
  const app = fixture(); t.after(() => app.w.close());
  for (const source of [
    '# 总标题\n\n## 一、背景\n\n### 二、实现\n\n## 三、总结',
    '# 总标题\n\n**一、背景**\n\n普通正文。\n\n### 1.1 子问题\n\n二、实现\n\n普通正文。\n\n**三、总结**',
    '**（一）背景**\n\n普通正文。\n\n**（二）实现**',
    '一、背景\n\n普通正文。\n\n二、实现'
  ]) {
    await app.w.ChatGPTPdfExporter.render(payload('Question', source), app.main);
    const links = [...app.main.querySelectorAll('.pdf-toc-headings a')];
    assert.ok(links.length >= 2);
    assert.deepEqual(links.map(a => a.textContent), source.includes('（一）') ? ['（一）背景', '（二）实现'] :
      source.includes('三、') ? ['一、背景', '二、实现', '三、总结'] : ['一、背景', '二、实现']);
    for (const link of links) assert.ok(app.w.document.getElementById(link.hash.slice(1)));
    const body = app.main.querySelector('.pdf-assistant .pdf-message-body');
    const before = body.innerHTML;
    app.w.ChatGPTAnswerHeadings.select(body);
    assert.equal(body.innerHTML, before); // Selection changes neither text nor annotation anchors.
  }
});

test('numbered code, lists, quotations, diagram text and short bold statements do not become chapters', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const source = ['# 总标题', '## 背景', '一、普通内部要点', '二、普通内部要点', '## 实现',
    '**独立粗体强调句**', '> ## 一、引用\n> ## 二、引用',
    '1. **First list item**\n2. **Second list item**', '```text\n一、代码\n二、代码\n```',
    '<box><text>一、图形</text><text>二、图形</text></box>',
    '一、这是一段很长的正文，' + '它不应该成为目录。'.repeat(20), '二、这也是很长的正文，' + '它不应该成为目录。'.repeat(20)
  ].join('\n\n');
  await app.w.ChatGPTPdfExporter.render(payload('Question', source), app.main);
  assert.deepEqual([...app.main.querySelectorAll('.pdf-toc-headings a')].map(a => a.textContent), ['背景', '实现']);
  assert.ok(app.main.querySelector('.pdf-assistant pre code').textContent.includes('一、代码'));
  await app.w.ChatGPTPdfExporter.render(payload('Question', '`一、代码`\n\n`二、代码`\n\n**`三、代码`**'), app.main);
  assert.equal(app.main.querySelectorAll('.pdf-toc-headings a').length, 0);
});

test('chapter selection is shared by the offline index and direct and fallback PDF metadata', async t => {
  const data = payload('Question', '# 总标题\n\n## 一、背景\n\n### 1.1 子问题\n\n## 二、实现');
  const app = fixture({ initial: data.sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
  const sidebar = app.get('preview-sidebar');
  assert.deepEqual([...sidebar.querySelectorAll('.pdf-toc-headings a')].map(a => a.textContent), ['一、背景', '二、实现']);
  app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
  const text = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  const html = new app.w.DOMParser().parseFromString(text, 'text/html');
  assert.deepEqual([...html.querySelectorAll('.pdf-toc-headings a')].map(a => a.textContent), ['一、背景', '二、实现']);
  const calls = [];
  app.w.ChatGPTPdfCapture = { capture: async () => new Uint8Array([1]) };
  app.w.ChatGPTPdfOutline = { MAX_BYTES: 100000, add: async (bytes, metadata) => {
    calls.push(metadata); return { bytes: new Uint8Array([2]), questions: 1, headings: 2, pages: 2 };
  } };
  app.get('save-pdf').click(); await waitFor(() => app.downloads.length === 2 && !app.get('save-pdf').disabled);
  const file = app.get('pdf-outline-file');
  Object.defineProperty(file, 'files', { value: [{ size: 1, name: 'Fixture.pdf', arrayBuffer: async () => new ArrayBuffer(1) }] });
  file.dispatchEvent(new app.w.Event('change')); await waitFor(() => app.downloads.length === 3);
  assert.equal(calls.length, 2);
  for (const metadata of calls) assert.deepEqual(Array.from(metadata.questions[0].headings, h => h.title), ['一、背景', '二、实现']);
});
