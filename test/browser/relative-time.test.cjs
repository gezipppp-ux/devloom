const { selectOption } = require("../support/select.cjs");
const assert = require('node:assert/strict');

async function verifyRelativeTime(page, origin, projectId) {
  await page.clock.install({ time: new Date('2026-10-14T08:05:00Z') });
  await page.clock.pauseAt(new Date('2026-10-14T08:05:00Z'));
  await page.goto(origin + '/projects');
  const cardTime = page.locator('.project-card-meta time').first();
  await cardTime.waitFor();
  assert.equal(await cardTime.textContent(), '5分钟前更新');
  assert.equal(await cardTime.getAttribute('datetime'), '2026-10-14T08:00:00.000Z');
  assert.match(await cardTime.getAttribute('title'), /2026/);
  assert.match(await cardTime.getAttribute('title'), /:00:00/);
  await page.clock.fastForward(60000);
  assert.equal(await cardTime.textContent(), '6分钟前更新', 'mounted timestamps refresh without navigation');
  await page.clock.resume();
  await selectOption(page.locator('.ui-locale'), 'en');
  assert.equal(await cardTime.textContent(), 'Updated 6 minutes ago');
  await page.goto(origin + `/projects/${projectId}`);
  const activityTime = page.locator('.ui-activity-list time').first();
  await activityTime.waitFor();
  assert.equal(await activityTime.textContent(), '6 minutes ago');
  assert.equal(await activityTime.getAttribute('datetime'), '2026-10-14T08:00:00.000Z');
  await selectOption(page.locator('.ui-locale'), 'zh-CN');
  assert.equal(await activityTime.textContent(), '6分钟前');
  await page.clock.resume();
}

module.exports = { verifyRelativeTime };
