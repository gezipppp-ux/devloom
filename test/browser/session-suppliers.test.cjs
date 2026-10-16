/* global document */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifySessionSuppliers(browser, origin, manager, client, key, errors, output) {
  if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
  await manager.updateExecutionSettings(key, { model: "fixture-model-a", reasoningEffort: "high", permissionMode: "ask" });
  await manager.send(key, "供应商切换界面回归"); await manager.events.drain();
  const first = { id: "A", name: "供应商 A", runtimeRevision: 1 }, second = { id: "B", name: "供应商 B", runtimeRevision: 1 };
  let next = first, modelsRead = 0;
  const models = await manager.agent.listModels();
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/models", route => {
    modelsRead++;
    return route.fulfill({ json: { models: models.filter(model => model.model === (next === first ? "fixture-model-a" : "fixture-model-b")) } });
  });
  await page.route(`**/api/runs/${key}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), activeSupplier: first, nextSupplier: next, supplierPending: next !== first } });
  });
  try {
    await page.goto(origin);
    await page.getByText("历史回复", { exact: true }).waitFor();
    const hint = page.locator(".session-composer .execution-settings-hint").filter({ hasText: "供应商" });
    assert.equal(await hint.count(), 0, "unchanged suppliers do not add a repeated hint");
    const input = page.getByRole("textbox", { name: "发送给 Codex 的指令", exact: true });
    await input.fill("切换供应商时保留这份草稿");
    const before = client.calls.length, readsBefore = modelsRead;
    next = second; manager.emit("event", { type: "supplier-changed" });
    await hint.filter({ hasText: "下一轮供应商：供应商 B" }).waitFor();
    const warning = page.getByRole("alert").filter({ hasText: "当前模型或思考强度不受下一轮供应商支持" });
    await warning.waitFor();
    assert.ok(modelsRead > readsBefore, "supplier SSE refreshes the model catalog");
    assert.equal(await input.inputValue(), "切换供应商时保留这份草稿");
    assert.equal(await page.locator(".composer-send").isEnabled(), true, "incompatible next-turn models do not block steering");
    assert.equal(client.calls.slice(before).some(call => ["thread/start", "thread/resume", "turn/start"].includes(call.method)), false);
    await page.locator(".session-composer").screenshot({ path: path.join(output, "session-supplier-pending.png") });
    const sent = page.waitForResponse(response => new URL(response.url()).pathname === `/api/runs/${key}/messages`);
    await input.press("Enter"); assert.equal((await sent).status(), 202);
    await page.waitForFunction(() => document.querySelector(".session-composer textarea").value === "");
    assert.equal(client.calls.filter(call => call.method === "turn/steer").at(-1).params.threadId, "original");
    await manager.interrupt(key); await manager.events.drain();
    await page.getByRole("button", { name: "■ 停止", exact: true }).waitFor({ state: "hidden" });
    await input.fill("下一轮模型重选后保留的草稿");
    assert.equal(await page.locator(".composer-send").isDisabled(), true);
    await page.getByRole("combobox", { name: "Codex 模型", exact: true }).click();
    await page.locator('.app-select-option[data-value="fixture-model-b"]').click();
    await warning.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "下一轮模型重选后保留的草稿");
    await page.waitForFunction(() => !document.querySelector(".composer-send").disabled);
    process.stdout.write("Supplier session browser checks passed: SSE catalog refresh, current/next hints, draft preservation, steering and incompatible-model blocking.\n");
  } finally {
    await page.close();
    if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
    await manager.updateExecutionSettings(key, { model: "", reasoningEffort: "", permissionMode: "ask" });
  }
}
module.exports = { verifySessionSuppliers };
