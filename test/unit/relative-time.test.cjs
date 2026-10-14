const { test } = require('node:test');
const assert = require('node:assert/strict');

test('relative time uses local calendar boundaries, compact dates and the selected locale', async () => {
  const { i18n, formatDate } = await import('../../web/src/shared/i18n/index.js');
  const { formatRelativeTime } = await import('../../web/src/shared/i18n/relative-time.js');
  const original = i18n.global.locale.value;
  const now = new Date(2026, 9, 14, 18, 0, 0);
  const ago = seconds => new Date(now.getTime() - seconds * 1000).toISOString();
  try {
    i18n.global.locale.value = 'zh-CN';
    for (const [seconds, expected] of [[0, '刚刚'], [59, '刚刚'], [60, '1分钟前'], [300, '5分钟前'], [1800, '30分钟前'], [3599, '59分钟前'], [3600, '1小时前'], [21599, '5小时前'], [21600, '今天']]) {
      assert.equal(formatRelativeTime(ago(seconds), now), expected);
    }
    assert.equal(formatRelativeTime(new Date(2026, 9, 13, 23, 59), new Date(2026, 9, 14, 0, 1)), '昨天');
    assert.equal(formatRelativeTime(new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 1)), '昨天');
    assert.equal(formatRelativeTime(new Date(2026, 9, 12), now), '10月12日');
    assert.equal(formatRelativeTime(new Date(2025, 9, 12), now), '2025年10月12日');
    for (const value of [null, undefined, '', 'invalid']) assert.equal(formatRelativeTime(value, now), '时间未知');
    const future = new Date(now.getTime() + 3600000);
    assert.equal(formatRelativeTime(future, now), formatDate(future, { hour: '2-digit', minute: '2-digit', hour12: false }));
    i18n.global.locale.value = 'en';
    assert.equal(formatRelativeTime(ago(30), now), 'just now');
    assert.equal(formatRelativeTime(ago(300), now), '5 minutes ago');
    assert.equal(formatRelativeTime(ago(3600), now), '1 hour ago');
    assert.equal(formatRelativeTime(ago(21600), now), 'today');
    assert.equal(formatRelativeTime(new Date(2026, 9, 13), now), 'yesterday');
    assert.equal(formatRelativeTime(new Date(2026, 9, 12), now), 'Oct 12');
    assert.equal(formatRelativeTime(new Date(2025, 9, 12), now), 'Oct 12, 2025');
  } finally { i18n.global.locale.value = original; }
});
