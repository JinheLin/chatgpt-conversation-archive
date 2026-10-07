const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { catalogs, installI18n } = require('./helpers/i18n.cjs');
const project = path.resolve(__dirname, '..');

test('Simplified Chinese uses Chinese; English, Traditional Chinese and other locales use English', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'manifest.json')));
  assert.equal(manifest.default_locale, 'en');
  assert.deepEqual(fs.readdirSync(path.join(project, '_locales')).sort(), ['en', 'zh_CN']);
  for (const locale of ['zh-CN', 'zh_CN', 'en-US', 'en-GB', 'zh-TW', 'zh-HK', 'ja', 'fr', 'de']) {
    const context = vm.createContext({});
    installI18n(context, locale);
    const { t, language } = context.ChatGPTPdfI18n;
    const chinese = ['zh-CN', 'zh_CN'].includes(locale);
    assert.equal(language, chinese ? 'zh-CN' : 'en');
    assert.equal(t('readFull'), chinese ? '读取完整对话' : 'Read full conversation');
    assert.equal(t('questionLabel', 13), chinese ? '问题 13' : 'Question 13');
    assert.match(t('readVerified', 40, 13, t('readyOutput')), chinese ? /40 条消息，13 个问题/ : /40 messages, 13 questions/);
    const nodes = ['exportPageTitle', 'urlLabel', 'readFull', 'waitingInput'].map(key => ({
      getAttribute: () => key, textContent: ''
    }));
    const document = { documentElement: {}, querySelectorAll: () => nodes };
    context.ChatGPTPdfI18n.localizeDocument(document);
    assert.equal(document.documentElement.lang, language);
    assert.equal(nodes[2].textContent, t('readFull'));
    if (!chinese) for (const key of Object.keys(catalogs.en)) {
      assert.doesNotMatch(t(key, '40', '13', 'Ready'), /\p{Script=Han}/u, key);
    }
    // URL errors must use the same language, including malformed URL syntax.
    context.URL = URL;
    vm.runInContext(fs.readFileSync(path.join(project, 'conversation-source.js'), 'utf8'), context);
    assert.throws(() => context.ChatGPTPdfSource.parseUrl('not a URL'), { message: t('invalidUrl') });
    assert.throws(() => context.ChatGPTPdfSource.parseUrl('https://chatgpt.com/'), { message: t('homepageUrl') });
  }
});

test('catalogs cover every message used by scripts, the HTML page and the manifest with matching substitutions', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.zh_CN).sort());
  for (const [key, entry] of Object.entries(catalogs.en)) {
    assert.deepEqual(entry.placeholders || {}, catalogs.zh_CN[key].placeholders || {}, key);
    for (const catalog of Object.values(catalogs)) {
      assert.ok(catalog[key].message.length, key);
      for (const match of catalog[key].message.matchAll(/\$(\w+)\$/g)) {
        assert.ok(catalog[key].placeholders?.[match[1]], `${key}: ${match[1]}`);
      }
    }
  }
  const files = fs.readdirSync(project).filter(file => /\.(js|html)$/.test(file)).concat('manifest.json');
  for (const file of files) {
    const text = fs.readFileSync(path.join(project, file), 'utf8');
    for (const pattern of [/\bt\("([^"]+)"/g, /data-i18n="([^"]+)"/g, /__MSG_(\w+)__/g]) {
      for (const match of text.matchAll(pattern)) assert.ok(catalogs.en[match[1]], `${file}: ${match[1]}`);
    }
  }
});
