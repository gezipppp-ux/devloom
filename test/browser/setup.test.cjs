/* global document, window */
// Isolated PostgreSQL and simulated environment installer; never runs Git/Codex or TAPD.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { temporary } = require("../support/helpers.cjs");
const { initializeTestDatabase } = require("../support/database.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

const output = path.resolve("state/browser/setup");
const images = [];
async function fixture(t, { missing = false } = {}) {
  const directory = temporary(t), database = await initializeTestDatabase(t, directory, { withSetup: true });
  let installed = !missing, busy = false, job = null, batch = null, installs = 0;
  const environment = {
    read: async () => ({ busy, job, batch, checks: [{ name: "操作系统", status: "pass" }, { name: "数据目录可写", status: "pass" }], tools: ["git", "codex", "node", "npm"].map(id => ({
      id, name: { git: "Git", codex: "Codex CLI", node: "Node.js", npm: "npm" }[id], version: installed || !["git", "codex"].includes(id) ? "99.0.0" : null,
      missing: !installed && ["git", "codex"].includes(id), binaryReady: installed || !["git", "codex"].includes(id),
      status: id === "codex" ? "warning" : installed || id !== "git" ? "pass" : "fail", authentication: id === "codex" ? false : null,
      installAvailable: true, installVersion: "99.0.0", installSource: "模拟安装源", detail: "测试环境探针，不执行真实安装。",
    })) }),
    status: () => ({ busy, job, batch }), close: async () => {},
    installMissing: async (input, authorize) => {
      await authorize(); installs++;
      assert.deepEqual(input.tools.map(tool => tool.id), ["git", "codex"]);
      busy = true; job = { id: "git", status: "running" }; batch = { status: "running" };
      setTimeout(() => { installed = true; busy = false; job = { id: "codex", status: "completed" }; batch = { status: "completed" }; }, 50);
      return environment.status();
    },
  };
  environment.checkLatest = environment.read;
  const app = createWebServer({ database, dataDirectory: directory, environment });
  const origin = await app.listen(0);
  const browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Initialization must also work on LAN HTTP where randomUUID is unavailable.
  await context.addInitScript(() => { Object.defineProperty(window.crypto, "randomUUID", { value: undefined }); });
  t.after(async () => { await browser.close(); await app.close(); await database.close(); assert.deepEqual(errors, []); });
  fs.mkdirSync(output, { recursive: true });
  return { page, context, database, origin, directory, installs: () => installs };
}
async function capture(page, name) {
  for (const [width, height] of [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} overflows at ${width}`);
    images.push(`${name}-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function bootstrap(f) {
  const { page } = f;
  await page.goto(`${f.origin}/setup`);
  await page.getByLabel("设置密码", { exact: true }).waitFor();
  assert.equal(await page.locator('input:not([role="combobox"])').count(), 4);
  await capture(page, "administrator");
  await page.getByLabel("设置密码", { exact: true }).fill("fixture-password");
  await page.getByLabel("确认密码", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "创建管理员并继续", exact: true }).click();
  await page.getByRole("heading", { name: "运行环境", exact: true }).waitFor();
}
async function readyDirectory(f) {
  await f.page.getByRole("button", { name: "稍后登录，继续配置", exact: true }).click();
  await f.page.getByLabel("成员目录基础路径", { exact: true }).fill(path.join(f.directory, "members"));
  await f.page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await f.page.getByRole("button", { name: "创建默认部门并继续", exact: true }).waitFor();
}

test("initialization UI creates admin, installs missing tools, resumes drafts and completes team/project", async t => {
  const f = await fixture(t, { missing: true }), { page } = f;
  await bootstrap(f);
  await capture(page, "environment-missing");
  assert.equal(await page.getByRole("button", { name: "继续配置", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "安装缺失工具", exact: true }).click();
  await page.getByText("已安装，待认证", { exact: true }).waitFor();
  assert.equal(f.installs(), 1);
  await capture(page, "environment-ready");
  await page.getByRole("button", { name: "稍后登录，继续配置", exact: true }).click();
  await page.getByLabel("成员目录基础路径", { exact: true }).fill(path.join(f.directory, "members"));
  const preview = await page.locator(".setup-path-preview").textContent();
  assert.ok(preview.includes(["projects", "<仓库名>", "members", "<用户名>"].join(path.sep)));
  await capture(page, "directory");
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByRole("button", { name: "创建默认部门并继续", exact: true }).waitFor();
  await capture(page, "departments");
  const attempts = [];
  await page.route("**/api/system/setup/departments", async route => {
    attempts.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (attempts.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "创建默认部门并继续", exact: true }).click();
  await page.getByRole("button", { name: "重新加载进度（保留输入）", exact: true }).waitFor();
  await page.getByRole("button", { name: "创建默认部门并继续", exact: true }).click();
  await page.getByLabel("初始密码", { exact: true }).first().waitFor();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, attempts[1].requestId, "lost response retries the same operation");
  assert.equal(await f.database.client.department.count(), 2);
  await page.getByLabel("初始密码", { exact: true }).first().fill("unsaved-password");
  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await page.getByRole("heading", { name: "登录工作台", exact: true }).waitFor();
  const saved = await f.database.client.systemSetup.findUnique({ where: { id: "installation" } });
  assert.ok(!JSON.stringify(saved).includes("unsaved-password"));
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("初始密码", { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel("初始密码", { exact: true }).first().inputValue(), "");
  await capture(page, "accounts");
  await page.getByLabel("初始密码", { exact: true }).nth(0).fill("fixture-product");
  await page.getByLabel("初始密码", { exact: true }).nth(1).fill("fixture-developer");
  await page.getByRole("button", { name: "创建所选账号并继续", exact: true }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("初始化示例项目");
  await page.getByLabel("Git 仓库地址", { exact: true }).fill("https://git.example/team/repo.git");
  await capture(page, "project");
  await page.getByRole("button", { name: "创建项目并继续", exact: true }).click();
  await page.getByRole("button", { name: "完成并进入项目", exact: true }).waitFor();
  await capture(page, "complete");
  await page.getByRole("button", { name: "完成并进入项目", exact: true }).click();
  await page.waitForURL(/\/projects\//);
  assert.equal((await f.database.client.systemSetup.findUnique({ where: { id: "installation" } })).status, "completed");
  assert.equal(await f.database.client.user.count(), 3);
  assert.equal(await f.database.client.project.count(), 1);
  assert.equal(await f.database.client.workspace.count(), 0);
  fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>初始化实际实现截图</title><h1>模拟数据 · 实际 Vue 实现</h1>${images.map(name => `<p><a href="${name}">${name}</a></p><img src="${name}" style="max-width:100%">`).join("")}`);
});

test("initialization UI can skip optional accounts and project and revisit completed installation safely", async t => {
  const f = await fixture(t), { page } = f;
  await bootstrap(f);
  await readyDirectory(f);
  await page.getByRole("button", { name: "创建默认部门并继续", exact: true }).click();
  await page.getByRole("button", { name: "跳过测试账号", exact: true }).click();
  await page.getByRole("button", { name: "跳过项目创建", exact: true }).click();
  const finish = page.getByRole("button", { name: "完成并进入全部项目", exact: true });
  await finish.focus(); await page.keyboard.press("Enter");
  await page.waitForURL(f.origin + "/");
  assert.equal(await f.database.client.user.count(), 1);
  assert.equal(await f.database.client.project.count(), 0);
  await page.goto(f.origin + "/setup");
  await page.waitForURL(f.origin + "/");
});
