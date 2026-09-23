/* global document, window, KeyboardEvent */
const assert = require("node:assert/strict");
const path = require("node:path");
const { saveState } = require("../../src/storage/run-state.cjs");

async function verifySessionArchiveTitle(browser, origin, manager, errors, output) {
  const key = "1-98";
  const original = "【生产】套餐本月已用积分在完成AI生成任务后，没有实时刷新已用积分，需要人工手动刷新";
  const title = "【SIT】模型网关：点击切换自定义供应商时，保留配置与会话上下文，支持长名称完整展示。".repeat(3);
  saveState(path.join(manager.store.dir(key), "run.json"), {
    workitem: { id: "98", workspace_id: "1", title: original },
    session_id: "archive-fixture", execution: { status: "completed" },
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const peer = await browser.newPage();
  for (const tab of [page, peer]) tab.on("pageerror", (e) => errors.push(e.message));
  const trigger = page.getByRole("button", { name: "已归档会话", exact: true });
  const dialog = page.getByRole("dialog", { name: "已归档会话", exact: true });
  let releaseSnapshot;
  try {
    await page.addInitScript(() => {
      const fetch = window.fetch;
      window.archiveSnapshotApplied = false;
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (response.headers.get("x-archive-snapshot")) {
          const json = response.json.bind(response);
          response.json = async () => {
            const value = await json();
            window.setTimeout(() => { window.archiveSnapshotApplied = true; }, 0);
            return value;
          };
        }
        return response;
      };
    });
    await page.goto(origin);
    await page.locator(".session-link").filter({ hasText: original }).click();
    await page.getByRole("heading", { name: original, exact: true }).waitFor();
    assert.ok((await page.locator(".session-heading").boundingBox()).width > 300);
    await page.getByRole("button", { name: "修改会话标题", exact: true }).click();
    const input = page.getByLabel("会话标题", { exact: true });
    assert.equal(await input.evaluate((el) => el === document.activeElement), true);
    await input.fill(title);
    await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
    assert.equal(await input.isVisible(), true, "IME confirmation must not save");
    await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true })));
    assert.equal(await input.isVisible(), true, "IME cancellation must keep the title draft");
    assert.equal(manager.store.readSessionTitle(key, original), original);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await input.scrollIntoViewIfNeeded();
      const editor = await page.locator(".session-title-editor").boundingBox();
      const field = await input.boundingBox();
      assert.ok(field.width >= editor.width - 2, `title editor should use full width at ${width}`);
      const save = await page.getByRole("button", { name: "保存", exact: true }).boundingBox();
      const cancel = await page.getByRole("button", { name: "取消", exact: true }).boundingBox();
      assert.equal(save.y, cancel.y, `title actions stay on one row at ${width}`);
      assert.equal(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(output, `session-title-edit-${width}.png`), fullPage: true });
    }
    await page.route(`**/api/runs/${key}/title`, (route) => route.fulfill({ status: 400, json: { error: "模拟标题保存失败" } }), { times: 1 });
    await input.press("Enter");
    await page.getByText("模拟标题保存失败", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), title);
    await input.press("Enter");
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(".session-heading").scrollIntoViewIfNeeded();
      const heading = await page.locator(".session-heading").boundingBox();
      const toolbar = await page.locator(".session-toolbar").boundingBox();
      assert.ok(toolbar.y >= heading.y + heading.height, `toolbar stays below title at ${width}`);
      assert.equal(await page.locator(".session-heading").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await page.screenshot({ path: path.join(output, `session-title-display-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "会话信息", exact: true }).click();
    await page.getByRole("button", { name: "归档会话", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "归档会话", exact: true });
    await confirmation.getByLabel("我确认归档此会话。", { exact: true }).check();
    await confirmation.getByRole("button", { name: "归档会话", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(manager.store.isArchived(key), true);
    await page.reload();
    await peer.goto(origin);
    await page.route("**/api/runs?archived=true", (route) => route.fulfill({ status: 503, json: { error: "模拟归档加载失败" } }), { times: 1 });
    await trigger.click();
    await dialog.getByText("加载失败：模拟归档加载失败", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "重试", exact: true }).click();
    const recover = dialog.getByRole("button", { name: `恢复会话：${title}`, exact: true });
    await recover.waitFor();
    assert.equal(await page.locator(".session-link").filter({ hasText: title }).count(), 0);
    const search = dialog.getByLabel("搜索会话名称", { exact: true });
    await search.fill("没有这个名字");
    await dialog.getByText("没有匹配的已归档会话。", { exact: true }).waitFor();
    await search.fill("模型网关");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await recover.scrollIntoViewIfNeeded();
      assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      await page.screenshot({ path: path.join(output, `archived-sessions-${width}.png`), fullPage: true });
    }
    await page.route(`**/api/runs/${key}/restore`, (route) => route.fulfill({ status: 400, json: { error: "模拟恢复失败，请重试" } }), { times: 1 });
    await recover.click();
    await dialog.getByText("恢复失败：模拟恢复失败，请重试", { exact: true }).waitFor();
    assert.equal(manager.store.isArchived(key), true);
    await recover.click();
    await dialog.getByRole("status").filter({ hasText: "已恢复" }).waitFor();
    assert.equal(manager.store.isArchived(key), false);
    await peer.locator(".session-link").filter({ hasText: title }).waitFor();
    await search.fill("");
    await dialog.getByText("暂无已归档会话。", { exact: true }).waitFor();

    // A second tab restores while an older archive list response is in flight.
    await manager.archive(key);
    await recover.waitFor();
    await peer.getByRole("button", { name: "已归档会话", exact: true }).click();
    const peerRecover = peer.getByRole("button", { name: `恢复会话：${title}`, exact: true });
    await peerRecover.waitFor();

    let ready;
    const captured = new Promise((resolve) => { ready = resolve; });
    const hold = new Promise((resolve) => { releaseSnapshot = resolve; });
    await page.route("**/api/runs?archived=true", async (route) => {
      const response = await route.fetch();
      ready();
      await hold;
      await route.fulfill({ response, headers: { ...response.headers(), "x-archive-snapshot": "old" } });
    }, { times: 1 });
    await dialog.getByRole("button", { name: "刷新列表", exact: true }).click();
    await captured;
    await peerRecover.click();
    await dialog.getByText("暂无已归档会话。", { exact: true }).waitFor();
    releaseSnapshot();
    await page.waitForFunction(() => window.archiveSnapshotApplied);
    assert.equal(manager.store.isArchived(key), false);
    assert.equal(await recover.count(), 0);
    await peer.locator(".session-link").filter({ hasText: title }).waitFor();
    await search.fill("");
    await dialog.getByText("暂无已归档会话。", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
    await page.locator(".session-link").filter({ hasText: title }).click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal(manager.store.read(key).session_id, "archive-fixture");
    await manager.archive(key);
    await trigger.click();
    await search.fill("模型网关");
    const deleteButton = dialog.getByRole("button", { name: `永久删除会话：${title}`, exact: true });
    await deleteButton.click();
    const deletion = page.getByRole("dialog", { name: "永久删除会话", exact: true });
    await deletion.getByText(title, { exact: true }).waitFor();
    assert.equal(await deletion.getByRole("button", { name: "永久删除", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await deletion.waitFor({ state: "hidden" });
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await search.inputValue(), "模型网关");
    assert.equal(await deleteButton.evaluate((el) => el === document.activeElement), true);
    assert.equal(manager.store.hasRun(key), true);
    await deleteButton.click();
    await deletion.getByLabel("我确认永久删除且无法恢复此会话。", { exact: true }).check();
    await deletion.getByRole("button", { name: "永久删除", exact: true }).click();
    await deletion.waitFor({ state: "hidden" });
    await dialog.getByText(`已永久删除「${title}」。`, { exact: true }).waitFor();
    assert.equal(manager.store.hasRun(key), false);
    await peer.getByRole("button", { name: `恢复会话：${title}`, exact: true }).waitFor({ state: "hidden" });
  } finally {
    releaseSnapshot?.();
    await page.close();
    await peer.close();
  }
}

module.exports = { verifySessionArchiveTitle };
