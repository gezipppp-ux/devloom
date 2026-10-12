/* global document, window */
const assert = require('node:assert/strict');
const path = require('node:path');
const { defaultWorkflow } = require('../../src/domain/issue-workflows.cjs');

async function verifyWorkflowCanvas({ page, origin, output }) {
  const workflows = Object.fromEntries(['requirement', 'bug'].map(type => [type, { revision: 1, publishedVersion: 1, draft: defaultWorkflow(type) }]));
  let failSave = false, holdSave = false, releaseSave, saveStarted;
  const writes = [];
  await page.route('**/api/system/workflows/**', async route => {
    const request = route.request(), type = new URL(request.url()).pathname.split('/')[4];
    const workflow = workflows[type];
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON());
      if (holdSave) { saveStarted(); await new Promise(resolve => { releaseSave = resolve; }); }
      if (failSave) return route.fulfill({ status: 409, json: { error: '流程已被其他管理员修改，请重新读取。' } });
      if (request.url().endsWith('/publish')) workflow.publishedVersion++;
      else { workflow.draft = request.postDataJSON().definition; workflow.revision++; }
    }
    return route.fulfill({ json: { workflow } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/system?tab=workflows');
  const graph = page.getByRole('group', { name: '事项流程图', exact: true });
  await graph.waitFor();
  await page.getByRole('button', { name: '全屏画布', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).waitFor();
  assert.ok(await page.locator('.workflow-canvas').evaluate(element => element.getBoundingClientRect().height >= window.innerHeight - 2));
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  assert.ok(await graph.evaluate(svg => svg.getBoundingClientRect().width <= svg.parentElement.clientWidth));
  await page.getByRole('button', { name: '放大流程图', exact: true }).click();
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'workflow-fullscreen-1440.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '全屏画布', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '添加状态', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '添加连线', exact: true }).count(), 0);
  const verifyCurves = async () => {
    const failures = await graph.evaluate(svg => {
      const boxes = [...svg.querySelectorAll('.node-card')].map(rect => {
        const transform = rect.parentElement.transform.baseVal.consolidate().matrix;
        return { x: transform.e, y: transform.f, width: +rect.getAttribute('width'), height: +rect.getAttribute('height') };
      });
      const errors = [];
      for (const edge of svg.querySelectorAll('.edge-line, .connection-preview')) {
        if (!edge.getAttribute('d').includes(' C ')) errors.push('missing curve');
        const length = edge.getTotalLength();
        for (let offset = 1; offset < length; offset += 2) {
          const p = edge.getPointAtLength(offset);
          if (boxes.some(b => p.x > b.x + .1 && p.x < b.x + b.width - .1 && p.y > b.y + .1 && p.y < b.y + b.height - .1)) errors.push(edge.parentElement.getAttribute('aria-label'));
        }
      }
      return errors;
    });
    assert.deepEqual(failures, [], 'rendered Bézier curves must not enter node cards');
  };
  await verifyCurves();
  const verifyPreview = async (sourceName, targetName) => {
    const source = await page.getByRole('button', { name: `连接 ${sourceName}`, exact: true }).boundingBox();
    const target = await page.getByRole('button', { name: targetName, exact: true }).boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await graph.locator('.connection-preview').waitFor();
    await verifyCurves();
    await page.screenshot({ path: path.join(output, `workflow-preview-${sourceName}.png`), fullPage: true });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await graph.locator('.connection-preview').count(), 0);
    assert.equal(await graph.locator('.edge-line').count(), 13, 'cancelled previews cannot create a transition');
  };
  await verifyPreview('规划中', '已实现');
  await verifyPreview('已实现', '规划中');
  const planned = page.getByRole('button', { name: '规划中', exact: true });
  await planned.click();
  await page.getByLabel('状态名称', { exact: true }).fill('画布内规划');
  assert.equal(await page.locator('.workflow-canvas').getByLabel('状态名称', { exact: true }).count(), 1);
  const renamed = page.getByRole('button', { name: '画布内规划', exact: true });
  const previousPosition = await renamed.getAttribute('transform');
  await renamed.focus(); await renamed.press('ArrowDown');
  assert.notEqual(await renamed.getAttribute('transform'), previousPosition);
  await page.getByRole('button', { name: '全屏画布', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  assert.equal(await page.getByLabel('状态名称', { exact: true }).inputValue(), '画布内规划', 'fullscreen keeps the draft and selection');
  await renamed.press('Escape');
  const beforeDrag = await renamed.getAttribute('transform'), dragBox = await renamed.boundingBox();
  await page.mouse.move(dragBox.x + 40, dragBox.y + 30); await page.mouse.down();
  await page.mouse.move(dragBox.x + 40, dragBox.y + 126, { steps: 8 }); await page.mouse.up();
  assert.notEqual(await renamed.getAttribute('transform'), beforeDrag, 'pointer dragging moves the state');
  const source = await page.getByRole('button', { name: '连接 画布内规划', exact: true }).boundingBox();
  const target = await page.getByRole('button', { name: '开发中', exact: true }).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x + 60, target.y + 30, { steps: 10 }); await page.mouse.up();
  await page.getByLabel('操作名称', { exact: true }).fill('画布连接');
  await page.getByLabel('必须填写原因', { exact: true }).check();
  await page.getByLabel('所需权限', { exact: true }).selectOption('issue.accept');
  assert.equal(await graph.locator('.edge-line').count(), 14);
  await verifyCurves();
  await page.getByLabel('操作名称', { exact: true }).press('Escape');
  const selectedEdge = page.getByRole('button', { name: '连线：画布连接，画布内规划 → 开发中', exact: true });
  await selectedEdge.focus(); await selectedEdge.press('Enter');
  assert.equal(await page.getByLabel('操作名称', { exact: true }).inputValue(), '画布连接');
  await selectedEdge.focus(); await selectedEdge.press('Delete');
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  await page.getByLabel('操作名称', { exact: true }).press('Escape');
  // Wait for the inspector to close and the canvas to finish fitting before choosing a blank point.
  await graph.scrollIntoViewIfNeeded();
  const empty = await graph.evaluate(svg => {
    const rect = svg.getBoundingClientRect(), clip = svg.parentElement.getBoundingClientRect();
    for (let y = Math.min(clip.bottom, window.innerHeight) - 24; y > clip.top + 24; y -= 20) {
      for (let x = clip.left + 24; x < clip.right - 24; x += 20) {
        if (document.elementFromPoint(x, y) === svg) return { x: x - rect.left, y: y - rect.top };
      }
    }
    throw new Error('No blank canvas point found');
  });
  await graph.dblclick({ position: empty });
  await page.getByLabel('状态名称', { exact: true }).fill('在画布新建的状态');
  await page.getByLabel('状态类型', { exact: true }).selectOption('completed');
  assert.equal(await page.getByLabel('允许开始开发', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '删除状态', exact: true }).click();
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  assert.equal(await graph.locator('.workflow-node').count(), 7);
  await page.getByRole('button', { name: '删除状态', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  assert.equal(await graph.locator('.workflow-node').count(), 6);
  // Two taps connect states without needing a precision drag on touchscreens.
  const tapPort = async name => {
    const port = page.getByRole('button', { name, exact: true });
    await port.scrollIntoViewIfNeeded();
    const box = await port.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  await tapPort('连接 画布内规划'); await tapPort('连接 开发中');
  await page.getByLabel('操作名称', { exact: true }).fill('触屏连接');
  await page.getByRole('button', { name: '删除连线', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  assert.equal(await graph.locator('.edge-line').count(), 14);
  failSave = true;
  await page.getByRole('button', { name: '保存流程草稿', exact: true }).click();
  await page.getByText('流程已被其他管理员修改，请重新读取。', { exact: true }).waitFor();
  assert.equal(await graph.locator('.edge-line').count(), 14, 'save failure retains local edits');
  failSave = false; holdSave = true;
  const started = new Promise(resolve => { saveStarted = resolve; });
  await page.getByRole('button', { name: '保存流程草稿', exact: true }).click(); await started;
  assert.equal(await page.getByLabel('流程类型', { exact: true }).isDisabled(), true);
  assert.equal(await graph.locator('.node-port').count(), 0, 'saving disables canvas connection handles');
  holdSave = false; releaseSave();
  await page.getByRole('button', { name: '保存流程草稿', exact: true, disabled: false }).waitFor();
  assert.equal(workflows.requirement.draft.transitions.at(-1).name, '画布连接');
  assert.equal(workflows.requirement.draft.transitions.at(-1).requiresReason, true);
  assert.equal(workflows.requirement.draft.transitions.at(-1).permission, 'issue.accept');
  assert.equal(writes.at(-1).definition.nodes[0].name, '画布内规划');
  await page.getByLabel('流程类型', { exact: true }).selectOption('bug');
  await page.getByRole('button', { name: '待处理', exact: true }).waitFor();
  assert.equal(await page.getByLabel('状态名称', { exact: true }).count(), 0, 'type switch clears inline editor');
  await verifyCurves();
  await page.getByRole('button', { name: '待处理', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('很长的状态名称用于验证画布内编辑的窄屏换行和完整内容可访问性');
  await page.locator('.operation-message-close').evaluateAll(buttons => buttons.forEach(button => button.click()));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `workflow overflow at ${width}`);
    const input = await page.getByLabel('状态名称', { exact: true }).boundingBox();
    assert.ok(input.x >= 0 && input.x + input.width <= width, `inline editor outside viewport at ${width}`);
    await page.screenshot({ path: path.join(output, `workflow-canvas-${width}.png`), fullPage: true });
    if (width === 320) await page.locator('.workflow-canvas').evaluate(element => { element.requestFullscreen = undefined; });
    await page.getByRole('button', { name: '全屏画布', exact: true }).click();
    await page.getByRole('button', { name: '退出全屏', exact: true }).waitFor();
    assert.equal(await page.locator('.canvas-feedback').count(), 0, 'another flow or an edited draft cannot retain a saved status');
    await page.getByRole('button', { name: '保存流程草稿', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `workflow-fullscreen-editor-${width}.png`) });
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    if (width === 320) assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'fallback fullscreen releases page scrolling');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '校验并发布流程', exact: true }).click();
  await page.getByText('已发布 v2', { exact: true }).waitFor();
}

module.exports = { verifyWorkflowCanvas };
