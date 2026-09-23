const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { saveState } = require("../../src/storage/run-state.cjs");

async function verifySessionDeletion(browser, origin, manager, directory, errors, output) {
  const repository = path.join(directory, "delete-repository");
  const tree = path.join(directory, "delete-task");
  const branch = "codex/browser-delete";
  const key = "1-99";
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { windowsHide: true, stdio: "ignore" });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "original");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  git("worktree", "add", "-b", branch, tree, "HEAD");
  fs.writeFileSync(path.join(tree, "tracked.txt"), "uncommitted");
  fs.writeFileSync(path.join(tree, "untracked.txt"), "untracked");
  saveState(path.join(manager.store.dir(key), "run.json"), {
    workitem: { id: "99", workspace_id: "1", title: "强制清理演示会话" },
    session_id: "delete-fixture", execution: { status: "completed" },
    worktree: { repository, path: tree, branch },
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let releaseSnapshot;
  try {
    await page.goto(origin);
    await page.locator(".session-link").filter({ hasText: "强制清理演示会话" }).click();
    await page.getByRole("button", { name: "永久删除会话", exact: true }).click();
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
      await page.screenshot({ path: path.join(output, `force-delete-${width}.png`), fullPage: true });
    }
    await page.route(`**/api/runs/${key}/delete`, (route) => route.fulfill({
      status: 400, contentType: "application/json", body: JSON.stringify({ error: "模拟清理失败，请重试。" }),
    }), { times: 1 });
    await submit.click();
    await dialog.getByText("模拟清理失败，请重试。", { exact: true }).waitFor();
    assert.equal(fs.existsSync(tree), true);
    assert.equal(await dialog.getByLabel("确认强制删除的本地分支", { exact: true }).inputValue(), branch);

    let snapshotReady;
    const captured = new Promise((resolve) => { snapshotReady = resolve; });
    const hold = new Promise((resolve) => { releaseSnapshot = resolve; });
    await page.route("**/api/runs", async (route) => {
      const response = await route.fetch();
      snapshotReady();
      await hold;
      await route.fulfill({ response });
    }, { times: 1 });
    manager.emit("event", { key, type: "state", status: "completed" });
    await captured;
    await submit.click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(manager.store.hasRun(key), false);
    assert.equal(fs.existsSync(tree), false);
    const snapshotApplied = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runs");
    releaseSnapshot();
    await snapshotApplied;
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".session-link").filter({ hasText: "强制清理演示会话" }).count(), 0);
    assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "original");
  } finally {
    releaseSnapshot?.();
    await page.close();
  }
}

module.exports = { verifySessionDeletion };
