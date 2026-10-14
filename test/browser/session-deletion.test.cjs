const { openSessionList, openSessionContext } = require("../support/browser-navigation.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { saveState } = require("../../src/storage/run-state.cjs");

async function verifySessionDeletion(browser, origin, manager, directory, errors, output, archived = false) {
  const prefix = archived ? "archive-delete" : "delete";
  const repository = path.join(directory, `${prefix}-repository`);
  const tree = path.join(directory, `${prefix}-task`);
  const branch = "codex/browser-delete";
  const key = archived ? "1-97" : "1-99";
  const title = archived ? "已归档的强制清理演示会话" : "强制清理演示会话";
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { windowsHide: true, stdio: "ignore" });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "original");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  git("worktree", "add", "-b", branch, tree, "HEAD");
  fs.writeFileSync(path.join(tree, "tracked.txt"), "uncommitted");
  fs.writeFileSync(path.join(tree, "untracked.txt"), "untracked");
  (await saveState(path.join(manager.store.dir(key), "run.json"), {
    workitem: { id: key.slice(2), workspace_id: "1", title },
    source: { channel: "manual", scope: "1", id: key.slice(2) },
    agent: { provider: "codex" },
    session_id: "delete-fixture", execution: { status: "completed" },
    worktree: { repository, path: tree, branch },
  }));
  if (archived) await manager.archive(key);
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let releaseSnapshot, releaseDeletion;
  try {
    await page.goto(origin);
    if (archived) {
      await page.getByRole("button", { name: "已归档会话", exact: true }).click();
      await page.getByRole("button", { name: `永久删除会话：${title}`, exact: true }).click();
    } else {
      await openSessionList(page);
      await page.locator(".session-link").filter({ hasText: title }).click();
      await openSessionContext(page, '会话信息');
      await page.getByRole("button", { name: "永久删除会话", exact: true }).click();
    }
    const dialog = page.getByRole("dialog", { name: "永久删除会话", exact: true });
    assert.equal(await dialog.getByRole("button", { name: "永久删除", exact: true }).isDisabled(), true);
    await dialog.getByLabel("同时强制删除 Worktree、本地目录和本地分支", { exact: true }).check();
    const submit = dialog.getByRole("button", { name: "强制删除会话与代码", exact: true });
    await dialog.getByLabel("确认强制删除的本地分支", { exact: true }).fill("main");
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByLabel("确认强制删除的本地分支", { exact: true }).fill(branch);
    await dialog.getByLabel("我确认永久删除且无法恢复此会话。", { exact: true }).check();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await submit.scrollIntoViewIfNeeded();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `dialog overflow at ${width}`);
      assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
      await page.screenshot({ path: path.join(output, `${archived ? 'archived-' : ''}force-delete-${width}.png`), fullPage: true });
    }
    await page.route(`**/api/runs/${key}/delete`, (route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ error: "模拟清理失败，请重试。" }),
    }), { times: 1 });
    await submit.click();
    await dialog.getByText("模拟清理失败，请重试。", { exact: true }).waitFor();
    assert.equal(fs.existsSync(tree), true);
    assert.equal(await dialog.getByLabel("确认强制删除的本地分支", { exact: true }).inputValue(), branch);

    let snapshotReady;
    let captureNextSnapshot = true;
    const captured = new Promise((resolve) => { snapshotReady = resolve; });
    const hold = new Promise((resolve) => { releaseSnapshot = resolve; });
    await page.route(archived ? "**/api/runs?archived=true" : "**/api/runs", async (route) => {
      if (!captureNextSnapshot) return route.continue();
      captureNextSnapshot = false;
      const response = await route.fetch();
      snapshotReady();
      await hold;
      await route.fulfill({ response, headers: { ...response.headers(), "x-deletion-snapshot": "old" } });
    });
    let deletionReady;
    const deletedOnServer = new Promise((resolve) => { deletionReady = resolve; });
    const deletionHeld = new Promise((resolve) => { releaseDeletion = resolve; });
    await page.route(`**/api/runs/${key}/delete`, async (route) => {
      const response = await route.fetch();
      deletionReady();
      await deletionHeld;
      await route.fulfill({ response });
    });
    if (archived) manager.updateTitle(key, title);
    else manager.emit("event", { key, type: "state", status: "completed" });
    await captured;
    await submit.click();
    await deletedOnServer;
    if (archived) {
      assert.equal(await dialog.isVisible(), true, "list refresh must not unmount a pending deletion dialog");
      assert.equal(await dialog.locator('button[type="submit"]').isDisabled(), true);
    }
    releaseDeletion();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await manager.store.hasRun(key)), false);
    assert.equal(fs.existsSync(tree), false);
    const snapshotApplied = page.waitForResponse((response) => response.headers()["x-deletion-snapshot"] === "old");
    releaseSnapshot();
    await snapshotApplied;
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".session-link").filter({ hasText: title }).count(), 0);
    if (archived) {
      await page.getByText(`已永久删除「${title}」。`, { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: `恢复会话：${title}`, exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: `永久删除会话：${title}`, exact: true }).count(), 0);
    }
    assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "original");
  } finally {
    releaseSnapshot?.();
    releaseDeletion?.();
    await page.unrouteAll({ behavior: "wait" });
    await page.close();
  }
}

module.exports = { verifySessionDeletion };
