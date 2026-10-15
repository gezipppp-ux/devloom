/* global document, navigator, window */
const assert = require("node:assert/strict");
const { dismissOperationMessages } = require("../support/operation-feedback.cjs");
const path = require("node:path");
const scopes = require("../../shared/mcp-scopes.json");

async function verifyMcpTokens(page, output) {
  const tokens = [], writes = [];
  const tokenId = "00000000-0000-4000-8000-000000000001";
  const secret = "wc_mcp_fixture_once_only";
  let fail = true, hold, resume;
  await page.route("**/api/account/mcp-tokens**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ json: { tokens, scopes, projects: [{ id: tokenId, name: "测试项目" }] } });
    if (endpoint.endsWith("/revoke")) {
      tokens[0].revokedAt = new Date().toISOString(); tokens[0].status = "revoked";
      return route.fulfill({ json: { ok: true } });
    }
    const input = request.postDataJSON();
    writes.push(input);
    if (hold) { const started = hold; hold = null; await new Promise(resolve => { resume = resolve; started(); }); }
    if (fail) return route.fulfill({ status: 400, json: { error: "模拟 Token 创建失败" } });
    const token = { ...input, id: tokenId, prefix: "wc_mcp_fixture", status: "active", expiresAt: "2027-01-01T00:00:00Z", lastUsedAt: null };
    tokens.push(token, { ...token, id: "fixture-second", name: "开发电脑 · Claude Code" }, { ...token, id: "fixture-third", name: "临时调试设备与自动化访问凭证的长名称展示", status: "expired" });
    return route.fulfill({ status: 201, json: { token, secret } });
  });
  await page.getByRole("navigation", { name: "个人设置", exact: true }).getByRole("button", { name: "MCP 接入", exact: true }).click();
  const section = page.locator(".mcp-settings");
  const access = page.locator(".mcp-access");
  await section.getByText("尚未创建 Token", { exact: true }).waitFor();
  assert.equal(await section.getByLabel("Token 名称").count(), 0, "Creation must not crowd the overview");
  assert.equal(await section.getByLabel("MCP 地址", { exact: true }).inputValue(), new URL("/mcp", page.url()).href);
  assert.equal(await section.getByRole("link", { name: "打开 Skills 指南", exact: true }).getAttribute("href"), new URL("/skills", page.url()).href);
  await page.evaluate(() => {
    window.fixtureClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  await section.getByRole("button", { name: "复制 MCP 地址", exact: true }).click();
  await page.locator('.operation-message[data-type="success"]').getByText("已复制。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureClipboard.readText()), new URL("/mcp", page.url()).href);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: window.fixtureClipboard });
    delete window.fixtureClipboard;
  });
  await section.getByRole("button", { name: "连接 Agent 与使用指南", exact: true }).click();
  await section.getByRole("button", { name: "Claude Code", exact: true }).click();
  assert.match(await section.locator(".mcp-code").first().innerText(), /mcpServers/);
  await section.getByRole("button", { name: "Pi", exact: true }).click();
  await section.getByText("在 Pi 使用的 MCP 扩展中配置以上连接参数", { exact: false }).waitFor();
  await section.getByRole("button", { name: "Codex", exact: true }).click();
  await section.getByRole("button", { name: "返回 MCP 接入", exact: true }).click();
  await access.getByRole("button", { name: "创建 Token", exact: true }).click();
  await section.getByRole("radio", { name: "指定项目", exact: true }).check();
  await section.getByLabel("Token 名称").fill("工作电脑 CLI");
  assert.equal(await section.getByRole("button", { name: "创建 MCP Token", exact: true }).isDisabled(), true);
  await section.getByRole("checkbox", { name: "测试项目", exact: true }).check();
  assert.equal(await section.getByText("需要为需求添加附件？", { exact: true }).count(), 0);
  assert.equal(await section.getByRole("region", { name: "HTTP 上传说明" }).count(), 0);
  await section.getByRole("button", { name: "创建 MCP Token", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟 Token 创建失败" }).waitFor();
  assert.equal(await section.getByLabel("Token 名称").inputValue(), "工作电脑 CLI");
  assert.equal(tokens.length, 0);
  await dismissOperationMessages(page);
  fail = false;
  const blocked = new Promise(resolve => { hold = resolve; });
  await section.getByRole("button", { name: "创建 MCP Token", exact: true }).click();
  await blocked;
  assert.equal(await section.getByLabel("Token 名称").isDisabled(), true);
  assert.equal(await access.getByRole("button", { name: "收起 MCP 接入" }).isDisabled(), true);
  assert.equal(await section.getByRole("button", { name: "返回 MCP 接入" }).isDisabled(), true);
  resume();
  await section.getByLabel("新建 Token", { exact: true }).waitFor();
  assert.equal(await section.getByLabel("新建 Token", { exact: true }).inputValue(), secret);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].scopes.includes("files.upload"), true);
  assert.equal(writes[1].allProjects, false);
  assert.deepEqual(writes[1].projectIds, [tokenId]);
  await section.getByRole("button", { name: "复制全部，发送给 Agent", exact: true }).click();
  await section.getByRole("button", { name: "已复制，粘贴给 Agent", exact: true }).waitFor();
  const setupPrompt = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(setupPrompt.includes(secret));
  assert.ok(setupPrompt.includes(tokens[0].expiresAt), "Expiry comes from the created token, not the requested duration");
  assert.ok(setupPrompt.includes(new URL("/skills/web-coding-issue-authoring/manifest.json", page.url()).href));
  assert.ok(setupPrompt.includes(new URL("/mcp", page.url()).href));
  await section.getByText("查看完整配置提示词", { exact: true }).click();
  assert.equal(await section.getByLabel("完整配置提示词", { exact: true }).inputValue(), setupPrompt);
  await section.getByRole("button", { name: "已保存，返回列表", exact: true }).click();
  assert.equal(await section.getByLabel("新建 Token", { exact: true }).count(), 0);
  assert.equal(await section.getByLabel("完整配置提示词", { exact: true }).count(), 0);
  assert.equal(await section.locator(".mcp-token").count(), 2);
  await section.getByRole("button", { name: "查看全部", exact: true }).click();
  assert.equal(await section.locator(".mcp-token").count(), 3);
  await section.getByRole("button", { name: "连接 Agent 与使用指南", exact: true }).click();
  await section.getByRole("button", { name: "查看用法", exact: true }).click();
  const help = section.getByRole("region", { name: "HTTP 上传说明" });
  assert.match(await help.innerText(), /attachmentIds/);
  assert.match(await help.innerText(), /Idempotency-Key/);
  assert.match(await help.innerText(), /create_upload_token/);
  assert.match(await help.innerText(), /WEB_CODING_UPLOAD_TOKEN/);
  assert.doesNotMatch(await help.innerText(), /Bearer \$(?:env:)?WEB_CODING_TOKEN/);
  assert.equal((await help.innerText()).includes(secret), false);
  await help.getByRole("button", { name: "PowerShell", exact: true }).click();
  assert.match(await help.innerText(), /Invoke-RestMethod/);
  const closeMessages = page.getByRole("button", { name: "关闭提示", exact: true });
  while (await closeMessages.count()) await closeMessages.first().click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await section.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "MCP examples must scroll within their code blocks");
    await access.screenshot({ path: path.join(output, "mcp-upload-" + width + ".png") });
  }
  await section.getByRole("button", { name: "返回 MCP 接入", exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await access.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await access.screenshot({ path: path.join(output, "mcp-" + width + ".png") });
  }
  await section.locator(".mcp-token > summary").first().click();
  await section.getByRole("button", { name: "撤销 工作电脑 CLI", exact: true }).click();
  await page.getByRole("dialog", { name: "撤销 MCP Token" }).waitFor();
  await page.screenshot({ path: path.join(output, "mcp-revoke-320.png") });
  await page.keyboard.press("Escape");
  assert.equal(await section.getByRole("button", { name: "撤销 工作电脑 CLI", exact: true }).evaluate(element => element === document.activeElement), true);
  await section.getByRole("button", { name: "撤销 工作电脑 CLI", exact: true }).click();
  await page.getByRole("button", { name: "确认撤销", exact: true }).click();
  await section.locator(".mcp-token").first().getByText("已撤销", { exact: true }).waitFor();
  await access.getByRole("button", { name: "收起 MCP 接入", exact: true }).click();
  await page.getByRole("button", { name: "管理 MCP Token", exact: true }).click();
  assert.equal(await section.getByLabel("新建 Token", { exact: true }).count(), 0);
  await access.getByRole("button", { name: "创建 Token", exact: true }).click();
  await section.getByLabel("Token 名称").fill("窄屏创建表单");
  while (await closeMessages.count()) await closeMessages.first().click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await access.screenshot({ path: path.join(output, "mcp-create-" + width + ".png") });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const radioSize = await section.getByRole("radio", { name: "指定项目", exact: true }).boundingBox();
    assert.ok(radioSize.width <= 24 && radioSize.height <= 24, "Project radios must not inherit text-input sizing");
  }
  await access.getByRole("button", { name: "收起 MCP 接入", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
module.exports = { verifyMcpTokens };
