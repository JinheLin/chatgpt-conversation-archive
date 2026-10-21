const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const project = path.resolve(__dirname, '..');

function fixture(t, count = 150, headings = false) {
  const dom = new JSDOM('<header class="reader-bar"></header><div id="layout"><aside></aside><main></main></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, main = doc.querySelector('main'), sidebar = doc.querySelector('aside'), layout = doc.getElementById('layout');
  const frames = new Map(), targets = new Map();
  let scroll = 0, serial = 0, geometryReads = 0;
  Object.defineProperty(w, 'scrollY', { get: () => scroll });
  Object.defineProperty(w, 'innerHeight', { value: 700 });
  w.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const rect = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 240, width: 240 });
  doc.querySelector('header').getBoundingClientRect = () => rect(0, 72);
  main.getBoundingClientRect = () => rect(180 - scroll, count * 900);
  sidebar.getBoundingClientRect = () => rect(88, 520);
  Object.defineProperty(sidebar, 'clientHeight', { value: 520 });
  const toc = doc.createElement('nav'); toc.id = 'question-index'; toc.className = 'pdf-toc'; toc.setAttribute('aria-label', 'Question navigation');
  toc.innerHTML = '<h2 id="index-heading">Question index</h2><ol></ol>';
  main.append(toc);
  function target(id, top, parent = main) {
    const node = doc.createElement('section'); node.id = id; parent.append(node);
    targets.set(id, { top, node });
    node.getClientRects = () => node.closest('[hidden]') ? [] : [rect(top - scroll, 40)];
    node.getBoundingClientRect = () => { geometryReads++; return rect(targets.get(id).top - scroll, 40); };
    return node;
  }
  for (let i = 1; i <= count; i++) {
    const item = doc.createElement('li'); item.innerHTML = `<a href="#question-${i}">Question ${i}</a>`;
    toc.querySelector('ol').append(item);
    const section = target('question-' + i, 200 + (i - 1) * 900);
    if (headings) {
      const list = doc.createElement('ul'); list.className = 'pdf-toc-headings';
      for (let j = 1; j <= 2; j++) {
        const id = `answer-heading-${i}-${j}`;
        target(id, 200 + (i - 1) * 900 + j * 200, section);
        const heading = doc.createElement('li'); heading.innerHTML = `<a href="#${id}" data-question-id="question-${i}">Chapter ${j}</a>`; list.append(heading);
      }
      item.append(list);
    }
  }
  w.eval(fs.readFileSync(path.join(project, 'preview-navigation.js'), 'utf8'));
  const api = w.ChatGPTPdfPreviewNavigation.init({ main, sidebar, layout });
  function linkGeometry() {
    [...sidebar.querySelectorAll('a')].forEach((link, index) => {
      link.getBoundingClientRect = () => rect(120 + index * 60 - sidebar.scrollTop, 40);
    });
  }
  async function flush() {
    await Promise.resolve();
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback();
    await Promise.resolve();
  }
  function scrollTo(top) { scroll = top; w.dispatchEvent(new w.Event('scroll')); }
  const current = () => sidebar.querySelector('a[aria-current="location"]')?.getAttribute('href');
  return { api, w, doc, main, toc, sidebar, layout, frames, targets, current, flush, scrollTo, linkGeometry,
    refresh() { api.refresh(); linkGeometry(); }, reads: () => geometryReads };
}

test('sidebar preserves every link and title without duplicating document IDs or marking the export index', async t => {
  const app = fixture(t), { api, toc, sidebar, layout } = app;
  assert.equal(layout.hidden, true);
  app.refresh(); await app.flush();
  assert.equal(layout.hidden, false);
  assert.equal(sidebar.hidden, false);
  const preview = sidebar.firstElementChild;
  assert.equal(preview.id, 'preview-question-index');
  assert.equal(preview.className, 'preview-toc');
  assert.deepEqual([...preview.querySelectorAll('a')].map(node => [node.href, node.textContent]), [...toc.querySelectorAll('a')].map(node => [node.href, node.textContent]));
  assert.equal(preview.querySelectorAll('a').length, 150);
  assert.equal(preview.querySelectorAll('[id]').length, 0);
  assert.equal(toc.id, 'question-index');
  assert.equal(toc.firstElementChild.id, 'index-heading');
  assert.equal(toc.className, 'pdf-toc');
  assert.equal(toc.querySelector('[aria-current], [data-current-question]'), null);
  assert.equal(app.current(), '#question-1');
  api.clear();
});

test('scrolling both ways highlights the current question and scrolls only the directory', async t => {
  const app = fixture(t); app.refresh(); await app.flush();
  app.scrollTo(app.targets.get('question-80').top - 80); await app.flush();
  assert.equal(app.current(), '#question-80');
  assert.equal(app.sidebar.querySelector('[data-current-question="true"] > a').getAttribute('href'), '#question-80');
  assert.ok(app.sidebar.scrollTop > 4000);
  const link = app.sidebar.querySelector('[aria-current]');
  assert.ok(link.getBoundingClientRect().bottom <= 596);
  assert.equal(app.w.scrollY, app.targets.get('question-80').top - 80);
  app.scrollTo(0); await app.flush();
  assert.equal(app.current(), '#question-1');
  assert.ok(app.sidebar.querySelector('[aria-current]').getBoundingClientRect().top >= 100);
  assert.equal(app.w.scrollY, 0);
});

