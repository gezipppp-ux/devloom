/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { SessionManager } = require('../../src/application/session-manager.cjs');
const { createWebServer } = require('../../src/http/server.cjs');
const { FakeClient } = require('../fixtures/web-client.cjs');
const { verifySessionFiles } = require('./session-files.cjs');
const { temporary, png } = require('../support/helpers.cjs');
const { ChannelRegistry } = require('../../src/channels/channel-registry.cjs');
const { createManualChannel } = require('../../src/channels/manual/adapter.cjs');
const { verifySessionImages } = require('./session-images.cjs');
const { verifySessionDeletion } = require('./session-deletion.cjs');
const { verifySessionArchiveTitle } = require('./session-archive-title.cjs');
const { verifyStartTaskLock } = require('./start-task.cjs');
const { verifySessionMarkdown } = require('./session-markdown.cjs');
const { verifySessionScroll } = require('./session-scroll.cjs');
const { verifyTapdFusion } = require('./tapd-fusion.cjs');

async function choosePermission(page, mode) {
  await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
  await page.locator(`.permission-option[data-value="${mode}"]`).click();
}

async function chooseSessionModel(page, model) {
  await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).click();
  await page.locator(`.model-option[data-model="${model}"]`).click();
}

async function chooseSessionEffort(page, effort) {
  await page.getByRole('combobox', { name: '思考强度', exact: true }).click();
  await page.locator(`.effort-option[data-effort="${effort}"]`).click();
}

async function sessionModel(page) {
  return page
    .getByRole('combobox', { name: 'Codex 模型', exact: true })
    .getAttribute('data-model');
}

async function sessionEffort(page) {
  return page
    .getByRole('combobox', { name: '思考强度', exact: true })
    .getAttribute('data-effort');
}

async function verifyLanManualCreation(browser, directory, errors) {
  const address = Object.values(os.networkInterfaces()).flat().find((entry) =>
    entry.family === 'IPv4' && !entry.internal)?.address;
  if (!address) {
    process.stdout.write('LAN browser regression skipped: no non-loopback IPv4 interface.\n');
    return;
  }
  const configFile = path.join(directory, 'lan-missing.json');
  const manual = createManualChannel(configFile, { uploadDirectory: path.join(directory, 'lan-uploads') });
  const client = new FakeClient();
  const manager = new SessionManager({
    store: new RunStore(path.join(directory, 'lan-runs')), client,
    channels: new ChannelRegistry([manual]),
  });
  const submitted = [];
  manager.start = async (input) => {
    // Exercise the real manual UUID validator, but never dispatch a task.
    const resolved = await manual.resolve(input);
    submitted.push({ input, id: resolved.item.id });
    throw new Error('局域网模拟请求已校验，未执行任务');
  };
  const application = createWebServer({ host: '0.0.0.0', manager, configFile, testIdentity: true });
  await application.listen(0);
  const origin = `http://${address}:${application.server.address().port}`;
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin);
    assert.deepEqual(await page.evaluate(() => ({
      secure: window.isSecureContext,
      randomUUID: typeof window.crypto.randomUUID,
      getRandomValues: typeof window.crypto.getRandomValues,
    })), { secure: false, randomUUID: 'undefined', getRandomValues: 'function' });
    async function openManual() {
      await page.getByRole('button', { name: '＋ 从需求启动', exact: true }).click();
      await page.getByLabel('需求渠道', { exact: true }).selectOption('manual');
      await page.getByLabel('需求标题', { exact: true }).fill('LAN HTTP 手动需求');
      await page.getByLabel('需求内容', { exact: true }).fill('仅校验请求标识，不启动真实任务。');
    }
    async function submit() {
      const response = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/runs' && response.request().method() === 'POST');
      await page.getByRole('button', { name: '创建 session 并开始开发 →', exact: true }).click();
      assert.equal((await response).status(), 400);
      await page.getByText('局域网模拟请求已校验，未执行任务', { exact: true }).waitFor();
    }
    await openManual();
    await submit();
    await submit();
    assert.equal(submitted.length, 2);
    assert.match(submitted[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(submitted[0].id, submitted[1].id, 'retry keeps the same request identity');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await openManual();
    await submit();
    assert.equal(submitted.length, 3);
    assert.notEqual(submitted[0].id, submitted[2].id, 'a new form receives a new request identity');
    assert.equal(client.calls.some(({ method }) =>
      ['thread/start', 'thread/resume', 'turn/start', 'turn/steer', 'turn/interrupt'].includes(method)), false);
    process.stdout.write('LAN insecure-context passed: UUID creation, request validation, retry and new-form identity.\n');
  } finally {
    await page.close();
    await application.close();
  }
}

