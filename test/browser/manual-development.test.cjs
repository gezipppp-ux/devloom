/* global document, window, DataTransfer, File, ClipboardEvent, Uint8Array, atob */
const assert = require("node:assert/strict");
const path = require("node:path");
const { png } = require("../support/helpers.cjs");
const { agentDescriptor } = require("../fixtures/agent-descriptor.cjs");
const { setMarkdown, pasteImage, markdownValue } = require("../support/issue-markdown.cjs");
const { selectRemoteBranch } = require("../support/remote-branch-select.cjs");

async function verifyManualDevelopment({ page, origin, projectId, output }) {
  const endpoint = `/api/projects/${projectId}/tasks/manual`;
  const inputs = [];
  let outcome = "started", recorded = null, failLookup = false;
  const routePattern = `**${endpoint}*`;
  const handler = async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: failLookup ? 503 : 200, json: failLookup ? { error: "状态读取失败" } : { task: recorded } });
    inputs.push(route.request().postDataJSON());
    recorded = { id: "independent-task", title: "独立开发测试", kind: "manual", status: outcome === "unknown" ? "unknown" : "started", runKey: "manual-run", error: outcome === "unknown" ? "派发结果待确认" : null };
    if (outcome === "lost") return route.abort("failed");
    return route.fulfill({ status: 202, json: { task: recorded } });
  };
  await page.route(routePattern, handler);
  const runHandler = route => route.fulfill({ json: { key: "manual-run", title: "独立开发测试", status: "completed", source: { channel: "manual" }, agent: agentDescriptor,
    sessionId: "fixture-manual-session", items: [], requests: [], metadata: { type: "other", progress: "in_progress" }, executionSettings: { model: "", reasoningEffort: "", permissionMode: "ask" } } });
  await page.route("**/api/workspaces/ux-workspace/runs/manual-run", runHandler);
  let uploadCount = 10;
  let failUpload = false;
  const uploadHandler = route => failUpload ? route.fulfill({ status: 503, json: { error: '参考图片上传失败' } }) : route.fulfill({ json: { id: `00000000-0000-4000-8000-${String(++uploadCount).padStart(12, '0')}` } });
  await page.route("**/api/workspaces/ux-workspace/channels/manual/images", uploadHandler);
  try {
    const returnTo = `/projects/${projectId}?tab=tasks&task=search-task`;
    const location = origin + `/?workspace=ux-workspace&task=1-1&returnTo=${encodeURIComponent(returnTo)}`;
    await page.goto(location);
    await page.locator('.session-header').waitFor();
    assert.equal(await page.locator('.workspace-heading').getByRole('button', { name: '返回项目协作', exact: true }).count(), 1);
    assert.equal(await page.locator('.project-back').count(), 0);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.evaluate(() => {
        const composer = document.querySelector('.session-composer').getBoundingClientRect();
        const back = document.querySelector('.workspace-project-return').getBoundingClientRect();
        return { scroll: document.documentElement.scrollHeight, height: window.innerHeight, horizontal: document.documentElement.scrollWidth > window.innerWidth,
          composerBottom: composer.bottom, backRight: back.right };
      });
      await page.screenshot({ path: path.join(output, `project-workspace-${width}.png`), fullPage: true });
      assert.equal(bounds.horizontal, false, `workspace horizontal overflow at ${width}`);
      assert.ok(bounds.scroll <= bounds.height + 1, `document overflow at ${width}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.composerBottom <= bounds.height + 1, `composer clipped at ${width}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.backRight <= width, `return action outside viewport at ${width}`);
    }
    await page.getByRole('button', { name: '返回项目协作', exact: true }).click();
    await page.waitForURL(origin + returnTo);
    await page.goto(location);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const enter = () => page.getByRole('button', { name: '手动开启', exact: true }).click();
    const fill = async () => {
      await page.getByRole('textbox', { name: '任务标题', exact: true }).fill('独立开发测试');
      await setMarkdown(page, '开发目标与验收条件', '## 开发目标\n\n- 保留会话身份，验证独立开发。');
      await selectRemoteBranch(page);
      await page.getByRole('button', { name: '启动独立开发', exact: true }).waitFor();
    };
    await enter();
    await page.getByRole('heading', { name: '手动开启开发', exact: true }).waitFor();
    assert.equal(inputs.length, 0, 'opening a form never starts development');
    assert.equal(await page.getByRole('button', { name: /保存/ }).count(), 0);
    await fill();
    const editor = page.getByRole('group', { name: '开发目标与验收条件编辑器', exact: true });
    failUpload = true;
    await editor.locator('input[type=file]').setInputFiles({ name: 'failed.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: '忽略未上传的图片', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '启动独立开发', exact: true }).isDisabled(), true, 'failed image uploads cannot silently start');
    assert.equal(inputs.length, 0);
    failUpload = false;
    await editor.locator('input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: '移除附件 reference.png', exact: true }).click();
    await pasteImage(page, '开发目标与验收条件');
    await editor.getByRole('button', { name: 'Markdown源码', exact: true }).click();
    await editor.locator('textarea').evaluate((element, data) => {
      element.setSelectionRange(0, 0);
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'source-paste.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, png.toString('base64'));
    await page.getByRole('button', { name: '移除附件 source-paste.png', exact: true }).waitFor();
    const content = await markdownValue(page, '开发目标与验收条件');
    assert.match(content, /^!\[source-paste.png\]\(manual-image:/);
    assert.doesNotMatch(content, /blob:|data:image/);
    await editor.getByRole('button', { name: '预览', exact: true }).click();
    await editor.locator('.markdown-editor-preview img[alt="pasted-proof.png"][src^="blob:"]').waitFor();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const start = page.getByRole('button', { name: '启动独立开发', exact: true });
      await start.scrollIntoViewIfNeeded();
      assert.ok(await start.isVisible());
      await page.screenshot({ path: path.join(output, `manual-start-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: '启动独立开发', exact: true }).click();
    await page.getByRole('heading', { name: '独立开发测试', exact: true }).waitFor();
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].taskType, 'other');
    assert.equal(inputs[0].images.length, 2);
    assert.equal(inputs[0].content, content);
    assert.equal(inputs[0].baseBranch, 'main');
    assert.equal(Object.hasOwn(inputs[0], 'issueIds'), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await enter(); await fill();
    outcome = "unknown";
    await page.getByRole('button', { name: '启动独立开发', exact: true }).click();
    await page.getByRole('button', { name: '查看开发任务记录', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '启动独立开发', exact: true }).count(), 0);
    await page.getByRole('button', { name: '返回会话', exact: true }).click();
    await enter(); await fill();
    outcome = "lost"; failLookup = true;
    await page.getByRole('button', { name: '启动独立开发', exact: true }).click();
    await page.getByRole('button', { name: '检查启动结果', exact: true }).waitFor();
    const count = inputs.length;
    failLookup = false;
    await page.getByRole('button', { name: '检查启动结果', exact: true }).click();
    await page.getByRole('heading', { name: '独立开发测试', exact: true }).waitFor();
    assert.equal(inputs.length, count, 'checking a lost response only reads the accepted request');
    await enter(); await fill();
    let releaseUpload, uploadStarted;
    const uploading = new Promise(resolve => { uploadStarted = resolve; });
    await page.route('**/api/workspaces/ux-workspace/channels/manual/images', async route => {
      uploadStarted(); await new Promise(resolve => { releaseUpload = resolve; });
      return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000099' } });
    }, { times: 1 });
    await editor.locator('input[type=file]').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: png });
    await uploading;
    assert.equal(await page.getByRole('button', { name: '启动独立开发', exact: true }).isDisabled(), true);
    await page.goto(location);
    await page.locator('.session-header').waitFor();
    await enter(); await fill();
    releaseUpload();
    await page.getByRole('button', { name: '启动独立开发', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: '移除附件 late.png', exact: true }).count(), 0, 'late upload cannot enter a new form');
    assert.doesNotMatch(await markdownValue(page, '开发目标与验收条件'), /late.png/);
  } finally {
    await page.unroute(routePattern, handler);
    await page.unroute("**/api/workspaces/ux-workspace/runs/manual-run", runHandler);
    await page.unroute("**/api/workspaces/ux-workspace/channels/manual/images", uploadHandler);
  }
}
module.exports = { verifyManualDevelopment };
