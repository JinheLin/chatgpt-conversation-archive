const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const firstTime = '2026-10-11T03:15:27.000Z';
const secondTime = '2026-10-11T03:16:45.250Z';

test('message normalization uses creation seconds, preserves fractions and omits missing or invalid times', t => {
  const app = fixture(); t.after(() => app.w.close());
  const times = [Date.parse(firstTime) / 1000, Date.parse(secondTime) / 1000,
    undefined, null, 0, -1, NaN, Infinity, 1e100, '2026-10-11T03:15:27Z'];
  const mapping = { root: { id: 'root', parent: null, children: ['m0'] } };
  times.forEach((create_time, index) => {
    mapping['m' + index] = { id: 'm' + index, parent: index ? 'm' + (index - 1) : 'root',
      children: index < times.length - 1 ? ['m' + (index + 1)] : [],
      message: { id: 'm' + index, author: { role: index % 2 ? 'assistant' : 'user' },
        content: { parts: ['Message ' + index] }, create_time, update_time: Date.parse('2026-10-12T00:00:00Z') / 1000 } };
  });
  const result = app.w.ChatGPTPdfSource.normalize({ title: 'Times', current_node: 'm9', mapping }, payload().sourceUrl);
  assert.equal(result.messages[0].createdAt, firstTime);
  assert.equal(result.messages[1].createdAt, secondTime);
  assert.ok(result.messages.slice(2).every(message => !Object.hasOwn(message, 'createdAt')));
  assert.equal(result.messages.length, times.length);
});

test('message times survive local storage and backup restore, while legacy snapshots and invalid imports remain safe', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const data = payload();
  data.messages[0].createdAt = '2026-10-11T11:15:27+08:00';
  data.messages[1].createdAt = secondTime;
  await app.w.ChatGPTReaderStore.saveConversation(data);
  const saved = await app.w.ChatGPTReaderStore.getConversation('c:test-conversation');
  assert.deepEqual(Array.from(saved.payload.messages, message => message.createdAt), [firstTime, secondTime]);
  const backup = plain(await app.w.ChatGPTReaderStore.backup());
  const restored = fixture(); t.after(() => restored.w.close());
  await restored.w.ChatGPTReaderStore.restore(backup);
  assert.deepEqual(plain((await restored.w.ChatGPTReaderStore.getConversation('c:test-conversation')).payload), plain(saved.payload));
  const invalid = plain(backup);
  invalid.conversations[0].payload.messages[1].createdAt = 'not a time';
  await assert.rejects(restored.w.ChatGPTReaderStore.restore(invalid), /Invalid/);
  assert.deepEqual(plain((await restored.w.ChatGPTReaderStore.getConversation('c:test-conversation')).payload), plain(saved.payload));
  const old = plain(backup);
  old.conversations[0].payload.capturedAt = '2026-10-12T00:00:00Z';
  old.conversations[0].payload.messages.forEach(message => { delete message.createdAt; });
  await restored.w.ChatGPTReaderStore.restore(old);
  assert.ok((await restored.w.ChatGPTReaderStore.getConversation('c:test-conversation')).payload.messages
    .every(message => !Object.hasOwn(message, 'createdAt')));
});

for (const locale of ['en', 'zh-CN']) {
  test('reader and HTML show each message time to the second without adding it to body text or navigation (' + locale + ')', async t => {
    const data = payload('Question', 'An **answer** with unchanged text.');
    data.messages[0].createdAt = firstTime;
    data.messages[1].createdAt = secondTime;
    const app = fixture({ locale, initial: data.sourceUrl }); t.after(() => app.w.close());
    await app.w.ChatGPTReaderStore.saveConversation(data); await app.start();
    const check = root => {
      const times = [...root.querySelectorAll('.pdf-role time')];
      assert.deepEqual(times.map(node => node.getAttribute('datetime')), [firstTime, secondTime]);
      assert.match(times[0].textContent, /\d{2}:\d{2}:27/);
      assert.match(times[1].textContent, /\d{2}:\d{2}:45/);
      assert.doesNotMatch(times[1].textContent, /\.250/);
      assert.equal(root.querySelector('.pdf-user .pdf-message-body').textContent.trim(), 'Question');
      assert.equal(root.querySelector('.pdf-assistant .pdf-message-body').textContent.trim(), 'An answer with unchanged text.');
      assert.equal(root.querySelector('.pdf-toc ol > li > a').textContent, 'Question');
      assert.equal(root.querySelectorAll('.pdf-message-body time').length, 0);
    };
    check(app.main);
    app.get('save-html').click(); await waitFor(() => app.downloads.length === 1 && !app.get('save-html').disabled);
    const html = await new Promise(resolve => {
      const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
    });
    check(new app.w.DOMParser().parseFromString(html, 'text/html'));
    const reopened = fixture({ factory: app.factory, locale, initial: data.sourceUrl }); t.after(() => reopened.w.close());
    await reopened.start(); check(reopened.main);
    assert.equal(reopened.requests.length, 0);
  });
}

test('missing message times are not replaced with the snapshot date and invalid times do not break rendering', async t => {
  const app = fixture(); t.after(() => app.w.close());
  const old = payload();
  await app.w.ChatGPTPdfExporter.render(old, app.main);
  assert.equal(app.main.querySelectorAll('.pdf-role time').length, 0);
  old.messages[0].createdAt = null;
  old.messages[1].createdAt = 'not a time';
  await app.w.ChatGPTPdfExporter.render(old, app.main);
  assert.equal(app.main.querySelectorAll('.pdf-role time').length, 0);
  assert.doesNotMatch(app.main.textContent, /Invalid Date/);
  assert.ok(app.main.querySelector('strong'));
});
