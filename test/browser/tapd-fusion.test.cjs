/* global document */
const assert = require("node:assert/strict");
const path = require("node:path");
const { createWebServer } = require("../../src/http/server.cjs");
const { fusionFixture, waitForTurn, finishTurn } = require("../support/tapd-fusion.cjs");

async function verifyTapdFusion(browser, errors, output) {
  const cleanup = [];
  const fixture = await fusionFixture({ after: fn => cleanup.push(fn) });
  const { manager, client, configFile } = fixture;
  const application = createWebServer({ manager, configFile, testIdentity: true });
  const origin = await application.listen(0);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  async function capture(name) {
    const issues = await page.locator("body, main, .form-section, .session-drawer-content, .tapd-picker").evaluateAll(elements =>
      elements.filter(element => element.clientWidth && element.scrollWidth > element.clientWidth + 2).map(element => element.className));
    assert.deepEqual(issues, [], `${name}: no horizontal overflow`);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  try {
    await page.goto(origin);
    await page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
    await page.getByLabel("多条需求融合", { exact: true }).check();
    await page.getByLabel("融合任务标题", { exact: true }).fill("登录问题融合修复");
    const picker = page.locator(".tapd-picker");
    async function select(id) {
      await picker.getByPlaceholder("输入需求标题关键词").fill(id);
      await picker.getByRole("button", { name: "检索", exact: true }).click();
      await picker.getByRole("button", { name: new RegExp(`测试需求 ${id} #${id} · 添加`) }).click();
    }
    await select("11");
    await select("12");
    assert.equal(await picker.locator(".tapd-selection li").count(), 2, "selection survives another search");
    assert.equal(await page.getByLabel("需求关系", { exact: true }).count(), 0);
    assert.equal(await picker.getByLabel("TAPD 条目类型").count(), 0);
    assert.doesNotMatch(await picker.locator(".tapd-selection").innerText(), /缺陷|看板卡片/);
    await picker.getByRole("button", { name: "上移需求 12", exact: true }).click();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await picker.scrollIntoViewIfNeeded();
      await capture(`fusion-start-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "创建 session 并开始开发 →", exact: true }).click();
    await page.locator(".session-header").getByText("登录问题融合修复", { exact: true }).waitFor();
    const key = (await manager.list())[0].key;
    await waitForTurn(manager, key);
    assert.deepEqual((await manager.store.readTask(key)).requirements.map(entry => entry.workitem.id), ["12", "11"]);
    await finishTurn(manager, client, key);
    await page.getByRole("button", { name: "需求资料", exact: true }).click();
    await page.getByRole("button", { name: "追加 TAPD 需求", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector(".append-requirements button")?.disabled);
    await page.getByRole("button", { name: "追加 TAPD 需求", exact: true }).click();
    const append = page.locator(".append-requirements");
    assert.equal(await append.getByLabel("需求关系", { exact: true }).count(), 0);
    assert.equal(await append.getByLabel("TAPD 条目类型").count(), 0);
    await append.getByLabel("添加需求 ID", { exact: true }).fill("13");
    await append.getByRole("button", { name: "添加", exact: true }).click();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await append.scrollIntoViewIfNeeded();
      await capture(`fusion-append-${width}`);
    }
    const count = client.calls.filter(call => call.method === "turn/start").length;
    await append.getByRole("button", { name: "保存追加资料", exact: true }).click();
    await page.getByRole("button", { name: "继续处理新增需求", exact: true }).waitFor();
    assert.equal((await manager.store.requirements.read(key)).additions[0].task.requirements[0].workitem.type, "board_card");
    assert.equal(client.calls.filter(call => call.method === "turn/start").length, count);
    await page.reload();
    await page.getByRole("button", { name: "需求资料", exact: true }).click();
    const proceed = page.getByRole("button", { name: "继续处理新增需求", exact: true });
    await proceed.waitFor();
    await proceed.click();
    await page.getByText("追加资料 1 · 已发送", { exact: true }).waitFor();
    assert.equal(client.calls.filter(call => call.method === "thread/start").length, 1);
    assert.equal(client.calls.filter(call => call.method === "turn/start").length, count + 1);
    await finishTurn(manager, client, key);
    await capture("fusion-requirements-320");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "追加 TAPD 需求", exact: true }).click();
    await append.getByRole("button", { name: "检索", exact: true }).click();
    await append.getByRole("button", { name: /测试需求 11 .*已有任务/ }).waitFor();
    assert.equal(await append.getByRole("button", { name: /测试需求 11 .*添加/ }).count(), 0);
    await page.getByRole("button", { name: "收起会话资料", exact: true }).click();
  } finally {
    await page.close();
    await application.close();
    for (const fn of cleanup.reverse()) await fn();
  }
}

module.exports = { verifyTapdFusion };
