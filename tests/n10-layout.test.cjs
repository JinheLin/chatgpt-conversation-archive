const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, payload, waitFor } = require('./helpers/reader.cjs');

for (const locale of ['en', 'zh-CN']) test('N10 selection is localized and mutually exclusive; preview and HTML share its page geometry (' + locale + ')', async t => {
  const app = fixture({ locale, initial: payload().sourceUrl }); t.after(() => app.w.close());
  await app.w.ChatGPTReaderStore.saveConversation(payload());
  await app.start();
  const n10 = app.get('n10-layout'), mobile = app.get('mobile-layout'), landscape = app.get('page-layout');
  assert.equal(n10.checked, false);
  assert.equal(app.main.dataset.pageLayout, 'portrait');
  assert.equal(n10.closest('label').textContent.trim(), locale === 'en' ? 'Hanwang N10 (3:4)' : '汉王 N10（3:4）');
  assert.ok(n10.closest('#export-formats'));
  for (const control of [mobile, n10, landscape, n10]) {
    control.checked = true;
    control.dispatchEvent(new app.w.Event('change'));
    assert.equal(n10.disabled, true);
    await waitFor(() => !control.disabled);
    assert.deepEqual([mobile, n10, landscape].map(other => other.checked), [mobile, n10, landscape].map(other => other === control));
  }
  assert.equal(app.main.dataset.pageLayout, 'hanwang-n10');
  assert.equal(app.main.dataset.landscape, 'false');
  assert.equal(app.get('n10-layout-hint').hidden, false);
  assert.equal(app.get('mobile-layout-hint').hidden, true);
  assert.match(app.get('page-direction').textContent, /150mm 200mm; margin: 10mm 10mm 10mm 10mm/);
  assert.deepEqual({ ...app.w.ChatGPTPageLayout.contentSize('hanwang-n10') }, { width: 130, height: 180 });
  app.get('save-html').click();
  assert.equal(n10.disabled, true);
  await waitFor(() => app.downloads.length === 1 && !n10.disabled);
  const html = await new Promise(resolve => {
    const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.downloads[0]);
  });
  assert.match(html, /data-page-layout="hanwang-n10"/);
  assert.match(html, /@page \{ size: 150mm 200mm; margin: 10mm 10mm 10mm 10mm/);
  assert.doesNotMatch(html, /<script/);
  const doc = new app.w.DOMParser().parseFromString(html, 'text/html');
  assert.equal(doc.querySelector('.pdf-assistant .pdf-message-body').textContent, app.main.querySelector('.pdf-assistant .pdf-message-body').textContent);
  n10.checked = false;
  n10.dispatchEvent(new app.w.Event('change'));
  await waitFor(() => !n10.disabled);
  assert.equal(app.main.dataset.pageLayout, 'portrait');
  assert.equal(app.get('n10-layout-hint').hidden, true);
  assert.match(app.get('page-direction').textContent, /A4 portrait/);
});
