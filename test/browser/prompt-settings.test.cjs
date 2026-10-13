const { navigateWorkspace } = require("../support/browser-navigation.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyPromptSettings(browser, { origin, output, errors, workspaceA, workspaceB }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const endpoint = `${origin}/api/workspaces/${workspaceA.id}/settings/prompts`;
  const pattern = `**/api/workspaces/${workspaceA.id}/settings/prompts`;
  const read = async (id = workspaceA.id) =>
    (await page.request.get(`${origin}/api/workspaces/${id}/settings/prompts`)).json();
  const saved = async () => {
    await page.locator('#prompt-settings[aria-busy="false"]').waitFor();
    const label = (await page.locator(".prompt-editor-label").innerText()).trim();
    await page.locator('.operation-message[data-type="success"]')
      .getByText(`${label}已保存，对新任务和新追加资料生效。`, { exact: true }).waitFor();
  };
  const editor = page.getByRole("textbox", { name: "提示词模板内容", exact: true });
  const save = page.getByRole("button", { name: "保存提示词模板", exact: true });
  const reset = page.getByRole("button", { name: "恢复当前类型默认模板", exact: true });
  const switchWorkspace = async (workspace) => {
    await navigateWorkspace(page, workspace);
    await page.getByRole("heading", { name: `${workspace.name} · 工作区设置`, exact: true }).waitFor();
    await editor.waitFor();
  };
  const leaveSettings = () => page.getByRole("button", { name: "＋ 从需求启动", exact: true }).click();
  const openSettings = () => page.getByRole("button", { name: "工作区设置", exact: true }).click();
  try {
    await page.route(pattern, (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟提示词设置暂时离线" }),
    }), { times: 1 });
    await page.goto(`${origin}/?workspace=${workspaceA.id}`);
    await page.getByRole("alert").filter({ hasText: "模拟提示词设置暂时离线" }).waitFor();
    assert.equal(await save.count(), 0, "unloaded settings cannot be saved");
    const initial = await read();
    const otherInitial = await read(workspaceB.id);
    const previewTitle = '示例中的 {{content}} <img src=x onerror="window.promptPreviewExecuted=true">';
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      result.catalog.requirement.placeholders.find((item) => item.name === "title").example = previewTitle;
      await route.fulfill({ response, json: result });
    }, { times: 1 });
    await page.getByRole("button", { name: "重新加载提示词模板", exact: true }).click();
    await editor.waitFor();
    const labelBottom = await page.locator(".prompt-editor-label").evaluate((label) => label.getBoundingClientRect().bottom);
    const editorTop = await editor.evaluate((field) => field.getBoundingClientRect().top);
    assert.ok(editorTop >= labelBottom + 7, "editor label keeps the shared 8px field spacing");
    assert.equal(await editor.inputValue(), initial.templates.requirement);
    assert.equal(await save.isDisabled(), true);
    const custom = `自定义提示词：{{title}}\n{{content}}\n{{images}}\n<img src=x onerror="window.promptPreviewExecuted=true">\n$& 保留原文`;
    await editor.fill(custom);
    await page.locator(".prompt-preview > summary").click();
    const preview = page.getByLabel("提示词示例预览", { exact: true });
    assert.ok((await preview.innerText()).includes(previewTitle), "example values are replaced once");
    assert.ok((await preview.innerText()).includes("$& 保留原文"));
    assert.equal(await preview.locator("img").count(), 0, "preview renders raw text, never HTML");
    assert.equal(await page.evaluate(() => window.promptPreviewExecuted), undefined);
    await editor.evaluate((field) => field.setSelectionRange(0, 0));
    await page.getByRole("button", { name: "插入占位符 image_count", exact: true }).click();
    const manualDraft = `{{image_count}}${custom}`;
    assert.equal(await editor.inputValue(), manualDraft);
    assert.equal(await editor.evaluate((field) => field.selectionStart), "{{image_count}}".length);
    assert.deepEqual(Object.keys(initial.catalog), ["bug", "requirement", "supplement"]);
    const request = page.waitForRequest((entry) => entry.url() === endpoint && entry.method() === "POST");
    await save.click();
    assert.deepEqual((await request).postDataJSON(), { requirement: manualDraft });
    await saved();
    assert.equal((await read()).templates.requirement, manualDraft);
    await page.reload();
    await editor.waitFor();
    assert.equal(new URL(page.url()).searchParams.get("workspace"), workspaceA.id);
    assert.equal(await editor.inputValue(), manualDraft, "saved templates survive refresh");
    assert.equal((await read(workspaceB.id)).templates.requirement, otherInitial.templates.requirement,
      "saving workspace A never changes workspace B");
    await switchWorkspace(workspaceB);
    assert.equal(await editor.inputValue(), otherInitial.templates.requirement);
    const otherDraft = `工作区 B 专用\n${otherInitial.templates.requirement}`;
    await editor.fill(otherDraft);
    await save.click();
    await saved();
    assert.equal((await read(workspaceB.id)).templates.requirement, otherDraft);
    assert.equal((await read()).templates.requirement, manualDraft);
    await editor.fill(`${otherDraft}\n不能进入工作区 A 的草稿`);
    await switchWorkspace(workspaceA);
    assert.equal(await editor.inputValue(), manualDraft, "workspace switching keeps saved templates and drafts isolated");
    await editor.fill(`${manualDraft}\n{{unknown_placeholder}}`);
    await save.click();
    await page.getByRole("alert").filter({ hasText: "未知占位符" }).waitFor();
    assert.equal(await editor.inputValue(), `${manualDraft}\n{{unknown_placeholder}}`);
    assert.equal((await read()).templates.requirement, manualDraft, "failed save does not persist an invalid draft");
    await page.screenshot({ path: path.join(output, "prompt-settings-error.png"), fullPage: true });
    await reset.click();
    await page.getByRole("status").filter({ hasText: "默认模板填入草稿" }).waitFor();
    assert.equal(await editor.inputValue(), initial.catalog.requirement.defaultTemplate);
    assert.equal((await read()).templates.requirement, manualDraft, "reset changes only the draft before explicit save");
    const resetRequest = page.waitForRequest((entry) => entry.url() === endpoint && entry.method() === "POST");
    await save.click();
    assert.deepEqual((await resetRequest).postDataJSON(), { requirement: null });
    await saved();
    await page.reload();
    await editor.waitFor();
    assert.equal(await editor.inputValue(), initial.catalog.requirement.defaultTemplate);
    const longDraft = `${initial.catalog.requirement.defaultTemplate}\n${"无空格长文本验证".repeat(120)}`;
    await editor.fill(longDraft);
    await page.locator(".prompt-preview > summary").click();
    for (const [name, width, height] of [["desktop", 1440, 1100], ["tablet", 820, 1100], ["mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.locator("#prompt-settings").evaluate((element) => element.scrollIntoView({ block: "start" }));
      await editor.evaluate((field) => { field.scrollTop = 0; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${name} prompt settings must not overflow the viewport`);
      assert.ok(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth),
        `${name} settings content must not overflow its scroll container`);
      await page.screenshot({ path: path.join(output, `prompt-settings-${name}.png`), fullPage: true });
      await save.scrollIntoViewIfNeeded();
      assert.ok(await save.isVisible(), `${name} save controls remain reachable`);
      await page.screenshot({ path: path.join(output, `prompt-settings-${name}-preview.png`), fullPage: true });
    }
    await reset.click();
    await save.click();
    await saved();
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const originalJson = response.json.bind(response);
        response.json = async () => {
          const result = await originalJson();
          if (response.headers.get("x-fixture-stale"))
            window.setTimeout(() => { window.stalePromptProcessed = true; }, 0);
          return result;
        };
        return response;
      };
    });
    let capture;
    const captured = new Promise((resolve) => { capture = resolve; });
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      capture({ route, response });
    }, { times: 1 });
    await leaveSettings();
    await openSettings();
    const stale = await captured;
    await leaveSettings();
    await openSettings();
    await editor.waitFor();
    const freshDraft = `${initial.catalog.requirement.defaultTemplate}\n保留新页面的草稿`;
    await editor.fill(freshDraft);
    await stale.route.fulfill({
      response: stale.response,
      headers: { ...stale.response.headers(), "x-fixture-stale": "true" },
    });
    await page.waitForFunction(() => window.stalePromptProcessed === true);
    assert.equal(await editor.inputValue(), freshDraft, "unmounted requests cannot overwrite a new editor draft");
    await switchWorkspace(workspaceB);
    assert.equal(await editor.inputValue(), otherDraft, "the second workspace retains its own saved template after switching");
    await reset.click();
    await save.click();
    await saved();
    await switchWorkspace(workspaceA);
    assert.equal(await editor.inputValue(), initial.catalog.requirement.defaultTemplate,
      "unpersisted drafts do not leak across workspace navigation");
  } finally {
    await page.close();
  }
}

module.exports = { verifyPromptSettings };
