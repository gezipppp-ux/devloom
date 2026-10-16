const { selectOption, selectPreference } = require("../support/select.cjs");
/* global document, window */
const assert = require('node:assert/strict');
const path = require('node:path');
const { defaultWorkflow } = require('../../src/domain/issue-workflows.cjs');

async function verifyWorkflowFocus({ page, graph, output }) {
  const rejected = graph.getByRole('button', { name: '已拒绝', exact: true });
  const completed = graph.getByRole('button', { name: '已实现', exact: true });
  const incoming = graph.getByRole('button', { name: '连线：取消事项，待开发 → 已拒绝', exact: true });
  const unrelated = graph.getByRole('button', { name: '连线：安排开发，规划中 → 待开发', exact: true });
  const opacity = element => element.evaluate(node => Number(window.getComputedStyle(node).opacity));
  const positions = await graph.locator('.workflow-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  await rejected.click();
  await graph.locator('.workflow-focus-mask').waitFor();
  assert.deepEqual(await graph.locator('.workflow-node.is-muted').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId)), ['implemented']);
  assert.equal(await graph.locator('.workflow-edge:not(.is-muted)').count(), 7, 'both incoming cancellation edges and the outgoing reopen edge remain clear');
  assert.equal(await opacity(incoming), 1);
  assert.equal(await opacity(unrelated), .18, 'an edge between two neighbors is not directly related to the selection');
  assert.equal(await opacity(completed), .18);
  const fills = [];
  for (const value of ['light', 'dark']) {
    await selectPreference(page, "theme", value);
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, value);
    const colors = await incoming.locator('.edge-line').evaluate(path => {
      const style = window.getComputedStyle(path), canvas = path.closest('.workflow-canvas'), mask = canvas.querySelector('.workflow-focus-mask');
      return { edge: style.stroke, danger: style.getPropertyValue('--danger').trim(), mask: window.getComputedStyle(mask).fill, canvas: window.getComputedStyle(canvas).backgroundColor, pointerEvents: window.getComputedStyle(mask).pointerEvents };
    });
    const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;
    assert.equal(colors.edge, rgb(colors.danger), 'highlighting retains the cancellation color in either theme');
    assert.equal(colors.mask, colors.canvas, 'the soft mask follows the current canvas theme');
    assert.equal(colors.pointerEvents, 'none', 'the mask cannot intercept canvas gestures');
    fills.push(colors.mask);
    assert.equal(await rejected.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await graph.locator('.workflow-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))), positions, 'theme and selection leave saved geometry intact');
    await page.locator('.workflow-canvas').screenshot({ path: path.join(output, `workflow-focus-${value}.png`) });
  }
  assert.notEqual(fills[0], fills[1]);
  await incoming.focus(); await incoming.press('Enter');
  assert.equal(await incoming.evaluate(node => document.activeElement === node), true, 'selecting an edge retains keyboard focus');
  assert.equal(await graph.locator('.workflow-edge:not(.is-muted)').count(), 1);
  assert.deepEqual(await graph.locator('.workflow-node:not(.is-muted)').evaluateAll(nodes => nodes.map(node => node.dataset.nodeId).sort()), ['ready', 'rejected']);
  assert.equal(await page.getByLabel('操作名称', { exact: true }).inputValue(), '取消事项');
  // Muted states remain available to pointer and keyboard users.
  await completed.focus();
  assert.equal(await opacity(completed), 1, 'keyboard focus makes a muted state legible');
  await completed.press('Enter');
  assert.equal(await page.getByLabel('状态名称', { exact: true }).inputValue(), '已实现');
  await rejected.click();
  assert.equal(await rejected.getAttribute('aria-pressed'), 'true', 'a muted state can be selected with the pointer');
  const port = graph.getByRole('button', { name: '连接 已拒绝', exact: true });
  await port.focus(); await port.press('Enter');
  assert.equal(await graph.locator('.workflow-focus-mask').count(), 0, 'connecting exposes all target states');
  assert.equal(await graph.locator('.is-muted').count(), 0);
  await port.press('Escape');
  await graph.locator('.workflow-focus-mask').waitFor({ state: 'hidden' });
  assert.equal(await graph.locator('.is-muted').count(), 0, 'clearing restores the complete graph');
  await selectPreference(page, "theme", 'light');
}

