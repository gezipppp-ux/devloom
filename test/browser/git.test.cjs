const { selectOption } = require("../support/select.cjs");
const { openSessionContext } = require("../support/browser-navigation.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");

// All Git operations in this browser flow target disposable local repositories.
async function verifyGit(browser, { origin, output, errors, directory, workspaces }) {
  const fixture = path.join(directory, "git-browser");
  const repository = path.join(fixture, "repository");
  const remote = path.join(fixture, "remote.git");
  const peer = path.join(fixture, "remote-peer");
  fs.mkdirSync(repository, { recursive: true });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], {
    windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commit = (cwd, message) => {
    git(cwd, "add", ".");
    git(cwd, "-c", "user.name=Browser Fixture", "-c", "user.email=browser@example.invalid",
      "-c", "core.hooksPath=/dev/null", "commit", "-m", message);
  };
  git(repository, "init", "-b", "main");
  fs.writeFileSync(path.join(repository, "README.md"), "initial fixture\n");
  fs.writeFileSync(path.join(repository, ".gitignore"), "cache/\n");
  commit(repository, "initial fixture");
  git(fixture, "init", "--bare", "-b", "main", remote);
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-u", "origin", "main");
  git(fixture, "clone", remote, peer);
  fs.writeFileSync(path.join(peer, "remote-change.txt"), "latest remote code\n");
  commit(peer, "remote fixture change");
  git(peer, "push", "origin", "main");
  const beforeFetch = git(repository, "rev-parse", "HEAD");
  const remoteHead = git(peer, "rev-parse", "HEAD");
  const workspace = (await workspaces.save({ name: "Git 操作回归" }));
  (await seedWorkspaceProject(workspaces.configFile(workspace.id), repository, "git-browser"));
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const api = `${origin}/api/workspaces/${workspace.id}`;
  const gitPanel = page.locator(".session-git");
  const dialog = page.getByRole("dialog", { name: "删除 Worktree", exact: true });
  const deleteButton = () => dialog.getByRole("button", { name: "删除文件与本地分支", exact: true });
  const openRepository = () => page.getByRole("button", { name: "代码仓库", exact: true }).click();
  const refreshGit = async () => {
    if (!(await gitPanel.isVisible()))
      await openSessionContext(page, 'Worktree Git');
    await page.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
  };
  const capture = async (name) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${name}: document stays within viewport`);
    assert.ok(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      `${name}: main content stays within viewport`);
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: !(await dialog.count()) });
  };
  try {
    const bootstrap = await (await page.request.get(`${origin}/api/bootstrap`)).json();
    const headers = { origin, "x-csrf-token": bootstrap.token };
    const settings = await page.request.post(`${api}/settings`, {
      headers, data: { baseBranch: "main", initCommands: [] },
    });
    assert.equal(settings.status(), 200);
    await page.goto(`${origin}/?workspace=${workspace.id}`);
    await openRepository();
    await page.getByRole("button", { name: "获取远端更新", exact: true }).waitFor();
    await page.getByRole("button", { name: "获取远端更新", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /远端.*更新|获取/ }).waitFor();
    assert.equal(git(repository, "rev-parse", "origin/main"), remoteHead);
    assert.equal(git(repository, "rev-parse", "HEAD"), beforeFetch, "fetch never changes the checkout");
    const updated = page.waitForResponse((response) => response.url() === `${api}/repository/git/update`
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "更新基准分支", exact: true }).click();
    const updateResponse = await updated;
    assert.equal(updateResponse.status(), 200, await updateResponse.text());
    await page.getByRole("status").filter({ hasText: /基准/ }).waitFor();
    assert.equal(git(repository, "rev-parse", "HEAD"), remoteHead, "base branch advances to fetched remote");
    await capture("git-repository-desktop");
    await page.route(`**/api/workspaces/${workspace.id}/repository/git/fetch`, (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟远端暂时无法连接" }),
    }), { times: 1 });
    await page.getByRole("button", { name: "获取远端更新", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "模拟远端暂时无法连接" }).waitFor();
    assert.equal(git(repository, "rev-parse", "HEAD"), remoteHead);
    fs.writeFileSync(path.join(repository, "local-main.txt"), "local branch divergence\n");
    commit(repository, "local main divergence");
    const divergedHead = git(repository, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(peer, "remote-next.txt"), "remote branch divergence\n");
    commit(peer, "remote main divergence");
    git(peer, "push", "origin", "main");
    await page.getByRole("button", { name: "刷新仓库状态", exact: true }).click();
    await page.getByRole("button", { name: "更新基准分支", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /无法快进|分叉/ }).waitFor();
    assert.equal(git(repository, "rev-parse", "HEAD"), divergedHead, "divergence never creates a merge commit");
    assert.equal(fs.existsSync(path.join(repository, ".git", "MERGE_HEAD")), false);
    await capture("git-repository-diverged");

    await page.getByRole("button", { name: "独立开发", exact: true }).click();
    await selectOption(page.getByLabel("需求渠道", { exact: true }), "manual");
    await page.getByLabel("需求标题", { exact: true }).fill("可删除的 Git 测试任务");
    await page.getByLabel("需求内容", { exact: true }).fill("仅使用 FakeClient 验证 Git 管理，不执行真实需求。");
    await page.getByRole("button", { name: "创建 session 并开始开发 →", exact: true }).click();
    await page.getByText("历史回复", { exact: true }).waitFor();
    await openSessionContext(page, 'Worktree Git');
    await gitPanel.getByText("分支尚未发布", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "删除 Worktree…", exact: true }).isDisabled(), true,
      "active Codex turns cannot delete their worktree");
    await page.getByRole("button", { name: "收起会话资料", exact: true }).click();
    await page.getByRole("button", { name: "■ 停止", exact: true }).click();
    const context = (await workspaces.get(workspace.id));
    const record = (await context.sessions.list())[0];
    const key = record.key;
    const detail = await (await page.request.get(`${api}/runs/${key}`)).json();
    const { path: tree, branch } = detail.worktree;
    const originalSession = detail.sessionId;
    await refreshGit();
    await page.getByRole("button", { name: "删除 Worktree…", exact: true }).waitFor({ state: "visible" });
    git(tree, "checkout", "-b", "follow-up-branch");
    const switched = await (await page.request.get(`${api}/runs/${key}`)).json();
    assert.ok(!switched.readOnlyReason, JSON.stringify(switched));
    await refreshGit();
    await gitPanel.getByText("follow-up-branch", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).isDisabled(),
      true,
      "switching branches keeps destructive cleanup bound to the recorded task branch",
    );
    git(tree, "checkout", branch);
    await refreshGit();
    await gitPanel.getByText(branch, { exact: true }).waitFor();
    git(tree, "push", "-u", "origin", branch);
    fs.writeFileSync(path.join(tree, "task-change.txt"), "unpublished task commit\n");
    commit(tree, "local task commit");
    const pushedStatus = await (await page.request.get(`${api}/runs/${key}/git`)).json();
    assert.equal(pushedStatus.ahead, 1, JSON.stringify(pushedStatus));
    await refreshGit();
    await gitPanel.getByText(/待推送\s*1/).waitFor();
    fs.appendFileSync(path.join(tree, "README.md"), "uncommitted content\n");
    fs.writeFileSync(path.join(tree, "untracked.txt"), "untracked content\n");
    fs.mkdirSync(path.join(tree, "cache"));
    fs.writeFileSync(path.join(tree, "cache", "ignored.txt"), "ignored content\n");
    await refreshGit();
    await gitPanel.getByText(/未提交\s*2/).waitFor();
    await capture("git-worktree-status-desktop");
    await page.getByRole("button", { name: "删除 Worktree…", exact: true }).click();
    await dialog.waitFor();
    assert.equal(
      await dialog.getByText(`请准确输入：${branch}`, { exact: true }).count(),
      1,
      "delete confirmation shows the required complete branch name",
    );
    assert.equal(
      await dialog.getByRole("textbox", { name: "确认删除的本地分支", exact: true }).getAttribute("placeholder"),
      branch,
      "delete confirmation input repeats the required branch name",
    );
    const riskConfirmation = dialog.locator(".git-risk-confirm");
    assert.equal(
      await riskConfirmation.evaluate((element) => window.getComputedStyle(element).display),
      "grid",
      "risk acknowledgement keeps its checkbox and text in an aligned two-column layout",
    );
    const checkbox = await riskConfirmation.getByRole("checkbox").boundingBox();
    const acknowledgement = await riskConfirmation.locator("span").boundingBox();
    assert.ok(
      acknowledgement.x - (checkbox.x + checkbox.width) >= 12,
      "risk acknowledgement leaves a readable gap after its checkbox",
    );
    assert.equal(await deleteButton().isDisabled(), true);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.ok(fs.existsSync(tree), "cancel keeps files");
    assert.equal(git(repository, "rev-parse", `refs/heads/${branch}`), git(tree, "rev-parse", "HEAD"));

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await gitPanel.scrollIntoViewIfNeeded();
      await capture(`git-worktree-status-${width}`);
      await page.getByRole("button", { name: "删除 Worktree…", exact: true }).click();
      await dialog.waitFor();
      await deleteButton().scrollIntoViewIfNeeded();
      const bounds = await deleteButton().boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 845,
        `${width}: delete action remains reachable`);
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
      await capture(`git-delete-dialog-${width}`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole("button", { name: "删除 Worktree…", exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole("textbox").fill("wrong-branch");
    assert.equal(await deleteButton().isDisabled(), true, "branch identity requires exact confirmation");
    await dialog.getByRole("textbox").fill(branch);
    assert.equal(await deleteButton().isDisabled(), true, "dirty and unpublished content requires explicit acknowledgement");
    await dialog.getByRole("checkbox").check();
    assert.equal(await deleteButton().isDisabled(), false);
    await capture("git-delete-dialog-desktop");
    fs.appendFileSync(path.join(tree, "untracked.txt"), "changed after confirmation snapshot\n");
    const rejected = page.waitForResponse((response) => response.url() === `${api}/runs/${key}/worktree/delete`
      && response.request().method() === "POST");
    await deleteButton().click();
    assert.equal((await rejected).status(), 400);
    await page.locator('.operation-message[data-type="error"]').filter({ hasText: /状态已变化/ }).waitFor();
    assert.ok(fs.existsSync(tree), "stale confirmation never removes files");
    await dialog.getByRole("button", { name: "重新检查删除条件", exact: true }).click();
    await dialog.getByRole("textbox").fill(branch);
    assert.equal(await deleteButton().isDisabled(), true, "retry requires a fresh acknowledgement");
    await dialog.getByRole("checkbox").check();
    const deleted = page.waitForResponse((response) => response.url() === `${api}/runs/${key}/worktree/delete`
      && response.request().method() === "POST");
    await deleteButton().click();
    assert.equal((await deleted).status(), 200);
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("发送给 Codex 的指令", { exact: true }).isDisabled(), true);
    assert.equal(fs.existsSync(tree), false, "delete removes worktree files including ignored content");
    assert.equal(git(repository, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`), "",
      "delete removes the local task branch");
    assert.ok(git(repository, "ls-remote", "origin", `refs/heads/${branch}`), "remote branch remains intact");
    const after = await (await page.request.get(`${api}/runs/${key}`)).json();
    assert.equal(after.sessionId, originalSession, "deletion preserves session identity");
    assert.ok(after.readOnlyReason, "deleted sessions remain readable");
    await page.reload();
    await page.getByText("历史回复", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("发送给 Codex 的指令", { exact: true }).isDisabled(), true);
    await capture("git-worktree-deleted");
    assert.equal(await page.getByRole("button", { name: /合并|解决冲突/ }).count(), 0,
      "merging and conflict resolution stay in Codex conversation");
  } catch (error) {
    await page.screenshot({ path: path.join(output, "git-failure.png"), fullPage: true });
    error.message += `\nGit browser page at failure:\n${await page.locator("main").innerText()}`;
    throw error;
  } finally {
    await page.close();
  }
}

module.exports = { verifyGit };
