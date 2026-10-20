/* global document, window, localStorage */
const assert = require('node:assert/strict');
const path = require('node:path');
const { sessionActivityItems } = require('../fixtures/session-activity.cjs');

async function verifySessionActivity(browser, origin, manager, key, errors, output) {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  let items = sessionActivityItems();
  let requests = [], nextCursor = null, readOnlyReason = '';
  await page.route('**/api/workbench/attention', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/runs', route => route.fulfill({ json: { runs: [{ key, title: '优化注册与找回密码流程', status: 'running' }] } }));
  await page.route(`**/api/runs/${key}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), title: '优化注册与找回密码流程', status: 'running', turnId: 'activity-turn', items, requests, nextCursor, readOnlyReason } });
  });
  const groups = page.locator('.session-activity');
  const groupSummary = () => groups.first().locator(':scope > summary');
  const opened = () => groups.first().evaluate(el => el.open);
  function publish(item) {
    const index = items.findIndex(entry => entry.id === item.id);
    if (index < 0) items.push(item); else items[index] = item;
    return manager.publish(manager.sessions.get(key), { type: 'item', item });
  }
  const shot = name => page.screenshot({ path: path.join(output, `activity-${name}.png`), fullPage: true });
  try {
    await page.goto(origin);
    await groupSummary().getByText('8 项活动').waitFor();
    assert.equal(await opened(), false);
    assert.equal(await page.locator('.working-line').count(), 0, 'active activity does not repeat the generic running notice');
    assert.equal(await page.locator('.tool-item').count(), 0, 'collapsed activity does not render verbose output');
    await groupSummary().focus(); await page.keyboard.press('Enter');
    await page.locator('.tool-item').first().waitFor();
    assert.equal(await opened(), true);
    const literal = page.locator('.tool-item').filter({ hasText: '读取表单组件与校验规则' });
    await literal.locator('summary').click();
    await literal.locator('pre').last().waitFor();
    assert.match(await literal.textContent(), /<script>window.activityXss = true<\/script>/);
    assert.equal(await page.evaluate(() => window.activityXss), undefined);
    assert.equal(await literal.locator('script, strong').count(), 0);
    await groupSummary().click(); await groupSummary().click();
    assert.equal(await literal.evaluate(el => el.open), true, 'nested expansion survives collapsing the group');
    const active = items.at(-1);
    await publish({ ...active, output: active.output + '\n流式检查更新' });
    await groupSummary().getByText('正在执行命令').waitFor();
    assert.equal(await opened(), true, 'SSE does not collapse the group');
    await publish({ id: 'activity-more', turnId: active.turnId, type: 'reasoning', status: 'inProgress', text: '检查新增提示' });
    await groupSummary().getByText('9 项活动').waitFor();
    assert.equal(await opened(), true, 'new members do not collapse the group');
    await groupSummary().click();
    await publish({ ...items.at(-1), status: 'completed' });
    await groupSummary().getByText('正在执行命令').waitFor();
    assert.equal(await opened(), false, 'stream updates do not reopen manually collapsed activity');
    await groupSummary().click();

    // Prepend an older page belonging to the same turn; retain both levels.
    nextCursor = 'older-activity';
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.route(`**/api/runs/${key}/history?*`, route => route.fulfill({ json: {
      items: [{ id: 'activity-earlier', turnId: active.turnId, type: 'webSearch', status: 'completed', text: '更早的过程记录' }, ...items], nextCursor: null,
    } }));
    await page.getByRole('button', { name: '加载更早记录 ↑', exact: true }).click();
    await groups.nth(1).waitFor();
    assert.equal(await groups.count(), 2, 'a message still separates earlier activity from the existing group');
    assert.equal(await groups.last().evaluate(el => el.open), true);
    assert.equal(await literal.evaluate(el => el.open), true);
    // Remove message boundaries in a separate reload to exercise a page joining
    // directly onto the current group, rather than inventing a new turn.
    items = sessionActivityItems().slice(2); nextCursor = 'join-group';
    await page.reload(); await groupSummary().click();
    await page.getByRole('button', { name: '加载更早记录 ↑', exact: true }).click();
    await groupSummary().getByText('9 项活动').waitFor();
    assert.equal(await groups.count(), 1);
    assert.equal(await opened(), true, 'prepending to the same group preserves expansion');

    const failed = { ...items.at(-1), status: 'completed', exitCode: 1, error: '验证码过期后的提示不匹配', output: 'Expected: 验证码已过期\nReceived: 请求失败' };
    await publish(failed);
    await page.locator('.session-tool.failed').getByText(failed.error, { exact: true }).waitFor();
    assert.equal(await page.locator('.session-activity .failed').count(), 0, 'failure remains outside collapsed activity');
    requests = [{ id: 'activity-approval', kind: 'approval', action: 'command', blocking: true, command: 'pnpm test', reason: '模拟审批保持可见' }];
    await manager.publish(manager.sessions.get(key), { type: 'requests', requests });
    await page.getByRole('button', { name: '允许本次操作', exact: true }).waitFor();
    await shot('failure-approval');

    items = sessionActivityItems(); requests = []; nextCursor = null;
    for (const locale of ['zh-CN', 'en']) {
      await page.evaluate(value => localStorage.setItem('web-coding.locale', value), locale);
      for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
        await page.setViewportSize({ width, height });
        await page.reload(); await groupSummary().waitFor();
        assert.equal(await opened(), false);
        await shot(`${locale}-${width}x${height}`);
        await groupSummary().click();
        await page.locator('.tool-item').last().locator('summary').click();
        await page.locator('.tool-item').last().locator('pre').first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector('.timeline').scrollWidth > document.querySelector('.timeline').clientWidth + 1), false);
        if (width < 768) {
          assert.ok(await page.locator('.timeline').evaluate(el => el.clientHeight >= 240), 'mobile history retains a usable reading area');
          await page.locator('.composer-wrap').scrollIntoViewIfNeeded();
          assert.ok(await page.locator('.composer-wrap').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.workspace > main').getBoundingClientRect().bottom + 1), 'composer remains reachable by scrolling');
          await page.locator('.workspace > main').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
        }
        await shot(`${locale}-${width}x${height}-expanded`);
      }
    }
    await page.setViewportSize({ width:1440, height:900 });
    await page.evaluate(() => { localStorage.setItem('web-coding.locale', 'zh-CN'); localStorage.setItem('web-coding.theme', 'dark'); });
    await page.reload(); await groupSummary().click();
    await page.locator('.tool-item').last().locator('summary').click();
    await page.locator('.tool-item').last().locator('pre').first().waitFor();
    await shot('dark-expanded');
    items = items.map(item => ({ ...item, status: 'completed' }));
    readOnlyReason = '归档会话只读';
    await page.reload(); await groupSummary().getByText('已完成', { exact: true }).waitFor();
    await groupSummary().click();
    await page.locator('.tool-item').first().waitFor();
    assert.equal(await opened(), true, 'read-only history still expands');
    process.stdout.write('Compact activity passed: grouping, streaming, history pagination, visible failure/approval, safe output, keyboard and responsive views.\n');
  } finally { await page.close(); }
}

module.exports = { verifySessionActivity };
