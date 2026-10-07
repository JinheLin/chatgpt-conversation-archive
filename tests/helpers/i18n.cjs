const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '../..');
const catalogs = Object.fromEntries(['en', 'zh_CN'].map(locale => [locale,
  JSON.parse(fs.readFileSync(path.join(project, '_locales', locale, 'messages.json'), 'utf8'))]));

// Emulate Chrome's documented locale → language → default_locale lookup.
function chromeI18n(locale = 'en-US') {
  const preferred = locale.replace(/-/g, '_');
  const catalog = catalogs[preferred] || catalogs[preferred.split('_')[0]] || catalogs.en;
  return {
    getUILanguage: () => locale,
    getMessage(key, values = []) {
      const entry = catalog[key];
      if (!entry) return '';
      return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
        const content = entry.placeholders[name].content;
        return content.replace(/\$(\d)/g, (_, index) => values[Number(index) - 1] ?? '');
      });
    }
  };
}
function installI18n(context, locale = 'en-US') {
  context.chrome ||= {};
  context.chrome.i18n = chromeI18n(locale);
  vm.runInContext(fs.readFileSync(path.join(project, 'i18n.js'), 'utf8'), context);
}
module.exports = { catalogs, chromeI18n, installI18n };