async function verifyPermissionDiscoveryFailures(browser, origin, client, errors) {
  const callsBefore = client.calls.length;
  const writes = [];
  for (const surface of ['session', 'create']) {
    const page = await browser.newPage();
    let responseMode = 'missing';
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST') writes.push(request.url());
    });
    await page.route('**/api/execution-options', (route) => route.fulfill({
      status: responseMode === 'missing' ? 404 : 200,
      json: responseMode === 'missing'
        ? { error: '接口不存在' }
        : responseMode === 'malformed'
          ? { permissionModes: { auto: true } }
          : { permissionModes: ['ask', 'auto', 'full'].map((id) => ({ id, available: true })) },
    }));
    const alert = page.getByRole('alert').filter({ hasText: '权限选项加载失败' });
    async function verifyOptions(autoAvailable) {
      await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
      const automatic = page.locator('.permission-option[data-value="auto"]');
      await automatic.waitFor();
      assert.equal(await automatic.isDisabled(), !autoAvailable, surface);
      for (const mode of ['ask', 'full'])
        assert.equal(await page.locator(`.permission-option[data-value="${mode}"]`).isDisabled(), false, surface);
      await page.keyboard.press('Escape');
    }
    try {
      await page.goto(origin);
      await page.getByText('历史回复', { exact: true }).waitFor();
      if (surface === 'create') {
        await page.getByRole('button', { name: '＋ 从需求启动', exact: true }).click();
        await page.getByLabel('需求渠道', { exact: true }).selectOption('manual');
        await page.getByLabel('需求标题', { exact: true }).fill('权限发现失败时保留草稿');
      }
      await alert.waitFor();
      assert.match(await alert.textContent(), /HTTP 404/);
      assert.match(await alert.textContent(), /当前服务缺少权限接口，请重启 Web 服务并刷新页面/);
      await verifyOptions(false);

      responseMode = 'supported';
      await alert.getByRole('button', { name: '刷新权限选项', exact: true }).click();
      await alert.waitFor({ state: 'hidden' });
      await verifyOptions(true);

      responseMode = 'malformed';
      await page.getByRole('combobox', { name: '权限模式', exact: true }).click();
      await page.locator('.permission-menu').getByRole('button', { name: '刷新权限选项', exact: true }).click();
      await alert.waitFor();
      assert.match(await alert.textContent(), /权限选项响应格式无效/);
      assert.doesNotMatch(await alert.textContent(), /当前服务缺少权限接口/);
      await page.keyboard.press('Escape');
      await verifyOptions(false);
      assert.equal(await page.getByRole('combobox', { name: '权限模式', exact: true }).getAttribute('data-permission'), 'ask');
      if (surface === 'create')
        assert.equal(await page.getByLabel('需求标题', { exact: true }).inputValue(), '权限发现失败时保留草稿');
    } finally {
      await page.close();
    }
  }
  assert.deepEqual(writes, [], 'permission discovery and refresh must not save settings or start tasks');
  assert.equal(client.calls.slice(callsBefore).some(({ method }) =>
    ['thread/start', 'thread/resume', 'turn/start', 'turn/steer', 'turn/interrupt'].includes(method)), false,
  'permission discovery must not execute or resume a Codex turn');
}

async function verifyExecutionSettings(browser, origin, manager, client, key, errors) {
  if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const peer = await browser.newPage();
  for (const entry of [page, peer]) entry.on('pageerror', (error) => errors.push(error.message));
  const endpoint = `/api/runs/${key}/execution-settings`;
  async function save(action) {
    const response = page.waitForResponse((response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'POST');
    await action();
    const saved = await response;
    assert.equal(saved.status(), 200, await saved.text());
  }
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    await save(() => chooseSessionModel(page, 'fixture-model-a'));
    await save(() => chooseSessionEffort(page, 'high'));
    await save(() => choosePermission(page, 'auto'));
    await peer.goto(origin);
    await peer.getByText('历史回复', { exact: true }).waitFor();
    assert.equal(await sessionModel(peer), 'fixture-model-a');
    const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
    await input.fill('设置浏览器回归第一轮');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
    const first = structuredClone(client.calls.findLast((call) => call.method === 'turn/start'));
    assert.equal(first.params.model, 'fixture-model-a');
    assert.equal(first.params.effort, 'high');
    assert.equal(first.params.approvalsReviewer, 'auto_review');
    await input.fill('保留尚未发送的草稿');
    await save(() => chooseSessionModel(page, 'fixture-model-b'));
    await save(() => chooseSessionEffort(page, 'medium'));
    await save(() => choosePermission(page, 'full'));
    await page.getByText(/下一轮生效/).first().waitFor();
    await peer.waitForFunction(() =>
      document.querySelector('[role="combobox"][aria-label="Codex 模型"]')?.dataset.model === 'fixture-model-b');
    assert.equal(await input.inputValue(), '保留尚未发送的草稿');
    assert.deepEqual(client.calls.find((call) => call.method === 'turn/start' && call.params.input[0].text === '设置浏览器回归第一轮'), first);
    await page.getByRole('button', { name: '补充指令 ↑', exact: true }).click();
    await page.getByText('补充指令已发送至当前一轮。', { exact: true }).waitFor();
    assert.equal(client.calls.findLast((call) => call.method === 'turn/steer').params.model, undefined);

    await page.route(`**${endpoint}`, (route) => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ error: '模拟执行设置保存失败' }),
    }));
    await chooseSessionModel(page, 'fixture-model-a');
    await page.getByText(/模拟执行设置保存失败/).waitFor();
    assert.equal(await sessionModel(page), 'fixture-model-b');
    assert.equal(await sessionEffort(page), 'medium');
    await page.unroute(`**${endpoint}`);
    await page.reload();
    await page.getByText('历史回复', { exact: true }).waitFor();
    assert.equal(await sessionModel(page), 'fixture-model-b');
    await page.getByText(/下一轮生效/).first().waitFor();
    await page.getByRole('button', { name: '■ 停止', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor({ state: 'hidden' });
    await input.fill('设置浏览器回归第二轮');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
    const second = client.calls.findLast((call) => call.method === 'turn/start');
    assert.equal(second.params.threadId, first.params.threadId);
    assert.equal(second.params.model, 'fixture-model-b');
    assert.equal(second.params.effort, 'medium');
    assert.equal(second.params.approvalPolicy, 'never');
    assert.deepEqual(second.params.sandboxPolicy, { type: 'dangerFullAccess' });
    await page.waitForFunction(() => !document.querySelector('.composer-toolbar')?.textContent.includes('下一轮生效'));
  } finally {
    await page.close();
    await peer.close();
    if (manager.sessions.get(key)?.turnId) await manager.interrupt(key);
    await manager.updateExecutionSettings(key, { model: '', reasoningEffort: '', permissionMode: 'ask' });
  }
}

