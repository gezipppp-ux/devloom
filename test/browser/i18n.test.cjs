const { selectOption, selectValue } = require("../support/select.cjs");
/* global document, localStorage, window */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

async function verifyI18n({ page, origin, writes }) {
  await page.goto(`${origin}/fixture?fixture=settings`);
  const before = writes.length;
  await page.getByLabel('项目名称', { exact: true }).fill('工作台 @ {count} — user content');
  await selectOption(page.getByLabel('界面语言'), 'en');
  assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), '工作台 @ {count} — user content');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await page.evaluate(() => localStorage.getItem('web-coding.locale')), 'en');
  await page.getByRole('button', { name: 'Save project settings' }).waitFor();
  await selectOption(page.getByLabel('Interface language'), 'zh-CN');
  assert.equal(await page.getByLabel('项目名称', { exact: true }).inputValue(), '工作台 @ {count} — user content');
  assert.equal(writes.length, before, 'switching language never saves a draft');
  await selectOption(page.getByLabel('界面语言'), 'en');
  await page.reload();
  await page.getByLabel('Interface language').waitFor();
  assert.equal(await selectValue(page.getByLabel('Interface language')), 'en');
  const output = path.resolve('state/browser/i18n'); fs.mkdirSync(output, {recursive:true});
  for (const [width,height] of [[2560,1440],[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1), `English form overflow at ${width}`);
    await page.screenshot({path:path.join(output,`settings-en-${width}.png`),fullPage:true});
  }
  await selectOption(page.getByLabel('Interface language'), 'zh-CN');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${origin}/fixture?fixture=issue`);
  await page.getByRole('button',{name:'编辑事项',exact:true}).click();
  const description=page.getByRole('group',{name:'描述编辑器',exact:true});
  await description.getByRole('button',{name:'Markdown源码',exact:true}).click();
  const draft='保留正文 @ {name}\n\n```js\nconst value = "原文";\n```';
  await description.getByRole('textbox',{name:'描述',exact:true}).fill(draft);
  const issueWrites=writes.length;
  await selectOption(page.getByLabel('界面语言'), 'en');
  assert.equal(await page.getByRole('textbox',{name:'Description',exact:true}).inputValue(),draft,'language switches preserve Markdown and editor mode');
  await selectOption(page.getByLabel('Interface language'), 'zh-CN');
  assert.equal(await page.getByRole('textbox',{name:'描述',exact:true}).inputValue(),draft);
  assert.equal(writes.length,issueWrites,'language changes never submit issue content');
  console.log('I18n browser checks passed: text and Markdown drafts, persisted language, no implicit writes, seven viewport sizes.');
}
module.exports = { verifyI18n };
