const { test } = require('node:test');
const assert = require('node:assert/strict');

test('UI localization preserves literal code, interpolates safely, and formats calendar dates in local time', async () => {
  const { i18n, translate, formatDate, formatNumber } = await import('../../web/src/shared/i18n/index.js');
  const original = i18n.global.locale.value;
  try {
    i18n.global.locale.value = 'en';
    assert.equal(translate('工作台'), 'Overview');
    assert.equal(translate('共 {count} 项', { count: 120 }), 'Items: 120');
    assert.equal(translate('负责人：{name}', { name: '<script>@{name}</script>' }), 'Owner: <script>@{name}</script>');
    assert.equal(translate('![说明](attachment:<ATTACHMENT_ID>)'), '![Description](attachment:<ATTACHMENT_ID>)');
    assert.equal(translate('任意用户内容 @ {{title}}'), '任意用户内容 @ {{title}}');
    assert.equal(formatDate('2026-10-14'), new Intl.DateTimeFormat('en', {year:'numeric',month:'short',day:'numeric'}).format(new Date(2026,9,14)));
    assert.equal(formatNumber(12345), '12,345');
    i18n.global.locale.value = 'zh-CN';
    assert.equal(translate('共 {count} 项', { count: 3 }), '共 3 项');
    assert.equal(translate('工作台'), '工作台');
  } finally { i18n.global.locale.value = original; }
});