async function verifyInitialListRefresh(browser, origin, manager, key, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const previousMetadata = manager.store.readTaskMetadata(key);
  const progress = previousMetadata.progress === 'review' ? 'merge' : 'review';
  const snapshots = [];
  let captureFirst, captureSecond;
  const firstCaptured = new Promise((resolve) => { captureFirst = resolve; });
  const secondCaptured = new Promise((resolve) => { captureSecond = resolve; });
  await page.route('**/api/runs', async (route) => {
    const response = await route.fetch();
    const snapshot = { route, response };
    snapshots.push(snapshot);
    if (snapshots.length === 1) captureFirst(snapshot);
    else if (snapshots.length === 2) captureSecond(snapshot);
    else await route.fulfill({ response });
  });
  try {
    await page.goto(origin);
    const first = await firstCaptured;
    await page.waitForFunction(() =>
      document.querySelector('.sidebar-footer')?.textContent.includes('服务已连接'));
    manager.updateTaskMetadata(key, { progress });
    // Keep the first list pending beyond the 400 ms SSE refresh debounce. The
    // connection stays subscribed, but cannot invalidate the startup decision.
    await page.waitForTimeout(650);
    assert.equal(snapshots.length, 1,
      'SSE must not supersede the initial list before choosing a session');
    const queuedRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === '/api/runs');
    await first.route.fulfill({ response: first.response });
    await page.getByText('历史回复', { exact: true }).waitFor();
    assert.equal(await page.locator('.session-header').count(), 1);
    assert.equal(await page.getByLabel('任务进度', { exact: true }).inputValue(), progress);
    assert.equal(await page.locator('.session-link.active .task-progress-tag')
      .getAttribute('data-progress'), progress);
    await queuedRequest;
    const second = await secondCaptured;
    await second.route.fulfill({ response: second.response });
    assert.equal(snapshots.length, 2, 'refresh queued during startup must still run');
  } finally {
    await page.close();
    manager.updateTaskMetadata(key, previousMetadata);
  }
}

async function verifyUnreadResults(browser, origin, manager, key, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().grantPermissions(['notifications'], { origin });
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();

    await page.locator('.session-link').filter({
      hasText: '修复登录异常',
    }).click();
    await page.locator('.session-link.active').filter({
      hasText: '修复登录异常',
    }).waitFor();
    const runtime = manager.runtime(key, 'original');
    runtime.status = 'completed';
    runtime.turnId = null;
    manager.publish(runtime, { type: 'state' });

    const completedTask = page.locator('.session-link').filter({
      hasText: '【演示】套餐充值入口',
    });
    await completedTask.locator('.unread-result').waitFor();

    await completedTask.click();
    await page.getByText('历史回复', { exact: true }).waitFor();
    await completedTask.locator('.unread-result').waitFor({ state: 'hidden' });
  } finally {
    await page.close();
  }
}

