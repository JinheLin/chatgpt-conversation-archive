const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function view(reducedMotion = false) {
  const frames = new Map();
  let id = 0, now = 0;
  const context = vm.createContext({
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../read-progress.js'), 'utf8'), context);
  const bar = {}, fill = { style: {} }, count = {};
  const api = context.ChatGPTPdfReadProgress.init({ bar, fill, count, reducedMotion });
  function tick() {
    now += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(now);
  }
  return { ...api, bar, fill, count, frames, tick };
}

test('animation advances smoothly to reported progress without creeping past it during a wait', () => {
  const app = view();
  app.set(40);
  assert.equal(app.bar.value, 40);
  assert.equal(app.count.textContent, '0%');
  app.tick();
  const first = parseInt(app.count.textContent);
  assert.ok(first > 0 && first < 40);
  app.set(70);
  let previous = first;
  for (let i = 0; i < 100; i++) {
    app.tick();
    const current = parseInt(app.count.textContent);
    assert.ok(current >= previous && current <= 70);
    previous = current;
  }
  assert.equal(app.count.textContent, '70%');
  assert.equal(app.frames.size, 0);
  app.set(20);
  assert.equal(app.bar.value, 70);
});

test('cancellation stops pending animation; retry resets it; confirmed completion shows 100%', () => {
  const app = view();
  app.set(90); app.tick();
  app.stop();
  const stopped = app.count.textContent;
  app.tick();
  assert.equal(app.count.textContent, stopped);
  app.reset();
  assert.equal(app.count.textContent, '0%');
  assert.equal(app.fill.style.transform, 'scaleX(0)');
  app.set(100);
  assert.equal(app.count.textContent, '100%');
  assert.equal(app.frames.size, 0);
});

test('reduced motion displays confirmed percentages immediately without scheduling animation', () => {
  const app = view(true);
  app.set(65);
  assert.equal(app.count.textContent, '65%');
  assert.equal(app.frames.size, 0);
});
