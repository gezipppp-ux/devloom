/* global document, window */
const assert = require('node:assert/strict');
const path = require('node:path');
const { openAccountMenu, accountAction } = require('../support/browser-navigation.cjs');
const { selectPreference } = require('../support/select.cjs');

async function verifyAccountMenu(page, output, user) {
  const menu = page.locator('.ui-account-menu');
  const trigger = page.locator('.ui-avatar');
  assert.equal(await page.locator('.ui-account-nav').getByRole('button', { name: /个人|退出/ }).count(), 0);
  assert.equal(await page.locator('.ui-topbar .ui-locale, .ui-topbar .ui-theme-select').count(), 0);
  await trigger.focus(); await trigger.press('ArrowDown');
  await menu.waitFor();
  assert.equal(await menu.locator('.account-personal').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await openAccountMenu(page);
  await page.getByRole('heading', { name: '工作台', exact: true }).click();
  assert.equal(await menu.isVisible(), false);
  await openAccountMenu(page);
  await page.locator('.ui-primary-nav').getByRole('button', { name: '项目', exact: true }).click();
  assert.equal(await menu.isVisible(), false, 'navigation closes the old account panel');
  await accountAction(page, '个人中心');
  await page.getByRole('heading', { name: '个人设置', exact: true }).waitFor();
  const draft = page.getByLabel('显示名称', { exact: true });
  await draft.fill('保留账号菜单后的未保存草稿');
  await selectPreference(page, 'locale', 'en');
  assert.equal(await page.getByLabel('Display name', { exact: true }).inputValue(), '保留账号菜单后的未保存草稿');
  await selectPreference(page, 'locale', 'zh-CN');
  assert.equal(await draft.inputValue(), '保留账号菜单后的未保存草稿');
  for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
    await draft.focus();
    await page.setViewportSize({width,height});
    assert.equal(await draft.evaluate(el => el === document.activeElement), true, 'a closed account menu must not steal form focus on resize');
    await openAccountMenu(page);
    const box = await menu.boundingBox(), button = await trigger.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1, `menu fits ${width}`);
    assert.ok(button.width >= 44 && button.height >= 44, 'avatar has a touch target');
    assert.equal(await menu.evaluate(el => el.matches(':modal')), width < 768);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({path: path.join(output, `account-menu-${width}.png`)});
    await menu.locator('.account-signout').focus();
    if (width < 768) {
      await page.keyboard.press('Tab');
      assert.equal(await menu.evaluate(el => el.contains(document.activeElement)), true, 'sheet traps focus');
    }
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  }
  const originalName = user.displayName;
  try {
    user.displayName = 'Alexandra Chen · 跨项目协作与开发负责人 / Platform Engineering';
    await page.reload();
    await selectPreference(page, 'locale', 'en');
    await openAccountMenu(page);
    assert.equal(await menu.locator('.account-menu-identity strong').innerText(), user.displayName);
    const nameBounds = await menu.locator('.account-menu-identity strong').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, whiteSpace: window.getComputedStyle(el).whiteSpace }));
    assert.ok(nameBounds.scrollWidth <= nameBounds.width + 1 && nameBounds.scrollHeight <= nameBounds.height + 1, `long display names remain fully readable: ${JSON.stringify(nameBounds)}`);
    assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({path: path.join(output, 'account-menu-long-en-320.png')});
    await page.keyboard.press('Escape');
    await selectPreference(page, 'locale', 'zh-CN');
  } finally { user.displayName = originalName; }
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
}
module.exports = { verifyAccountMenu };