async function verifyActionSelection(browser, origin, key, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.processedMessages = [];
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const result = await originalJson();
        const marker = response.headers.get('x-fixture-message');
        if (marker) window.setTimeout(() => window.processedMessages.push(marker), 0);
        return result;
      };
      return response;
    };
  });
  const captures = [];
  // Fulfill these requests locally: no turn is sent to even the fake client.
  await page.route(`**/api/runs/${key}/messages`, (route) => captures.shift()(route));
  const hold = () => new Promise((resolve) => captures.push(resolve));
  async function release(route, marker, status = 202) {
    await route.fulfill({ status, headers: { 'x-fixture-message': marker },
      json: status === 202 ? { accepted: true } : { error: '过期会话动作错误' } });
    await page.waitForFunction((value) => window.processedMessages.includes(value), marker);
  }
  async function reopen() {
    await page.locator('.session-header').getByRole('button', { name: '刷新', exact: true }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('textarea[aria-label="发送给 Codex 的指令"]');
      return input && !input.disabled;
    });
  }
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
    const send = page.getByRole('button', { name: '发送 ↑', exact: true });
    await input.fill('旧视图发送');
    const first = hold();
    await send.click();
    const oldRequest = await first;
    await reopen();
    await input.fill('重新打开后发送的指令');
    const second = hold();
    await send.click();
    const newRequest = await second;
    await release(oldRequest, 'old-success');
    assert.equal(await input.inputValue(), '重新打开后发送的指令');
    assert.equal(await input.isDisabled(), true, 'old actions must not clear the new action busy state');
    await release(newRequest, 'new-success');
    assert.equal(await input.inputValue(), '');
    assert.equal(await input.isEnabled(), true);

    await input.fill('旧视图失败的指令');
    const third = hold();
    await send.click();
    const failedRequest = await third;
    await reopen();
    await input.fill('保留新草稿');
    await release(failedRequest, 'old-failure', 400);
    assert.equal(await input.inputValue(), '保留新草稿');
    assert.equal(await page.getByText('过期会话动作错误', { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
}

async function verifyRefreshConsistency(browser, origin, manager, client, key, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  // A marker is set after fetch/JSON continuations and Vue's update microtasks,
  // so assertions cannot pass before a released response has been processed.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.processedSnapshots = [];
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const originalJson = response.json.bind(response);
      response.json = async () => {
        const result = await originalJson();
        const marker = response.headers.get('x-fixture-snapshot');
        if (marker)
          window.setTimeout(() => window.processedSnapshots.push(marker), 0);
        return result;
      };
      return response;
    };
  });
  const pattern = `**/api/runs/${key}`;
  const captures = [];
  // Removing the last route handler disables interception and releases older
  // paused requests too. Keep one handler installed until this page closes.
  await page.route(pattern, async (route) => {
    const capture = captures.shift();
    if (!capture) return route.continue();
    const response = await route.fetch();
    capture({ route, response, body: await response.json() });
  });
  async function holdNextView() {
    const captured = new Promise((resolve) => captures.push(resolve));
    return { captured };
  }
  async function release(snapshot, marker) {
    await snapshot.route.fulfill({
      response: snapshot.response,
      headers: { ...snapshot.response.headers(), 'x-fixture-snapshot': marker },
      json: snapshot.body,
    });
    await page.waitForFunction(
      (value) => window.processedSnapshots.includes(value),
      marker,
    );
  }
  try {
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    const runtime = manager.sessions.get(key);
    const first = await holdNextView();
    runtime.status = 'running';
    runtime.turnId = 'refresh-race';
    manager.publish(runtime, { type: 'state' });
    const olderSnapshot = await first.captured;
    assert.equal(olderSnapshot.body.status, 'running');
    const second = await holdNextView();
    runtime.status = 'completed';
    runtime.turnId = null;
    manager.publish(runtime, { type: 'state' });
    await release(await second.captured, 'newer-state');
    await release(olderSnapshot, 'older-state');
    assert.equal(await page.locator('.session-header .status').textContent(), 'Codex · 本轮结束');
    assert.equal(await page.getByRole('button', { name: '■ 停止', exact: true }).count(), 0);

    const historyCursors = [];
    await page.route(`**/api/runs/${key}/history?*`, async (route) => {
      historyCursors.push(new URL(route.request().url()).searchParams.get('cursor'));
      await route.fulfill({ json: {
        items: [{ id: 'previous-page', type: 'agentMessage', text: '更早的分页记录' }],
        nextCursor: historyCursors.length === 1 ? 'oldest-fixture' : null,
      } });
    });
    await page.getByRole('button', { name: '加载更早记录 ↑', exact: true }).click();
    await page.getByText('更早的分页记录', { exact: true }).waitFor();
    client.notify('item/agentMessage/delta', {
      turnId: 'refresh-race', itemId: 'refresh-stream', delta: '旧流式消息',
    });
    await page.getByText('旧流式消息', { exact: true }).waitFor();
    const stream = await holdNextView();
    manager.publish(runtime, { type: 'notice', text: '验证流式消息刷新' });
    const streamSnapshot = await stream.captured;
    // These events do not schedule another HTTP refresh. They must overlay the
    // response, rather than relying solely on rejecting an older request ID.
    client.notify('item/agentMessage/delta', {
      turnId: 'refresh-race', itemId: 'refresh-stream', delta: '，保留最新内容',
    });
    client.notify('item/agentMessage/delta', {
      turnId: 'refresh-race', itemId: 'refresh-new', delta: '请求期间新增的消息',
    });
    manager.updateTaskMetadata(key, { progress: 'review' });
    await page.getByText('旧流式消息，保留最新内容', { exact: true }).waitFor();
    await page.waitForFunction(() =>
      document.querySelector('select[aria-label="任务进度"]').value === 'review');
    await release(streamSnapshot, 'stream-overlay');
    assert.equal(await page.locator('.session-header .session-heading').textContent(), manager.list().find((run) => run.key === key).title);
    assert.equal(await page.getByText('旧流式消息，保留最新内容', { exact: true }).count(), 1);
    assert.equal(await page.getByText('请求期间新增的消息', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('任务进度', { exact: true }).inputValue(), 'review');
    assert.equal(await page.getByText('更早的分页记录', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '加载更早记录 ↑', exact: true }).click();
    await page.getByRole('button', { name: '加载更早记录 ↑', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(historyCursors, ['older', 'oldest-fixture']);

    const approval = await holdNextView();
    client.emit('request', {
      id: 9042,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'original', command: 'fixture command', reason: '模拟审批竞态' },
    });
    const approvalSnapshot = await approval.captured;
    assert.equal(approvalSnapshot.body.requests.length, 1);
    await manager.respond(key, '9042', { decision: 'decline' });
    await page.getByRole('button', { name: '允许本次操作', exact: true }).waitFor({ state: 'hidden' });
    await release(approvalSnapshot, 'resolved-approval');
    assert.equal(await page.getByRole('button', { name: '允许本次操作', exact: true }).count(), 0);

    const settings = await holdNextView();
    manager.publish(runtime, { type: 'notice', text: '验证设置快照刷新' });
    const settingsSnapshot = await settings.captured;
    await manager.updateExecutionSettings(key, {
      model: 'fixture-model-b', reasoningEffort: 'medium', permissionMode: 'full',
    });
    await page.waitForFunction(() =>
      document.querySelector('[role="combobox"][aria-label="Codex 模型"]')?.dataset.model === 'fixture-model-b');
    await release(settingsSnapshot, 'settings-overlay');
    assert.equal(await sessionModel(page), 'fixture-model-b');
    assert.equal(await sessionEffort(page), 'medium');
    const previousMetadata = manager.store.readTaskMetadata(key);
    const requestedType = previousMetadata.type === 'bug' ? 'other' : 'bug';
    let captureMetadata;
    const metadataCaptured = new Promise((resolve) => { captureMetadata = resolve; });
    await page.route(`**/api/runs/${key}/metadata`, async (route) => {
      const response = await route.fetch();
      captureMetadata({ route, response, body: await response.json() });
    });
    await page.getByRole('button', { name: '会话信息', exact: true }).click();
    await page.getByLabel('任务类型', { exact: true }).selectOption(requestedType);
    const metadataSnapshot = await metadataCaptured;
    manager.updateTaskMetadata(key, { type: 'requirement', progress: 'merge' });
    await page.waitForFunction(() =>
      document.querySelector('select[aria-label="任务进度"]')?.value === 'merge');
    await release(metadataSnapshot, 'older-metadata-save');
    assert.equal(await page.getByLabel('任务类型', { exact: true }).inputValue(), 'requirement');
    assert.equal(await page.getByLabel('任务进度', { exact: true }).inputValue(), 'merge');
    assert.equal(await page.locator('.session-link.active .task-type-tag').getAttribute('data-type'), 'requirement');
    manager.updateTaskMetadata(key, previousMetadata);
  } finally {
    await page.close();
  }
}

async function main() {
  const cleanup = [];
  const directory = temporary({ after: (callback) => cleanup.push(callback) });
  const store = new RunStore(directory),
    key = '1-2';
  fs.mkdirSync(store.dir(key));
  const requirementFixture = {
    generated_at: '2026-09-17T00:00:00Z',
    workitem: {
      id: '2',
      title: '需求正文测试',
      detail_url: 'https://example.com/requirements/2',
      description:
        '<h2>完整需求标题</h2><p>第一段完整需求文字</p><ul><li>验收标准一</li></ul><table><tr><td>表格内容</td></tr></table><img src="https://blocked.invalid/download.png" onerror="window.requirementXss=1"><img src="https://blocked.invalid/unknown.png"><a href="javascript:window.requirementXss=1">危险链接</a><script>window.requirementXss=1</script><iframe src="https://blocked.invalid/frame"></iframe><p>正文末尾</p>',
      supplementary_instructions:
        '补充需求说明：保留现有支付流程。\n指导意见：先检查边界情况。\n<script>window.supplementXss=1</script>\n<img src="https://blocked.invalid/supplement.png" onerror="window.supplementXss=1">',
    },
    images: [
      {
        source: 'https://blocked.invalid/download.png',
        path: path.join(store.dir(key), 'fixture.png'),
      },
    ],
    codex_prompt:
      '完整提示词：<script>window.requirementXss=1</script>\n提示词末尾',
  };
  fs.writeFileSync(path.join(store.dir(key), 'fixture.png'), png);
  fs.writeFileSync(
    path.join(store.dir(key), 'tapd-task.json'),
    JSON.stringify(requirementFixture),
  );
  fs.writeFileSync(
    path.join(store.dir(key), 'run.json'),
    JSON.stringify({
      workitem: { title: '【演示】套餐充值入口', id: '2', workspace_id: '1' },
      session_id: 'original',
      worktree: {
        path: directory,
        branch: 'codex/a1b2c3d4e5f6',
      },
      execution: { status: 'completed' },
      initialization: {
        status: 'completed',
        commands: [
          {
            command: 'pnpm install',
            status: 'completed',
            exit_code: 0,
            output: '初始化依赖安装完成',
          },
        ],
      },
      transition: { status: 'succeeded' },
    }),
  );
  for (const [otherKey, title, type, progress] of [
    ['1-3', '修复登录异常', 'bug', 'review'],
    ['1-4', '整理项目文档', 'other', 'merge'],
  ]) {
    fs.mkdirSync(store.dir(otherKey));
    fs.writeFileSync(path.join(store.dir(otherKey), 'run.json'), JSON.stringify({
      workitem: { title, id: otherKey.slice(2), workspace_id: '1' },
      execution: { status: 'completed' },
      updated_at: '2025-01-01T00:00:00Z',
    }));
    store.writeTaskMetadata(otherKey, { type, progress });
  }
  const client = new FakeClient(),
    manager = new SessionManager({ store, client, worktreeReason: () => null });
  const searches = [];
  const manualChannel = createManualChannel(
    path.join(directory, 'missing.json'),
    { uploadDirectory: path.join(directory, 'uploads') },
  );
  manager.channels = new ChannelRegistry([
    {
      id: 'tapd',
      capabilities: { search: true, assignees: false },
      describe: () => ({
        id: 'tapd',
        label: 'TAPD',
        workspace: '1',
        scopeLabel: 'TAPD 工作区 ID',
        capabilities: { search: true, assignees: false },
      }),
      resolve: async () => {},
      prepare: async () => {},
      transition: async () => {},
      search: async () => [
        { id: '2', title: '模拟需求', workspace: '1', type: 'story' },
        { id: '5', title: '模拟缺陷', workspace: '1', type: 'bug' },
      ],
      searchUsers: async ({ query, workspace }) => {
        searches.push({ query, workspace });
        if (query === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 700));
          return [{ id: 'stale', nick: '过期结果' }];
        }
        if (query === 'none') return [];
        if (query === 'error') throw new Error('模拟搜索失败');
        return query === 'liu'
          ? [{ id: 'tester', nick: '刘嘉辉', name: '测试' }]
          : [{ id: 'dev', nick: '魏文斌1', name: '开发' }];
      },
    },
    manualChannel,
  ]);
  let submitted;
  let tapdFailure = true;
  let manualFailure = true;
  manager.start = async (input) => {
    submitted = input;
    if (input.channel === 'tapd' && tapdFailure) {
      tapdFailure = false;
      throw new Error('模拟 TAPD 启动失败，请重试');
    }
    if (input.channel === 'manual') {
      await manualChannel.resolve(input);
      if (manualFailure) {
        manualFailure = false;
        throw new Error('模拟启动失败，请重试');
      }
    }
    return { key, accepted: true };
  };
  const application = createWebServer({
    testIdentity: true,
    manager,
    configFile: path.join(directory, 'missing.json'),
  });
  const origin = await application.listen(0);
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : process.platform === 'win32'
          ? { channel: 'msedge' }
          : {}),
      headless: true,
    });
    const browserContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await browserContext.newPage();
    const errors = [];
    const externalRequests = [];
    await page.route('https://blocked.invalid/**', async (route) => {
      externalRequests.push(route.request().url());
      await route.abort();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByText('历史回复', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('任务类型', { exact: true }).inputValue(), 'requirement');
    assert.equal(await page.getByLabel('任务进度', { exact: true }).inputValue(), 'in_progress');
    assert.equal(await page.locator('.task-group > summary').count(), 3);
    await page.getByLabel('任务分组方式').selectOption('progress');
    await page.getByRole('button', { name: '会话信息', exact: true }).click();
    await page.getByLabel('任务类型', { exact: true }).selectOption('bug');
    await page.waitForFunction(() => document.querySelector('select[aria-label="任务类型"]').value === 'bug');
    const peer = await page.context().newPage();
    await peer.goto(origin);
    await peer.getByText('历史回复', { exact: true }).waitFor();
    await page.getByLabel('任务进度', { exact: true }).selectOption('review');
    await peer.waitForFunction(() => document.querySelector('select[aria-label="任务进度"]').value === 'review');
    assert.equal(await page.locator('.session-header .status').textContent(), 'Codex · 本轮结束');
    assert.equal(await page.locator('.task-group > summary').count(), 2);
    await page.route('**/runs/1-2/metadata', route => route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'模拟进度保存失败'})}));
    await page.getByLabel('任务进度', { exact: true }).selectOption('done');
    await page.getByText('模拟进度保存失败', {exact:true}).waitFor();
    assert.equal(await page.getByLabel('任务进度', {exact:true}).inputValue(), 'review');
    assert.equal(store.readTaskMetadata(key).progress, 'review');
    await page.unroute('**/runs/1-2/metadata');
    for (const value of ['merge', 'done', 'on_hold']) {
      await page.getByLabel('任务进度', { exact: true }).selectOption(value);
      await page.waitForFunction(value => document.querySelector('select[aria-label="任务进度"]').value === value, value);
    }
    await peer.close();
    await page.reload();
    await page.getByText('历史回复', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('任务进度', { exact: true }).inputValue(), 'on_hold');
    assert.equal(await page.getByLabel('任务分组方式').inputValue(), 'progress');
    await page.getByLabel('任务分组方式').selectOption('type');
    const bugSummary = page.locator('.task-group > summary').filter({hasText:'Bug'});
    await bugSummary.click();
    assert.equal(await page.locator('.session-link').filter({hasText:'【演示】套餐充值入口'}).isVisible(), false);
    await bugSummary.click();
    assert.equal(await page.locator('.session-link').filter({hasText:'【演示】套餐充值入口'}).isVisible(), true);
    await page.getByLabel('任务分组方式').selectOption('none');
    assert.equal(await page.locator('.session-link:visible').count(), 3);
    await page.getByLabel('任务分组方式').selectOption('progress');
    fs.mkdirSync(path.resolve('state/browser'), {recursive:true});
    await page.screenshot({path:path.resolve('state/browser/task-progress-groups.png'),fullPage:true});

    await page.getByRole('button', { name: '修改会话标题', exact: true }).click();
    await page.getByLabel('会话标题', { exact: true }).fill('套餐充值入口（已重命名）');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.session-header .session-heading').getByText('套餐充值入口（已重命名）', { exact: true }).waitFor();
    await page.locator('.session-link.active').getByText('套餐充值入口（已重命名）', { exact: true }).waitFor();
    await page.reload();
    await page.locator('.session-header .session-heading').getByText('套餐充值入口（已重命名）', { exact: true }).waitFor();
    assert.equal(store.read('1-2').workitem.title, '【演示】套餐充值入口');
    await page.getByRole('button', { name: '会话信息', exact: true }).click();
    await page.getByRole('button', { name: '归档会话', exact: true }).click();
    await page.getByRole('heading', { name: '归档会话', exact: true }).waitFor();
    await page.getByText('归档后会话不再显示在左侧列表中，可从「已归档会话」恢复。历史、需求资料和 Worktree 保留。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '永久删除会话', exact: true }).click();
    await page.getByText('此会话仍有关联代码。可先在 Git 面板清理，或在下方选择强制删除。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '修改会话标题', exact: true }).click();
    await page.getByLabel('会话标题', { exact: true }).fill('【演示】套餐充值入口');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.session-header .session-heading').getByText('【演示】套餐充值入口', { exact: true }).waitFor();

    await page.getByRole('button', { name: '需求资料', exact: true }).click();
    await page
      .getByRole('heading', { name: '完整需求标题', exact: true })
      .waitFor();
    await page.getByText('正文末尾', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.requirement-body img[src]').getAttribute('src'),
      '/api/runs/1-2/images/0',
    );
    assert.equal(
      await page
        .locator(
          '.requirement-body script, .requirement-body iframe, .requirement-body [onerror], .requirement-body a[href^="javascript:"]',
        )
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.requirementXss), undefined);
    assert.equal(
      await page.locator('.requirement-supplement pre').textContent(),
      requirementFixture.workitem.supplementary_instructions,
    );
    assert.equal(await page.locator('.requirement-supplement script, .requirement-supplement img').count(), 0);
    assert.equal(await page.evaluate(() => window.supplementXss), undefined);
    await page.getByText('发送给 Codex 的完整内容', { exact: true }).click();
    assert.equal(
      await page.locator('.requirement-prompt pre').textContent(),
      requirementFixture.codex_prompt,
    );
    fs.writeFileSync(
      path.join(store.dir(key), 'requirement.json'),
      JSON.stringify({
        ...requirementFixture,
        workitem: {
          ...requirementFixture.workitem,
          markdown_description:
            '# Markdown 需求\n\n- Markdown 验收项\n\n![本地图片](https://blocked.invalid/download.png)\n\nMarkdown 正文末尾',
        },
      }),
    );
    await page.reload();
    await page.getByRole('button', { name: '需求资料', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Markdown 需求', exact: true })
      .waitFor();
    await page.getByText('Markdown 正文末尾', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.requirement-supplement pre').textContent(),
      requirementFixture.workitem.supplementary_instructions,
    );
    assert.equal(
      await page.locator('.requirement-body img').getAttribute('src'),
      '/api/runs/1-2/images/0',
    );
    assert.deepEqual(externalRequests, []);
    await page.getByRole('button', { name: '需求资料', exact: true }).click();
    await page.getByText('工作区初始化', { exact: true }).click();
    await page.getByText('初始化依赖安装完成', { exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
    await input.fill('检查充值入口');
    await input.press('Shift+Enter');
    await input.pressSequentially('并补充测试');
    assert.equal(await input.inputValue(), '检查充值入口\n并补充测试');
    for (const guard of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }])
      await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ...guard });
    assert.equal(client.calls.filter((call) => call.method === 'turn/start').length, 0,
      'newlines, IME confirmation and held Enter must not send');
    assert.equal(await input.inputValue(), '检查充值入口\n并补充测试');
    await input.press('Enter');
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
    const keyboardTurns = client.calls.filter((call) => call.method === 'turn/start');
    assert.equal(keyboardTurns.length, 1, 'Enter sends exactly one message');
    assert.equal(keyboardTurns[0].params.input[0].text, '检查充值入口\n并补充测试');
    client.notify('item/agentMessage/delta', {
      turnId: 'turn-1',
      itemId: 'reply',
      delta: '我会先检查入口与已有测试，再修改套餐卡片展示。',
    });
    client.notify('item/commandExecution/outputDelta', {
      turnId: 'turn-1',
      itemId: 'command',
      delta: '✓ 套餐卡片展示测试通过\n✓ 充值入口状态测试通过',
    });
    await page
      .getByText('我会先检查入口与已有测试，再修改套餐卡片展示。', {
        exact: true,
      })
      .waitFor();
    await input.fill('保留现有支付流程');
    await input.press('Enter');
    await page
      .getByText('补充指令已发送至当前一轮。', { exact: true })
      .waitFor();
    assert.ok(client.calls.some((call) => call.method === 'turn/steer'));
    client.emit('request', {
      id: 40,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'original',
        command: 'pnpm test',
        reason: '运行当前工作区的测试',
      },
    });
    await page
      .getByRole('button', { name: '允许本次操作', exact: true })
      .click();
    await page
      .getByRole('button', { name: '允许本次操作', exact: true })
      .waitFor({ state: 'hidden' });
    assert.ok(
      client.calls.some(
        (call) => call.response === 40 && call.result.decision === 'accept',
      ),
    );
    client.emit('request', {
      id: 41,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'original',
        questions: [
          {
            id: 'scope',
            question: '选择测试范围',
            options: [{ label: '充值模块', description: '运行模块测试' }],
          },
        ],
      },
    });
    await page.getByRole('button', { name: '充值模块', exact: true }).click();
    await page.getByRole('button', { name: '提交回答', exact: true }).click();
    await page
      .getByRole('button', { name: '提交回答', exact: true })
      .waitFor({ state: 'hidden' });
    assert.ok(
      client.calls.some(
        (call) =>
          call.response === 41 &&
          call.result.answers.scope.answers[0] === '充值模块',
      ),
    );
    await page.getByRole('button', { name: '■ 停止', exact: true }).click();
    await page
      .getByRole('button', { name: '■ 停止', exact: true })
      .waitFor({ state: 'hidden' });
    await input.fill('继续执行');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
    assert.equal(
      client.calls.filter((call) => call.method === 'turn/start').length,
      2,
    );
    assert.ok(
      client.calls
        .filter((call) => call.method === 'turn/start')
        .every((call) => call.params.threadId === 'original'),
    );
    await page.reload();
    await page
      .getByText('我会先检查入口与已有测试，再修改套餐卡片展示。', {
        exact: true,
      })
      .waitFor();
    const output = path.resolve(__dirname, '../../state/browser');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: path.join(output, 'desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(output, 'mobile.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page
      .getByRole('button', { name: '＋ 从需求启动', exact: true })
      .click();
    await page.getByRole('textbox', { name: '需求 ID', exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '开发人员', exact: true }).count(), 0);
    assert.equal(await page.getByRole('combobox', { name: '测试人员', exact: true }).count(), 0);
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await page.locator('.search-results').getByText('本系统已有任务', { exact: true }).waitFor();
    assert.equal(await page.locator('.search-results').getByText('本系统进行中', { exact: true }).count(), 0);
    manager.updateTaskMetadata(key, { progress: 'in_progress' });
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await page.locator('.search-results').getByText('本系统进行中', { exact: true }).waitFor();
    await page.getByRole('button', { name: /模拟缺陷/ }).click();
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const supplement = page.getByRole('textbox', { name: '补充说明', exact: true });
    const supplementaryInstructions = '  补充说明：保留现有支付流程。\n指导意见：覆盖空数据和网络错误。  ';
    assert.equal(await supplement.getAttribute('maxlength'), '60000');
    assert.equal(await supplement.getAttribute('id'), 'tapd-supplementary-instructions');
    assert.equal(await supplement.getAttribute('required'), null);
    await page.getByText('补充说明（可选）', { exact: true }).waitFor();
    await supplement.fill(supplementaryInstructions);
    await page.getByLabel('Codex 模型', { exact: true }).selectOption('fixture-model-a');
    await page.getByLabel('思考强度', { exact: true }).selectOption('high');
    await choosePermission(page, 'auto');

    await verifyStartTaskLock(page);
    await page.getByText('模拟 TAPD 启动失败，请重试', { exact: true }).waitFor();
    assert.equal(submitted.supplementaryInstructions, supplementaryInstructions);
    assert.equal(await supplement.inputValue(), supplementaryInstructions, 'failed creation preserves the supplement draft');
    await page
      .getByRole('button', { name: '创建 session 并开始开发 →', exact: true })
      .click();
    await page.getByRole('textbox', { name: '发送给 Codex 的指令' }).waitFor();
    assert.equal(submitted.developer, undefined);
    assert.equal(submitted.tester, undefined);
    assert.equal(submitted.type, 'bug');
    assert.equal(submitted.channel, 'tapd');
    assert.equal(submitted.metadata.type, 'requirement');
    assert.equal(submitted.model, 'fixture-model-a');
    assert.equal(submitted.reasoningEffort, 'high');
    assert.equal(submitted.permissionMode, 'auto');
    assert.equal(submitted.supplementaryInstructions, supplementaryInstructions);
    assert.deepEqual(searches, []);
    await page
      .getByRole('button', { name: '＋ 从需求启动', exact: true })
      .click();
    assert.equal(await supplement.inputValue(), '', 'a new task starts without the previous supplement');
    await page.getByRole('textbox', { name: '需求 ID', exact: true }).fill('2');
    await page
      .getByRole('button', { name: '创建 session 并开始开发 →', exact: true })
      .click();
    await page.getByRole('textbox', { name: '发送给 Codex 的指令' }).waitFor();
    assert.equal(submitted.channel, 'tapd');
    assert.equal(submitted.supplementaryInstructions, '', 'the TAPD supplement is optional');
    await page
      .getByRole('button', { name: '＋ 从需求启动', exact: true })
      .click();
    await supplement.fill('这个补充仅属于当前项目。');
    await page
      .getByRole('textbox', { name: 'TAPD 工作区 ID', exact: true })
      .fill('9');
    assert.equal(await supplement.inputValue(), '', 'changing TAPD project clears the supplement');
    await supplement.fill('这个补充仅属于当前需求。');
    await page.getByRole('textbox', { name: '需求 ID', exact: true }).fill('3');
    assert.equal(await supplement.inputValue(), '', 'changing requirement ID clears the supplement');
    assert.equal(
      await page
        .locator('.user-search')
        .first()
        .getByText('魏文斌1（开发）', { exact: true })
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await supplement.fill('切换渠道后不应保留这段补充。');
    await page
      .getByRole('combobox', { name: '需求渠道', exact: true })
      .selectOption('manual');
    assert.equal(await supplement.isVisible(), false);
    await page.getByLabel('需求渠道', { exact: true }).selectOption('tapd');
    assert.equal(await supplement.inputValue(), '', 'switching channels clears the TAPD supplement');
    await supplement.fill('手动需求不应提交这个 TAPD 补充。');
    await page.getByLabel('需求渠道', { exact: true }).selectOption('manual');
    await page
      .getByRole('textbox', { name: '需求标题', exact: true })
      .fill('新增登录入口');
    const submit = page.getByRole('button', {
      name: '创建 session 并开始开发 →',
      exact: true,
    });
    await submit.click();
    await page
      .getByText('请填写需求内容或上传图片。', { exact: true })
      .waitFor();
    await page
      .getByRole('textbox', { name: '需求内容', exact: true })
      .fill('## 验收标准\n支持登录跳转');
    const filePicker = page.getByLabel('需求图片', { exact: true });
    await filePicker.setInputFiles([
      { name: '示意图.png', mimeType: 'image/png', buffer: png },
      { name: '补充.png', mimeType: 'image/png', buffer: png },
    ]);
    await page
      .getByRole('button', { name: '移除图片 2', exact: true })
      .waitFor();
    await page.getByRole('button', { name: '移除图片 1', exact: true }).click();
    assert.equal(await page.locator('.manual-images img').count(), 1);
    const worktreePrefix = page.getByRole('textbox', {
      name: 'Worktree 目录前缀（可选）', exact: true,
    });
    assert.equal(await worktreePrefix.getAttribute('maxlength'), '16');
    await worktreePrefix.fill('../outside');
    assert.equal(await worktreePrefix.evaluate((element) => element.validity.patternMismatch), true);
    await worktreePrefix.fill('login-entry');
    assert.equal(await worktreePrefix.evaluate((element) => element.validity.valid), true);
    await page.screenshot({
      path: path.join(output, 'manual-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(output, 'manual-mobile.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.getByLabel('Codex 模型', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('思考强度', { exact: true }).inputValue(), '');
    await page.getByLabel('任务类型', { exact: true }).selectOption('other');
    await page.getByLabel('Codex 模型', { exact: true }).selectOption('fixture-model-b');
    await page.getByLabel('思考强度', { exact: true }).selectOption('medium');
    await choosePermission(page, 'full');
    await submit.click();
    await page.getByText('模拟启动失败，请重试', { exact: true }).waitFor();
    const requestId = submitted.requestId;
    await submit.click();
    await page.getByRole('textbox', { name: '发送给 Codex 的指令' }).waitFor();
    assert.equal(submitted.channel, 'manual');
    assert.equal(Object.hasOwn(submitted, 'supplementaryInstructions'), false);
    assert.equal(submitted.metadata.type, 'other');
    assert.equal(submitted.model, 'fixture-model-b');
    assert.equal(submitted.reasoningEffort, 'medium');
    assert.equal(submitted.permissionMode, 'full');
    assert.equal(submitted.requestId, requestId);
    assert.equal(submitted.worktreeName, 'login-entry');
    assert.equal(submitted.title, '新增登录入口');
    assert.equal(submitted.images.length, 1);
    assert.equal(submitted.content, '## 验收标准\n支持登录跳转');
    const repository = path.join(directory, 'repository');
    fs.mkdirSync(repository);
    const git = (...args) =>
      execFileSync('git', ['-C', repository, ...args], {
        stdio: 'ignore',
        windowsHide: true,
      });
    git('init', '-b', 'main');
    fs.writeFileSync(path.join(repository, 'README.md'), 'fixture');
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'fixture',
    );
    require('../../src/config/execution-settings.cjs').saveSettings({ repository, worktreeRoot: path.join(directory, 'custom trees'), baseRef: 'HEAD' }, path.join(directory, 'missing.json'));
    await page.getByRole('button', { name: '执行设置', exact: true }).click();
    await page.waitForFunction(expected => document.querySelector('[aria-label="项目代码仓库路径"]')?.textContent === expected, repository);
    assert.equal(await page.getByLabel('项目代码仓库路径', { exact: true }).innerText(), repository);
    await page
      .getByRole('combobox', { name: '新任务基准引用', exact: true })
      .fill('main');
    await page.getByTitle('本地分支 · main', { exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Worktree 初始化命令', exact: true })
      .fill('pnpm install\npnpm build');
    await page
      .getByRole('button', { name: '保存执行设置', exact: true })
      .click();
    await page
      .getByText('设置已保存，新任务将使用此配置。', { exact: true })
      .waitFor();
    await page.getByRole('heading', { name: '配置开发工作区。' }).click();
    await page.getByRole('option').first().waitFor({ state: 'hidden' });
    await page.screenshot({
      path: path.join(output, 'settings.png'),
      fullPage: true,
    });
    await page.reload();
    await page.getByRole('button', { name: '执行设置', exact: true }).click();
    await page.waitForFunction(
      (value) =>
        document.querySelector('[aria-label="工作区 Worktree 完整路径"]')?.textContent ===
        value,
      path.join(directory, 'custom trees'),
    );
    await page.getByTitle('本地分支 · main', { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('textarea[aria-label="Worktree 初始化命令"]')
          ?.value === 'pnpm install\npnpm build',
    );
    await verifyExecutionSettings(browser, origin, manager, client, key, errors);
    await verifyPermissionDiscoveryFailures(browser, origin, client, errors);
    await verifyInitialListRefresh(browser, origin, manager, key, errors);
    await verifyUnreadResults(browser, origin, manager, key, errors);
    await verifyActionSelection(browser, origin, key, errors);
    await verifyRefreshConsistency(browser, origin, manager, client, key, errors);
    await verifyLanManualCreation(browser, directory, errors);
    await verifySessionMarkdown(browser, origin, client, key, errors);
    await verifySessionScroll(browser, origin, manager, key, errors, output);
    await verifySessionFiles(browser, origin, key, errors, output);
    await verifySessionImages(browser, origin, manager, client, key, errors, output);
    await verifySessionDeletion(browser, origin, manager, directory, errors, output);
    await verifySessionDeletion(browser, origin, manager, directory, errors, output, true);
    await verifySessionArchiveTitle(browser, origin, manager, errors, output);
    await verifyTapdFusion(browser, errors, output);
    assert.deepEqual(errors, []);
    process.stdout.write(
      'Browser smoke passed: send, stream, steer, approval, question, interrupt, continue, reload, mobile and start form.\n',
    );
  } finally {
    await browser?.close();
    await application.close();
    for (const callback of cleanup.reverse()) callback();
  }
}
main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