async function verifyWorkflowCanvas({ page, origin, output }) {
  const workflows = Object.fromEntries(['requirement', 'bug'].map(type => [type, { revision: 1, publishedVersion: 1, draft: defaultWorkflow(type) }]));
  const initialEdges = workflows.requirement.draft.transitions.length, initialNodes = workflows.requirement.draft.nodes.length;
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
    assert.equal(await graph.locator('.edge-line').count(), initialEdges, 'cancelled previews cannot create a transition');
  };
  await verifyPreview('规划中', '已实现');
  await verifyPreview('已实现', '规划中');
  const zoomLabel = page.getByLabel('画布缩放比例', { exact: true });
  const initialZoom = await zoomLabel.textContent();
  const canvas = page.locator('.workflow-scroll');
  await canvas.scrollIntoViewIfNeeded();
  const clip = await canvas.boundingBox();
  const rejected = page.getByRole('button', { name: '已拒绝', exact: true });
  const rejectedBox = await rejected.boundingBox();
  await page.mouse.move(rejectedBox.x + 30, rejectedBox.y + 20); await page.mouse.down();
  await page.mouse.move(clip.x + clip.width - 220, clip.y + clip.height - 115, { steps: 16 });
  const visibleDuringDrag = await rejected.evaluate(node => {
    const card = node.querySelector('.node-card'), box = card.getBoundingClientRect(), viewport = node.closest('svg').getBoundingClientRect();
    return box.right < viewport.right && box.bottom < viewport.bottom && node.contains(document.elementFromPoint(box.right - 8, box.bottom - 8));
  });
  assert.ok(visibleDuringDrag, 'the whole node stays painted beyond the previous content bounds while the pointer is held');
  const heldView = await graph.getAttribute('viewBox'), heldPosition = await rejected.getAttribute('transform');
  await page.mouse.up();
  assert.equal(await graph.getAttribute('viewBox'), heldView, 'release must not refit or jump the view');
  assert.equal(await rejected.getAttribute('transform'), heldPosition);
  assert.equal(await zoomLabel.textContent(), initialZoom);
  await page.screenshot({ path: path.join(output, 'workflow-drag-beyond-bounds.png'), fullPage: true });
  // Holding at an edge keeps extending the world, without waiting for pointerup.
  const movedBox = await rejected.boundingBox();
  await page.mouse.move(movedBox.x + 30, movedBox.y + 20); await page.mouse.down();
  await page.mouse.move(clip.x + clip.width - 25, clip.y + clip.height - 60, { steps: 12 });
  const edgeView = (await graph.getAttribute('viewBox')).split(' ').map(Number);
  await page.waitForFunction(previous => {
    const box = document.querySelector('svg[aria-label="事项流程图"]').viewBox.baseVal;
    return box.x > previous[0] + 40 && box.y > previous[1] + 40;
  }, edgeView);
  await page.mouse.up();
  assert.equal(await zoomLabel.textContent(), initialZoom, 'edge panning keeps the scale');
  const savedPositions = await graph.locator('.workflow-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  // Blank-space panning and pointer-centred zoom change only the viewport.
  const blank = await graph.evaluate(svg => {
    const rect = svg.getBoundingClientRect();
    for (let y = rect.top + 50; y < rect.bottom - 50; y += 30) for (let x = rect.left + 50; x < rect.right - 50; x += 30) if (document.elementFromPoint(x, y) === svg) return { x, y };
    throw new Error('No blank canvas point for panning');
  });
  const beforePan = await graph.getAttribute('viewBox');
  await page.mouse.move(blank.x, blank.y); await page.mouse.down();
  await page.mouse.move(blank.x + 60, blank.y + 40, { steps: 8 }); await page.mouse.up();
  assert.notEqual(await graph.getAttribute('viewBox'), beforePan);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await page.waitForFunction(before => document.querySelector('[aria-label="画布缩放比例"]').textContent !== before, initialZoom);
  assert.deepEqual(await graph.locator('.workflow-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))), savedPositions);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await verifyCurves();
  for (const node of workflows.requirement.draft.nodes) if (!['planned', 'rejected'].includes(node.id)) node.x += 1000;
  Object.assign(workflows.requirement.draft.nodes.find(node => node.id === 'rejected'), { x: 56, y: 360 });
  await page.goto(origin + '/system?tab=workflows'); await graph.waitFor();
  for (const name of ['连线：重新打开，已拒绝 → 规划中', '连线：取消事项，规划中 → 已拒绝']) {
    const xs = await page.getByRole('button', { name, exact: true }).locator('.edge-line').evaluate(path => {
      const length = path.getTotalLength();
      return Array.from({ length: 21 }, (_, i) => path.getPointAtLength(length * i / 20).x);
    });
    assert.ok(Math.max(...xs) - Math.min(...xs) < .01, 'vertical transitions with different port counts stay straight');
  }
  await page.screenshot({ path: path.join(output, 'workflow-straight-vertical.png'), fullPage: true });
  // Negative world positions are editable and persist without the renderer moving them back to zero.
  const negativeNode = page.getByRole('button', { name: '规划中', exact: true });
  await negativeNode.focus();
  for (let i = 0; i < 3; i++) await negativeNode.press('Shift+ArrowLeft');
  assert.match(await negativeNode.getAttribute('transform'), /translate\(-56,/);
  await page.getByRole('button', { name: '保存流程草稿', exact: true }).click();
  await page.getByRole('button', { name: '保存流程草稿', exact: true, disabled: false }).waitFor();
  assert.equal(workflows.requirement.draft.nodes.find(node => node.id === 'planned').x, -56);
  await page.goto(origin + '/system?tab=workflows'); await graph.waitFor();
  assert.match(await negativeNode.getAttribute('transform'), /translate\(-56,/);
  // Restore the unsaved fixture so the existing editing and persistence checks start from its original layout.
  workflows.requirement.draft = defaultWorkflow('requirement');
  await page.goto(origin + '/system?tab=workflows'); await graph.waitFor();
  await verifyWorkflowFocus({ page, graph, output });
  const planned = page.getByRole('button', { name: '规划中', exact: true });
  await planned.click();
  await page.getByLabel('状态名称', { exact: true }).fill('画布内规划');
  await selectOption(page.getByLabel('处理职责', { exact: true }), 'reporter');
  await selectOption(page.getByLabel('工作类别', { exact: true }), 'planning');
  assert.equal(await page.locator('.workflow-canvas').getByLabel('状态名称', { exact: true }).count(), 1);
  const renamed = page.getByRole('button', { name: '画布内规划', exact: true });
  const previousPosition = await renamed.getAttribute('transform');
  await renamed.focus(); await renamed.press('ArrowDown');
  assert.notEqual(await renamed.getAttribute('transform'), previousPosition);
  await page.getByRole('button', { name: '全屏画布', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  assert.equal(await page.getByLabel('状态名称', { exact: true }).inputValue(), '画布内规划', 'fullscreen keeps the draft and selection');
  await renamed.press('Escape');
  await page.locator('.workflow-inspector').waitFor({ state: 'hidden' });
  await renamed.hover();
  // Closing the inspector refits the canvas; use a stable, actionable card position.
  await renamed.locator('.node-card').click({ trial: true });
  const beforeDrag = await renamed.getAttribute('transform'), dragBox = await renamed.locator('.node-card').boundingBox();
  const dragX = dragBox.x + dragBox.width / 2, dragY = dragBox.y + dragBox.height / 2;
  await page.mouse.move(dragX, dragY); await page.mouse.down();
  await page.mouse.move(dragX, dragY + 96, { steps: 8 }); await page.mouse.up();
  assert.notEqual(await renamed.getAttribute('transform'), beforeDrag, 'pointer dragging moves the state');
  const source = await page.getByRole('button', { name: '连接 画布内规划', exact: true }).boundingBox();
  const target = await page.getByRole('button', { name: '开发中', exact: true }).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x + target.width / 3, target.y + target.height / 2, { steps: 10 }); await page.mouse.up();
  await page.getByLabel('操作名称', { exact: true }).fill('画布连接');
  await page.getByLabel('必须填写原因', { exact: true }).check();
  await selectOption(page.getByLabel('所需权限', { exact: true }), 'issue.accept');
  await selectOption(page.getByLabel('流转必填资料', { exact: true }), ['acceptanceCriteria', 'qaOwnerId']);
  await page.getByLabel('必须已有通过验收的交付', { exact: true }).check();
  assert.equal(await graph.locator('.edge-line').count(), initialEdges + 1);
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
  assert.equal(await graph.locator('.workflow-node:not(.is-muted)').count(), 1, 'a new isolated state remains clear without inventing related neighbors');
  assert.equal(await graph.locator('.workflow-edge:not(.is-muted)').count(), 0);
  await selectOption(page.getByLabel('状态类型', { exact: true }), 'completed');
  assert.equal(await page.getByLabel('允许开始开发', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '删除状态', exact: true }).click();
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  assert.equal(await graph.locator('.workflow-node').count(), initialNodes + 1);
  await page.getByRole('button', { name: '删除状态', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  assert.equal(await graph.locator('.workflow-node').count(), initialNodes);
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
  assert.equal(await graph.locator('.edge-line').count(), initialEdges + 1);
  failSave = true;
  await page.getByRole('button', { name: '保存流程草稿', exact: true }).click();
  await page.getByText('流程已被其他管理员修改，请重新读取。', { exact: true }).waitFor();
  assert.equal(await graph.locator('.edge-line').count(), initialEdges + 1, 'save failure retains local edits');
  failSave = false; holdSave = true;
  const started = new Promise(resolve => { saveStarted = resolve; });
  await page.getByRole('button', { name: '保存流程草稿', exact: true }).click(); await started;
  assert.equal(await page.getByRole('group', { name: '流程类型', exact: true }).getByRole('button', { name: 'Bug 流程', exact: true }).isDisabled(), true);
  assert.equal(await graph.locator('.node-port').count(), 0, 'saving disables canvas connection handles');
  holdSave = false; releaseSave();
  await page.getByRole('button', { name: '保存流程草稿', exact: true, disabled: false }).waitFor();
  assert.equal(workflows.requirement.draft.transitions.at(-1).name, '画布连接');
  assert.equal(workflows.requirement.draft.transitions.at(-1).requiresReason, true);
  assert.equal(workflows.requirement.draft.transitions.at(-1).permission, 'issue.accept');
  assert.equal(writes.at(-1).definition.nodes[0].name, '画布内规划');
  assert.equal(writes.at(-1).definition.nodes[0].handler, 'reporter');
  assert.equal(writes.at(-1).definition.nodes[0].category, 'planning');
  assert.deepEqual(workflows.requirement.draft.transitions.at(-1).requiredFields, ['acceptanceCriteria', 'qaOwnerId']);
  assert.equal(workflows.requirement.draft.transitions.at(-1).requireAcceptedDelivery, true);
  await page.getByRole('group', { name: '流程类型', exact: true }).getByRole('button', { name: 'Bug 流程', exact: true }).click();
  await page.getByRole('button', { name: '待确认', exact: true }).waitFor();
  assert.equal(await page.getByLabel('状态名称', { exact: true }).count(), 0, 'type switch clears inline editor');
  await verifyCurves();
  await page.getByRole('button', { name: '待确认', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('很长的状态名称用于验证画布内编辑的窄屏换行和完整内容可访问性');
  await page.locator('.operation-message-close').evaluateAll(buttons => buttons.forEach(button => button.click()));
  for (const [width, height] of [[1920, 1080], [2560, 1440], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height });
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