test('chapters retain their parent question highlight and the final short section is selected at page end', async t => {
  const app = fixture(t, 4, true); app.refresh(); await app.flush();
  app.scrollTo(app.targets.get('answer-heading-2-1').top - 80); await app.flush();
  assert.equal(app.current(), '#answer-heading-2-1');
  assert.equal(app.sidebar.querySelector('[data-current-question="true"] > a').getAttribute('href'), '#question-2');
  assert.equal(app.sidebar.querySelectorAll('[aria-current]').length, 1);
  app.scrollTo(3100); await app.flush();
  assert.equal(app.current(), '#answer-heading-4-2');
  app.scrollTo(app.targets.get('question-3').top - 80); await app.flush();
  assert.equal(app.current(), '#question-3');
});

test('scroll events are coalesced and cached target positions avoid scanning long conversations on every scroll', async t => {
  const app = fixture(t); app.refresh(); await app.flush();
  const measured = app.reads();
  for (let i = 0; i < 100; i++) app.scrollTo(1000 + i);
  assert.equal(app.frames.size, 1);
  await app.flush();
  assert.equal(app.reads(), measured);
  assert.equal(app.current(), '#question-2');
  app.targets.get('question-2').top += 600;
  app.w.dispatchEvent(new app.w.Event('resize')); await app.flush();
  assert.equal(app.current(), '#question-1');
  assert.ok(app.reads() > measured);
});

test('anchor jumps select the destination even when CSS leaves extra space below a shorter toolbar', async t => {
  const app = fixture(t, 5);
  app.targets.get('question-1').node.style.scrollMarginTop = '120px';
  app.refresh(); await app.flush();
  app.scrollTo(app.targets.get('question-3').top - 120); await app.flush();
  assert.equal(app.current(), '#question-3');
});

test('resizing keeps the current question visible even when the selected section stays the same', async t => {
  const app = fixture(t, 5); app.refresh(); await app.flush();
  app.scrollTo(app.targets.get('question-3').top - 80); await app.flush();
  const current = app.sidebar.querySelector('[aria-current]');
  current.getBoundingClientRect = () => ({ top: 800 - app.sidebar.scrollTop, bottom: 840 - app.sidebar.scrollTop, height: 40 });
  app.w.dispatchEvent(new app.w.Event('resize')); await app.flush();
  assert.equal(app.current(), '#question-3');
  assert.ok(current.getBoundingClientRect().bottom <= 596);
});

test('a question remains visible when its current chapter is farther away than the sidebar height', async t => {
  const app = fixture(t, 10, true); app.refresh(); await app.flush();
  const chapter = app.sidebar.querySelector('a[href="#answer-heading-8-2"]');
  chapter.getBoundingClientRect = () => ({ top: 2400 - app.sidebar.scrollTop, bottom: 2440 - app.sidebar.scrollTop, height: 40 });
  app.scrollTo(app.targets.get('answer-heading-8-2').top - 80); await app.flush();
  assert.equal(app.current(), '#answer-heading-8-2');
  const question = app.sidebar.querySelector('[data-current-question] > a').getBoundingClientRect();
  assert.ok(question.top >= 100 && question.bottom <= 596);
});

test('late images, hidden targets and directory filters refresh the selection without jumping to an unrelated question', async t => {
  const app = fixture(t, 4); app.refresh(); await app.flush();
  app.scrollTo(app.targets.get('question-2').top - 80); await app.flush();
  const item = app.sidebar.querySelector('[data-current-question]'); item.hidden = true;
  await app.flush();
  assert.equal(app.current(), undefined);
  item.hidden = false; await app.flush();
  assert.equal(app.current(), '#question-2');
  app.targets.get('question-2').top += 400;
  const image = app.doc.createElement('img'); app.main.append(image); image.dispatchEvent(new app.w.Event('load'));
  await app.flush();
  assert.equal(app.current(), '#question-1');
  app.targets.get('question-1').node.hidden = true; await app.flush();
  assert.equal(app.current(), '#question-2');
});

test('reread and cancellation disconnect tracking and a missing document clears the directory', async t => {
  const app = fixture(t, 3), { api, main, toc, sidebar, layout } = app;
  app.refresh(); await app.flush(); app.refresh(); await app.flush();
  assert.equal(sidebar.children.length, 1);
  assert.equal(sidebar.querySelectorAll('a').length, 3);
  app.scrollTo(1200); assert.equal(app.frames.size, 1);
  api.clear();
  assert.equal(app.frames.size, 0);
  assert.equal(layout.hidden, true);
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebar.children.length, 0);
  app.scrollTo(1600); assert.equal(app.frames.size, 0);
  assert.equal(toc.querySelectorAll('a').length, 3);
  main.hidden = true; app.refresh(); assert.equal(layout.hidden, true);
  main.hidden = false; main.replaceChildren(); app.refresh(); assert.equal(sidebar.hidden, true);
});

test('directory browsing preserves keyboard focus and does not snap back until the reading section changes', async t => {
  const app = fixture(t, 10); app.refresh(); await app.flush();
  const browsing = app.sidebar.querySelector('a[href="#question-9"]'); browsing.focus();
  app.sidebar.scrollTop = 400;
  app.scrollTo(100); await app.flush();
  assert.equal(app.sidebar.scrollTop, 400);
  assert.equal(app.doc.activeElement, browsing);
  app.scrollTo(2000); await app.flush();
  assert.equal(app.current(), '#question-3');
  assert.equal(app.doc.activeElement, browsing);
});
