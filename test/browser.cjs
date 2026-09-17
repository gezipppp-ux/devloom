/* global document, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { RunStore } = require('../src/web_store.cjs');
const { WebSessions } = require('../src/web_sessions.cjs');
const { createWebServer } = require('../src/web_server.cjs');
const { FakeClient } = require('./fixtures/web_client.cjs');
const { temporary, png } = require('./helpers.cjs');
const { ChannelRegistry } = require('../src/channels/registry.cjs');
const { createManualChannel } = require('../src/channels/manual.cjs');

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
        path: 'D:/project/.worktrees/tapd/1-2',
        branch: 'codex/tapd-1-2',
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
  store.worktreeReason = () => null;
  const client = new FakeClient(),
    manager = new WebSessions({ store, client });
  const searches = [];
  const manualChannel = createManualChannel(
    path.join(directory, 'missing.json'),
    { uploadDirectory: path.join(directory, 'uploads') },
  );
  manager.channels = new ChannelRegistry([
    {
      id: 'tapd',
      capabilities: { search: true, assignees: true },
      describe: () => ({
        id: 'tapd',
        label: 'TAPD',
        workspace: '1',
        scopeLabel: 'TAPD 工作区 ID',
        capabilities: { search: true, assignees: true },
      }),
      resolve: async () => {},
      prepare: async () => {},
      transition: async () => {},
      search: async () => [{ id: '2', title: '模拟需求', workspace: '1' }],
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
  let manualFailure = true;
  manager.start = async (input) => {
    submitted = input;
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

    await page.locator('.session-context > summary').click();
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
    await page.locator('.session-context > summary').click();
    await page
      .getByRole('heading', { name: 'Markdown 需求', exact: true })
      .waitFor();
    await page.getByText('Markdown 正文末尾', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.requirement-body img').getAttribute('src'),
      '/api/runs/1-2/images/0',
    );
    assert.deepEqual(externalRequests, []);
    await page.locator('.session-context > summary').click();
    await page.getByText('工作区初始化', { exact: true }).click();
    await page.getByText('初始化依赖安装完成', { exact: true }).waitFor();
    const input = page.getByRole('textbox', { name: '发送给 Codex 的指令' });
    await input.fill('检查充值入口，并补充测试');
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    await page.getByRole('button', { name: '■ 停止', exact: true }).waitFor();
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
    await page.getByRole('button', { name: '补充指令 ↑', exact: true }).click();
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
    const output = path.resolve(__dirname, '../state/browser');
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
    await page
      .getByRole('combobox', { name: '开发人员', exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const developer = page.getByRole('combobox', {
      name: '开发人员',
      exact: true,
    });
    const tester = page.getByRole('combobox', {
      name: '测试人员',
      exact: true,
    });
    const slowRequest = page.waitForRequest((request) =>
      request.url().includes('query=slow'),
    );
    const slowResponse = page.waitForResponse((response) =>
      response.url().includes('query=slow'),
    );
    await developer.fill('slow');
    await slowRequest;
    await developer.fill('wei');
    await page.getByTitle('魏文斌1（开发）', { exact: true }).click();
    await slowResponse;
    assert.equal(await page.getByText('过期结果', { exact: true }).count(), 0);
    await tester.fill('none');
    await page.getByText('没有匹配人员', { exact: true }).waitFor();
    await tester.fill('error');
    await page.getByText('模拟搜索失败', { exact: true }).waitFor();
    await tester.fill('liu');
    await page.getByTitle('刘嘉辉（测试）', { exact: true }).click();
    await page.screenshot({
      path: path.join(output, 'assignee-search.png'),
      fullPage: true,
    });
    await page.getByRole('textbox', { name: '需求 ID', exact: true }).fill('2');
    await page.getByLabel('Codex 模型', { exact: true }).selectOption('fixture-model-a');
    await page.getByLabel('思考强度', { exact: true }).selectOption('high');

    await page
      .getByRole('button', { name: '创建 session 并开始开发 →', exact: true })
      .click();
    await page.getByRole('textbox', { name: '发送给 Codex 的指令' }).waitFor();
    assert.equal(submitted.developer, '魏文斌1');
    assert.equal(submitted.tester, '刘嘉辉');
    assert.equal(submitted.channel, 'tapd');
    assert.equal(submitted.metadata.type, 'requirement');
    assert.equal(submitted.model, 'fixture-model-a');
    assert.equal(submitted.reasoningEffort, 'high');
    assert.ok(
      searches.some(
        (request) => request.query === 'wei' && request.workspace === '1',
      ),
    );
    await page
      .getByRole('button', { name: '＋ 从需求启动', exact: true })
      .click();
    await developer.fill('wei');
    await page.getByTitle('魏文斌1（开发）', { exact: true }).click();
    await page
      .getByRole('textbox', { name: 'TAPD 工作区 ID', exact: true })
      .fill('9');
    assert.equal(
      await page
        .locator('.user-search')
        .first()
        .getByText('魏文斌1（开发）', { exact: true })
        .count(),
      0,
    );
    await developer.fill('wei');
    await page.getByTitle('魏文斌1（开发）', { exact: true }).waitFor();
    assert.equal(searches.at(-1).workspace, '9');
    await page.keyboard.press('Escape');
    await page
      .getByRole('combobox', { name: '需求渠道', exact: true })
      .selectOption('manual');
    assert.equal(await developer.isVisible(), false);
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
    await page
      .getByRole('textbox', { name: 'worktree 目录名称（可选）', exact: true })
      .fill('login-entry');
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
    await submit.click();
    await page.getByText('模拟启动失败，请重试', { exact: true }).waitFor();
    const requestId = submitted.requestId;
    await submit.click();
    await page.getByRole('textbox', { name: '发送给 Codex 的指令' }).waitFor();
    assert.equal(submitted.channel, 'manual');
    assert.equal(submitted.metadata.type, 'other');
    assert.equal(submitted.model, 'fixture-model-b');
    assert.equal(submitted.reasoningEffort, 'medium');
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
    await page.getByRole('button', { name: '执行设置', exact: true }).click();
    await page
      .getByRole('textbox', { name: '项目代码仓库', exact: true })
      .fill(repository);
    await page
      .getByRole('textbox', { name: 'Worktree 根目录', exact: true })
      .fill(path.join(directory, 'custom trees'));
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
        document.querySelector('input[aria-label="Worktree 根目录"]')?.value ===
        value,
      path.join(directory, 'custom trees'),
    );
    await page.getByTitle('本地分支 · main', { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('textarea[aria-label="Worktree 初始化命令"]')
          ?.value === 'pnpm install\npnpm build',
    );
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
