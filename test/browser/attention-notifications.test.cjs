/* global window */
const assert = require("node:assert/strict");
const { projectVisual } = require("../fixtures/project-visual.cjs");
const { agentDescriptor } = require("../fixtures/agent-descriptor.cjs");

async function verifyAttentionNotifications(browser, origin) {
  const context = await browser.newContext();
  const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "通知测试空间" };
  const project = projectVisual(workspace.id), errors = [];
  const user = { id: "visual-admin", username: "visual-admin", displayName: "演示管理员", role: "admin", status: "active", mustChangePassword: false };
  let items = [{ id: "initial", kind: "approval", projectId: project.projectId, projectName: "客户管理系统", workspaceId: workspace.id, runKey: "manual-attention", title: "初始执行审批" }], fail = false;
  const settings = { notificationsEnabled: true, model: null, reasoningEffort: null, permissionMode: "ask", grouping: "type" };
  await context.addInitScript(() => {
    window.attentionFixture = { notifications: [] };
    window.Notification = class {
      static permission = "granted";
      constructor(title, options) { window.attentionFixture.notifications.push({ title, ...options }); }
    };
    window.EventSource = class { constructor() { window.queueMicrotask(() => this.onopen?.()); } addEventListener() {} close() {} };
    const interval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => interval(callback, delay === 30000 ? 100 : delay, ...args);
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const send = value => route.fulfill({ json: value });
    if (endpoint === "/api/auth/session") return send({ user, token: "fixture-token", settings });
    if (endpoint === "/api/bootstrap") return send({ token: "fixture-token", workspaces: [{ ...workspace, projectId: project.projectId, permissions: project.permissions }] });
    if (endpoint === "/api/workbench/attention") return fail ? route.fulfill({ status: 503, json: { error: "模拟读取失败" } }) : send({ items, total: items.length });
    if (endpoint === "/api/account/settings") { Object.assign(settings, request.postDataJSON()); return send({ settings }); }
    if (endpoint === "/api/account/preferences") return send({ preferences: { unreadRunKeys: [] } });
    if (endpoint === "/api/workspace-clones") return send({ clones: [] });
    if (endpoint.endsWith("/bootstrap")) return send({ token: "fixture-token", channels: [{ id: "manual", label: "手动输入", capabilities: { manualInput: true } }] });
    if (endpoint.endsWith("/models")) return send({ models: [] });
    if (endpoint.endsWith("/execution-options")) return send({ agent: agentDescriptor, permissionModes: [{ id: "ask", available: true }] });
    if (endpoint.endsWith("/runs")) return send({ runs: [{ key: "manual-attention", title: "初始执行审批", metadata: { type: "requirement", progress: "in_progress" }, status: "running" }] });
    if (endpoint.endsWith("/runs/manual-attention")) return send({ key: "manual-attention", title: "初始执行审批", agent: agentDescriptor, sessionId: "attention-session", status: "running", items: [], requests: [{ id: "approval", kind: "approval", action: "command", reason: "模拟审批", command: "npm run build" }], executionSettings: { model: "", reasoningEffort: "", permissionMode: "ask" } });
    const result = project.response(url);
    if (result) return send(result);
    return send({});
  });
  try {
    await page.goto(origin);
    await page.getByRole("button", { name: "待我处理", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "待我处理", exact: true });
    await dialog.getByText("初始执行审批", { exact: true }).waitFor();
    assert.equal(await page.locator(".workbench-home .attention-section").count(), 0, "the workbench retains the prototype sections without a duplicate attention section");
    assert.equal(await page.evaluate(() => window.attentionFixture.notifications.length), 0, "initial pending actions are silent");
    items = [...items, { id: "new-question", kind: "question", projectId: project.projectId, projectName: "客户管理系统", workspaceId: workspace.id, runKey: "manual-attention", title: "新增提问" }];
    await page.waitForFunction(() => window.attentionFixture.notifications.length === 1);
    await dialog.getByText("新增提问", { exact: true }).waitFor();
    fail = true;
    await dialog.getByText("模拟读取失败", { exact: true }).waitFor();
    fail = false;
    await dialog.getByText("模拟读取失败", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.attentionFixture.notifications.length), 1, "retrying an unchanged list must not repeat the reminder");
    await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await page.locator(".ui-account-nav").getByRole("button", { name: "个人设置", exact: true }).click();
    await page.getByRole("switch", { name: "需要我处理时提醒", exact: true, checked: true }).click();
    await page.getByRole("switch", { name: "需要我处理时提醒", exact: true, checked: false }).waitFor();
    items = [...items, { id: "muted-delivery", kind: "delivery", deliveryId: "delivery-1", projectId: project.projectId, projectName: "客户管理系统", title: "静音期间新增交付" }];
    await page.locator(".attention-count").filter({ hasText: "3" }).waitFor();
    assert.equal(await page.evaluate(() => window.attentionFixture.notifications.length), 1, "existing personal notification preference suppresses new reminders");
    await page.getByRole("switch", { name: "需要我处理时提醒", exact: true, checked: false }).click();
    await page.getByRole("switch", { name: "需要我处理时提醒", exact: true, checked: true }).waitFor();
    await page.getByRole("button", { name: "待我处理", exact: true }).click();
    const refreshed = page.waitForResponse(response => response.url().endsWith("/api/workbench/attention") && response.ok());
    await dialog.getByRole("button", { name: "刷新", exact: true }).click();
    await refreshed;
    assert.equal(await page.evaluate(() => window.attentionFixture.notifications.length), 1, "enabling notifications must not backfill actions seen while muted");
    await dialog.getByRole("button", { name: /新增提问/ }).click();
    await page.waitForURL(url => url.searchParams.get("workspace") === workspace.id && url.searchParams.get("task") === "manual-attention");
    await page.getByRole("button", { name: "允许本次操作", exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
module.exports = { verifyAttentionNotifications };
