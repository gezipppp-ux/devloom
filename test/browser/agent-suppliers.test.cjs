const { selectOption, selectValue } = require("../support/select.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyAgentSuppliers(page, output) {
  const builtin = { id: "server", agentType: "codex", name: "服务器现有配置", mode: "server-config", builtin: true, enabled: true, revision: 1, runtimeRevision: 1, models: [] };
  const rows = [builtin]; let currentId = "server", revision = 1, checks = 0, holdModels = false, releaseModels;
  let catalogFailure = false, catalogMissing = false, holdCatalog = false, releaseCatalog;
  const nativeModels = [{ model: "fixture-code", label: "Fixture Codex", reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }];
  const upstreamModels = [
    { model: "zeta-code", label: "Zeta Text" }, { model: "fixture-code-latest", label: "Fixture alias" },
    { model: "Bravo-10", label: "编程模型" }, { model: "fixture-code", label: "fixture-code" },
    { model: "alpha-code", label: "Alpha reasoning" }, { model: "bravo-2", label: "小型编程" },
    { model: "1-local-model", label: "Numeric fixture" },
  ];
  const writes = [];
  await page.route("**/api/system/agent-suppliers**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.split("/agent-suppliers")[1];
    const input = request.method() === "POST" ? request.postDataJSON() : null;
    if (input) writes.push({ endpoint, input });
    if (endpoint === "/catalog") {
      if (holdCatalog) { holdCatalog = false; await new Promise(resolve => { releaseCatalog = resolve; }); }
      return catalogFailure ? route.fulfill({ status: 503, json: { error: "模拟 Codex 内置目录读取失败" } }) : route.fulfill({ json: { models: catalogMissing ? [] : nativeModels } });
    }
    if (endpoint === "/models") {
      if (holdModels) { holdModels = false; await new Promise(resolve => { releaseModels = resolve; }); }
      return route.fulfill({ json: { models: upstreamModels } });
    }
    if (endpoint === "/check") { checks++; return route.fulfill({ json: { ok: true, elapsedMs: 12 } }); }
    if (!endpoint && !input) return route.fulfill({ json: { suppliers: rows, currentId, selectionRevision: revision } });
    if (!endpoint) { const row = { ...input, id: "api", revision: 1, runtimeRevision: 1, hasApiKey: true }; delete row.apiKey; rows.push(row); return route.fulfill({ json: { supplier: row } }); }
    const [, id, action] = endpoint.split("/"), row = rows.find(entry => entry.id === id);
    if (action === "activate") { currentId = id; revision++; return route.fulfill({ json: {} }); }
    if (action === "delete") { rows.splice(rows.indexOf(row), 1); return route.fulfill({ json: {} }); }
    if (action === "duplicate") { const draft = { ...row }; delete draft.id; delete draft.revision; return route.fulfill({ json: { draft: { ...draft, enabled: false, name: `${row.name} 副本` } } }); }
    Object.assign(row, input, { revision: row.revision + 1 }); delete row.apiKey;
    return route.fulfill({ json: { supplier: row } });
  });
  await page.goto(new URL("/system?tab=agent-suppliers", page.url()).href);
  await page.getByRole("heading", { name: "服务器现有配置", exact: true }).waitFor();
  const add = page.getByRole("button", { name: "新增供应商", exact: true });
  await add.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("供应商名称", { exact: true }).fill("团队供应商");
  await dialog.getByLabel("API 基础地址", { exact: true }).fill("https://fixture.invalid/v1");
  await dialog.getByLabel("API Key", { exact: true }).fill("fixture-key-only");
  await dialog.getByRole("button", { name: "获取模型", exact: true }).click();
  await dialog.locator(".supplier-fetched label").filter({ hasText: "fixture-code-latest" }).getByText("未匹配内置目录", { exact: true }).waitFor();
  const search = dialog.getByRole("searchbox", { name: "搜索模型", exact: true });
  assert.deepEqual(await dialog.locator(".supplier-group-heading span:first-child").allTextContents(), ["A", "B", "F", "Z", "其他"]);
  assert.deepEqual(await dialog.locator(".supplier-model-id").allTextContents(), ["alpha-code", "bravo-2", "Bravo-10", "fixture-code", "fixture-code-latest", "zeta-code", "1-local-model"]);
  await dialog.getByLabel("fixture-code", { exact: true }).check();
  await search.fill(" ALPHA ");
  assert.deepEqual(await dialog.locator(".supplier-model-id").allTextContents(), ["alpha-code"]);
  await dialog.getByLabel("alpha-code", { exact: true }).check();
  await search.fill(" 编程 ");
  assert.deepEqual(await dialog.locator(".supplier-model-id").allTextContents(), ["bravo-2", "Bravo-10"], "search also matches display names");
  await search.fill("missing-model");
  await dialog.getByText("没有匹配的模型，请调整搜索条件。", { exact: true }).waitFor();
  await dialog.getByText("已选 2 个", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "添加所选模型", exact: true }).isEnabled(), true);
  await dialog.getByRole("button", { name: "清空搜索", exact: true }).click();
  assert.equal(await dialog.getByLabel("fixture-code", { exact: true }).isChecked(), true);
  assert.equal(await dialog.getByLabel("alpha-code", { exact: true }).isChecked(), true);
  await dialog.getByLabel("alpha-code", { exact: true }).uncheck();
  await search.fill("ALIAS");
  assert.deepEqual(await dialog.locator(".supplier-model-id").allTextContents(), ["fixture-code-latest"]);
  await dialog.getByRole("button", { name: "添加所选模型" }).click();
  await dialog.locator(".supplier-model").getByText("Codex 内置", { exact: true }).waitFor();
  assert.deepEqual(await dialog.locator(".supplier-effort-chips span").allTextContents(), ["low", "medium", "high"]);
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "medium");
  assert.equal(await dialog.getByLabel("显示名称", { exact: true }).inputValue(), "Fixture Codex");
  await search.press("Enter");
  assert.equal(await dialog.isVisible(), true, "search Enter must not submit the supplier form");
  assert.equal(writes.filter(entry => entry.endpoint === "").length, 0);
  assert.equal(checks, 0);
  await dialog.getByRole("button", { name: "发送检测请求" }).click();
  await dialog.getByText("生成检测成功，耗时 12 ms。", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "保存供应商" }).click();
  await page.getByRole("heading", { name: "团队供应商", exact: true }).waitFor();
  assert.equal(writes.find(entry => entry.endpoint === "").input.models[0].reasoningSource, "codex");
  assert.equal(checks, 1, "saving must not run another generation");
  const card = page.locator(".supplier-card").filter({ has: page.getByRole("heading", { name: "团队供应商", exact: true }) });
  await card.getByRole("button", { name: "设为默认", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "设为默认", exact: true }).click();
  await card.getByText("当前默认", { exact: true }).waitFor();
  assert.equal(await card.getByRole("button", { name: "停用", exact: true }).isDisabled(), true);
  assert.equal(await card.getByRole("button", { name: "删除", exact: true }).isDisabled(), true);
  while (await page.getByRole("button", { name: "关闭提示", exact: true }).count()) await page.getByRole("button", { name: "关闭提示", exact: true }).first().click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `agent-suppliers-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
    dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByLabel("API Key", { exact: true }).inputValue(), "");
    await dialog.getByRole("button", { name: "获取模型", exact: true }).click();
    await dialog.locator(".supplier-group-heading").first().waitFor();
    await dialog.locator(".supplier-fetched").scrollIntoViewIfNeeded();
    assert.ok(await dialog.locator(".supplier-fetched").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: path.join(output, `agent-supplier-model-search-${width}.png`) });
    await dialog.getByRole("searchbox", { name: "搜索模型", exact: true }).fill("missing-model");
    await dialog.getByText("没有匹配的模型，请调整搜索条件。", { exact: true }).waitFor();
    if (width === 320) await page.screenshot({ path: path.join(output, "agent-supplier-model-search-empty-320.png") });
    await dialog.getByRole("button", { name: "清空搜索", exact: true }).click();
    await dialog.getByRole("button", { name: "保存供应商" }).scrollIntoViewIfNeeded();
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: path.join(output, `agent-supplier-editor-${width}.png`) });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await card.getByRole("button", { name: "编辑 / 检测", exact: true }).evaluate(element => element === document.activeElement), true);
  }
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  await page.getByRole("dialog").getByLabel("备注", { exact: true }).fill("只改备注");
  await page.getByRole("dialog").getByRole("button", { name: "保存供应商" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(Object.hasOwn(writes.findLast(entry => entry.endpoint === "/api").input, "apiKey"), false);
  catalogMissing = true;
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("未匹配内置目录", { exact: true }).waitFor();
  assert.deepEqual(await dialog.locator(".supplier-effort-chips span").allTextContents(), ["low", "medium", "high"], "missing catalog entries preserve the saved snapshot for an unchanged model");
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "medium");
  await page.keyboard.press("Escape"); catalogMissing = false;
  catalogFailure = true;
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText(/模拟 Codex 内置目录读取失败/).waitFor();
  await dialog.getByRole("button", { name: "自定义", exact: true }).click();
  assert.equal(await dialog.getByLabel("支持的思考强度", { exact: true }).inputValue(), "low, medium, high", "saved automatic values remain editable when the catalog is offline");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText(/模拟 Codex 内置目录读取失败/).waitFor();
  await dialog.getByLabel("模型 ID", { exact: true }).fill("fixture-code-latest");
  assert.equal(await dialog.getByLabel("支持的思考强度", { exact: true }).inputValue(), "", "changing the model ID clears old automatic metadata even without a catalog");
  await page.keyboard.press("Escape"); catalogFailure = false;
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "自定义", exact: true }).click();
  await dialog.getByLabel("支持的思考强度", { exact: true }).fill("high");
  await selectOption(dialog.getByLabel("默认思考强度", { exact: true }), "high");
  await dialog.getByRole("button", { name: "保存供应商", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(writes.findLast(entry => entry.endpoint === "/api").input.models[0].reasoningEfforts, ["high"]);
  assert.equal(writes.findLast(entry => entry.endpoint === "/api").input.models[0].reasoningSource, "custom");
  delete rows.find(entry => entry.id === "api").models[0].reasoningSource;
  await page.reload();
  await card.waitFor();
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  await dialog.getByRole("button", { name: "使用内置配置", exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("支持的思考强度", { exact: true }).inputValue(), "high");
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "high");
  const effortInput = dialog.getByLabel("支持的思考强度", { exact: true });
  await effortInput.press("End");
  await effortInput.pressSequentially(", ");
  assert.equal(await effortInput.inputValue(), "high, ", "typing preserves separators until the next effort is entered");
  await effortInput.pressSequentially("medium");
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "high");
  await dialog.getByRole("button", { name: "使用内置配置", exact: true }).click();
  await dialog.getByRole("button", { name: "自定义", exact: true }).click();
  assert.equal(await effortInput.inputValue(), "low, medium, high", "restoring native configuration clears the custom text draft");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "复制", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByLabel("API Key", { exact: true }).inputValue(), "");
  assert.equal(await page.getByRole("dialog").getByLabel("启用供应商", { exact: true }).isChecked(), false);
  await page.keyboard.press("Escape");
  await add.click(); dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "手动添加", exact: true }).click();
  await dialog.getByLabel("模型 ID", { exact: true }).fill("fixture-code");
  await dialog.locator(".supplier-effort-chips").waitFor();
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "medium");
  await dialog.getByLabel("模型 ID", { exact: true }).fill("fixture-code-latest");
  await dialog.getByText("未匹配内置目录", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("支持的思考强度", { exact: true }).inputValue(), "", "model aliases must not inherit capabilities by prefix");
  await page.keyboard.press("Escape");

  holdCatalog = true;
  await add.click(); dialog = page.getByRole("dialog");
  await dialog.getByText("正在读取 Codex 内置模型目录…", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "手动添加", exact: true }).click();
  await dialog.getByLabel("模型 ID", { exact: true }).fill("fixture-code");
  await dialog.getByRole("button", { name: "获取模型", exact: true }).click();
  await dialog.getByLabel("fixture-code", { exact: true }).waitFor();
  await dialog.getByLabel("支持的思考强度", { exact: true }).fill("high");
  await dialog.getByLabel("供应商名称", { exact: true }).click();
  releaseCatalog();
  await dialog.getByRole("button", { name: "使用内置配置", exact: true }).waitFor();
  await dialog.getByLabel("fixture-code", { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel("支持的思考强度", { exact: true }).inputValue(), "high", "late catalog results preserve manually entered values");
  await dialog.getByRole("button", { name: "使用内置配置", exact: true }).click();
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "medium");
  await page.keyboard.press("Escape");

  holdCatalog = true;
  await add.click(); dialog = page.getByRole("dialog");
  await dialog.getByText("正在读取 Codex 内置模型目录…", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  const releaseOldCatalog = releaseCatalog;
  catalogFailure = true;
  await add.click(); dialog = page.getByRole("dialog");
  await dialog.getByText(/模拟 Codex 内置目录读取失败/).waitFor();
  catalogFailure = false; releaseOldCatalog();
  await dialog.getByRole("button", { name: "手动添加", exact: true }).click();
  await dialog.getByLabel("模型 ID", { exact: true }).fill("fixture-code");
  await dialog.getByText("目录未加载", { exact: true }).waitFor();
  assert.equal(await dialog.locator(".supplier-effort-chips").count(), 0);
  await dialog.getByRole("button", { name: "重试读取内置目录", exact: true }).click();
  await dialog.getByText("Codex 内置", { exact: true }).waitFor();
  assert.equal(await selectValue(dialog.getByLabel("默认思考强度", { exact: true })), "medium");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "编辑 / 检测", exact: true }).click();
  holdModels = true;
  await page.getByRole("dialog").getByRole("button", { name: "获取模型", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.supplier-dialog')?.textContent.includes('获取中…'));
  await page.keyboard.press("Escape");
  await add.click(); releaseModels();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("dialog").getByLabel("供应商名称", { exact: true }).inputValue(), "");
  assert.equal(await page.getByRole("dialog").getByText("fixture-code", { exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await page.locator(".supplier-card").filter({ hasText: "服务器现有配置" }).getByRole("button", { name: "设为默认", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "设为默认", exact: true }).click();
  await card.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用供应商", exact: true }).click();
  await card.getByText("已停用", { exact: true }).waitFor();
  await card.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除供应商", exact: true }).click();
  await card.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "个人设置", exact: true }).click();
  process.stdout.write("Supplier model browser checks passed: grouped sorting, search, preserved selections, native metadata, manual overrides, retries and late catalog responses.\n");
}
module.exports = { verifyAgentSuppliers };
