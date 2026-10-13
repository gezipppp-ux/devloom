/* global document, innerWidth */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyEnvironment(page, output) {
  let fail = true, checked = false, job = null, installs = 0, polls = 0, holdCheck, releaseCheck;
  const missingTools = new Set();
  let failInstall = false;
  const report = () => ({
    ready: !missingTools.size, runningNode: "v22.13.0", checkedAt: "2026-10-10T03:00:00Z", busy: job?.status === "running", job,
    checks: [{ name: "操作系统", status: "pass", detail: "win32 / x64" }, { name: "数据目录可写", status: "pass", detail: "数据库与上传目录" }],
    tools: ["codex", "npm", "git", "node"].map(id => ({ id, name: { codex: "Codex CLI", npm: "npm", git: "Git", node: "Node.js" }[id],
      requirement: id === "node" ? "22.13.0+；最新 LTS" : id === "codex" ? "已安装并完成登录" : id === "git" ? "支持 git worktree（2.5.0+）" : "可用的 npm 包管理器", version: missingTools.has(id) ? null : job?.status === "completed" && id === "codex" ? "2.0.0" : "1.0.0", status: missingTools.has(id) ? "fail" : "pass", detail: missingTools.has(id) ? "服务进程未找到该工具" : "满足基础要求",
      missing: missingTools.has(id), installAvailable: missingTools.has(id) && id !== "npm", installVersion: id === "git" ? "1.5.0" : checked ? "2.0.0" : null, installSource: id === "git" ? "Linux APT 软件源" : "npm 官方 registry",
      latest: checked ? "2.0.0" : null, latestStatus: !checked ? "unchecked" : id === "npm" ? "error" : missingTools.has(id) ? "installable" : job?.status === "completed" && id === "codex" ? "current" : "available",
      latestError: id === "npm" && checked ? "模拟 registry 暂时无法访问，请稍后重试。" : "", source: checked ? "官方来源" : "",
      updateAvailable: !missingTools.has(id), restartRequired: id === "node", pendingRestart: id === "node" && job?.status === "restart-required", updateDescription: "使用当前服务账号的安装器安装或更新。", updateReason: id === "npm" && missingTools.has(id) ? "npm 随 Node.js 提供，请使用当前 Node.js 的安装工具修复 npm后重新检测。" : "" })),
  });
  await page.route("**/api/system/environment**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    if (endpoint.endsWith("/check")) {
      if (holdCheck) { holdCheck(); await new Promise(resolve => { releaseCheck = resolve; }); }
      checked = true;
    }
    if (endpoint.endsWith("/update")) {
      if (request.method() === "POST") {
        assert.ok(["codex", "git", "node"].includes(request.postDataJSON().id));
        const input = request.postDataJSON();
        assert.equal(input.version, input.operation === "install" && input.id === "git" ? "1.5.0" : "2.0.0");
        installs++;
        job = { ...input, status: "running", message: "正在安装" };
        return route.fulfill({ json: job, status: 202 });
      }
      polls++;
      job = { ...job, status: failInstall ? "failed" : job.id === "node" ? "restart-required" : "completed", message: failInstall ? "模拟安装权限不足，请检查服务账号权限。" : job.operation === "install" && job.id === "codex" ? "安装完成，请在服务账号下完成 Codex 登录。" : "更新完成，建议空闲时重启服务。" };
      if (job.status === "completed") missingTools.delete(job.id);
      return route.fulfill({ json: { job, busy: false } });
    }
    if (fail) return route.fulfill({ status: 500, json: { error: "模拟环境检测失败" } });
    return route.fulfill({ json: report() });
  });
  assert.equal(await page.getByRole("navigation", { name: "账号导航" }).getByRole("button", { name: "环境检测", exact: true }).count(), 0);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("navigation", { name: "系统设置分类" }).getByRole("button", { name: "环境检测", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟环境检测失败" }).waitFor();
  fail = false;
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  await page.getByRole("heading", { name: "Codex CLI", exact: true }).waitFor();
  const update = page.getByRole("button", { name: "更新 Codex CLI", exact: true });
  assert.equal(await update.isDisabled(), true);
  const entered = new Promise(resolve => { holdCheck = resolve; });
  await page.getByRole("button", { name: "检查最新版本", exact: true }).click();
  await entered;
  assert.equal(await page.getByRole("button", { name: "检查版本中…", exact: true }).isDisabled(), true);
  releaseCheck();
  await page.getByText(/模拟 registry 暂时/).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `environment overflow at ${width}`);
    assert.equal(await page.locator('.account-bar nav button').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth + 1)), true, `navigation labels fit at ${width}`);
    await page.screenshot({ path: path.join(output, `environment-${width}.png`), fullPage: true });
  }
  assert.equal(await page.getByRole("button", { name: "更新指引" }).count(), 0);
  await page.getByRole("button", { name: "更新 Node.js", exact: true }).click();
  await page.getByRole("dialog").getByText(/Node.js 更新后需要重启/).waitFor();
  await page.screenshot({ path: path.join(output, "environment-node-update-320.png"), fullPage: true });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  await update.click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: path.join(output, "environment-update-320.png"), fullPage: true });
  await page.keyboard.press("Escape");
  assert.equal(await update.evaluate(element => element === document.activeElement), true);
  assert.equal(installs, 0);
  await update.click();
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "更新成功" }).waitFor();
  assert.equal(installs, 1);
  assert.ok(polls >= 1);
  await page.getByRole("button", { name: "更新 Git", exact: true }).click();
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Git → 2.0.0 · 更新成功" }).waitFor();
  await page.getByRole("button", { name: "更新 Node.js", exact: true }).click();
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await page.locator('.operation-message[data-type="warning"]').filter({ hasText: "Node.js → 2.0.0 · 已安装，待重启生效" }).waitFor();
  assert.equal(installs, 3);
  missingTools.add("codex"); missingTools.add("git"); missingTools.add("npm");
  job = null;
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  const installCodex = page.getByRole("button", { name: "自动安装 Codex CLI", exact: true });
  await installCodex.waitFor();
  assert.equal(await installCodex.isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "自动安装 npm", exact: true }).isDisabled(), true);
  while (await page.getByRole("button", { name: "关闭提示", exact: true }).count()) await page.getByRole("button", { name: "关闭提示", exact: true }).first().click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `environment install overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `environment-install-${width}.png`), fullPage: true });
  }
  await installCodex.click();
  await page.getByRole("dialog").getByText(/将在服务器安装 Codex CLI 2.0.0/).waitFor();
  await page.screenshot({ path: path.join(output, "environment-install-dialog-320.png"), fullPage: true });
  await page.keyboard.press("Escape");
  assert.equal(await installCodex.evaluate(element => element === document.activeElement), true);
  await installCodex.click();
  await page.getByRole("button", { name: "确认安装", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Codex CLI → 2.0.0 · 安装成功" }).waitFor();
  await page.getByText(/请在服务账号下完成 Codex 登录/).waitFor();
  await installCodex.waitFor({ state: "hidden" });
  failInstall = true;
  await page.getByRole("button", { name: "自动安装 Git", exact: true }).click();
  await page.getByRole("dialog").getByText(/Git 1.5.0（Linux APT 软件源）/).waitFor();
  await page.getByRole("button", { name: "确认安装", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Git → 1.5.0 · 安装失败" }).waitFor();
  failInstall = false;
  await page.getByRole("button", { name: "自动安装 Git", exact: true }).click();
  await page.getByRole("button", { name: "确认安装", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Git → 1.5.0 · 安装成功" }).waitFor();
  await page.getByRole("button", { name: "自动安装 Git", exact: true }).waitFor({ state: "hidden" });
  assert.equal(installs, 6);
  await page.goto(new URL("/environment", page.url()).href);
  await page.getByRole("heading", { name: "环境概况", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/system");
  assert.equal(new URL(page.url()).searchParams.get("tab"), "environment");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "个人设置", exact: true }).click();
}

module.exports = { verifyEnvironment };
