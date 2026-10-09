const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const project = path.resolve(__dirname, '..');

function fixture(count = 150) {
  class Node {
    constructor(tag, id = '') { this.tag = tag; this.id = id; this.children = []; this.hidden = false; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren() { this.children = []; }
    removeAttribute(name) { delete this[name]; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(selector === '[id]' && child.id || selector === 'a' && child.tag === 'a' ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }
    cloneNode(deep) {
      const copy = Object.assign(new Node(this.tag), this);
      copy.children = deep ? this.children.map(child => child.cloneNode(true)) : [];
      return copy;
    }
  }
  const toc = new Node('nav', 'question-index'); toc.className = 'pdf-toc'; toc.ariaLabel = 'Question navigation';
  toc.appendChild(new Node('h2', 'index-heading')).textContent = 'Question index';
  const list = toc.appendChild(new Node('ol'));
  for (let i = 1; i <= count; i++) {
    const link = list.appendChild(new Node('li')).appendChild(new Node('a'));
    link.href = `#question-${i}`; link.textContent = `Question ${i}`;
  }
  const main = new Node('main'); main.appendChild(toc);
  main.querySelector = () => main.children.find(node => node.className === 'pdf-toc');
  const sidebar = new Node('aside'), layout = new Node('div');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(project, 'preview-navigation.js'), 'utf8'), context);
  const api = context.ChatGPTPdfPreviewNavigation.init({ main, sidebar, layout });
  return { api, main, toc, sidebar, layout };
}

test('sidebar preserves every question link and title without duplicating document destination IDs', () => {
  const { api, toc, sidebar, layout } = fixture();
  assert.equal(layout.hidden, true);
  api.refresh();
  assert.equal(layout.hidden, false);
  assert.equal(sidebar.hidden, false);
  const preview = sidebar.children[0];
  assert.equal(preview.id, 'preview-question-index');
  assert.equal(preview.className, 'preview-toc');
  assert.deepEqual(preview.querySelectorAll('a').map(node => [node.href, node.textContent]), toc.querySelectorAll('a').map(node => [node.href, node.textContent]));
  assert.equal(preview.querySelectorAll('a').length, 150);
  assert.equal(preview.querySelectorAll('[id]').length, 0);
  assert.equal(toc.id, 'question-index');
  assert.equal(toc.children[0].id, 'index-heading');
  assert.equal(toc.className, 'pdf-toc');
});

test('reread replaces the sidebar, and cancellation or an incomplete document clears it', () => {
  const { api, main, toc, sidebar, layout } = fixture(3);
  api.refresh();
  api.refresh();
  assert.equal(sidebar.children.length, 1);
  assert.equal(sidebar.children[0].querySelectorAll('a').length, 3);
  api.clear();
  assert.equal(layout.hidden, true);
  assert.equal(sidebar.hidden, true);
  assert.equal(sidebar.children.length, 0);
  assert.equal(toc.querySelectorAll('a').length, 3);
  main.hidden = true;
  api.refresh();
  assert.equal(layout.hidden, true);
  main.hidden = false;
  main.replaceChildren();
  api.refresh();
  assert.equal(sidebar.hidden, true);
});
