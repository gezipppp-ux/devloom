/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { selectOption, selectPreference } = require("../support/select.cjs");

async function verifyIssueContext({ page, origin, projects }) {
  const base = `/projects/${projects.projectId}`;
  const taskUrl = origin + base + '?tab=tasks&task=search-task';
  const issueUrl = origin + base + '?tab=issues&issue=search';
  const output = path.resolve('state/browser/issue-context');
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(issueUrl);
  const assignmentText = '演示管理员 指派给 张明';
  await page.getByRole('region', { name: '开发分派', exact: true }).getByText(assignmentText, { exact: true }).waitFor();
  const fields = await page.getByRole('region', { name: '事项信息', exact: true }).locator('dl').innerText();
  await page.goto(taskUrl);
  await page.getByRole('region', { name: '开发分派', exact: true }).getByText(assignmentText, { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '事项信息', exact: true }).locator('dl').innerText(), fields, 'both entries show the same live metadata');

  const originalTask = projects.response(new URL(origin + '/api' + base + '/tasks/search-task')).task;
  const multipleTask = { ...originalTask, issueIds: ['search', 'empty'] };
  const taskRoute = route => route.fulfill({ json: { task: multipleTask } });
  const taskPattern = '**/api' + base + '/tasks/search-task';
  await page.route(taskPattern, taskRoute);
  await page.goto(taskUrl);
  await selectOption(page.getByRole('combobox', { name: '查看来源事项资料', exact: true }), 'empty');
  await page.getByRole('region', { name: '事项信息', exact: true }).getByText('开发中', { exact: true }).waitFor();

  let release, requested;
  const pending = new Promise(resolve => { requested = resolve; });
  const delayed = async route => { requested(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { ...projects.response(new URL(origin + '/api' + base + '/issues/search')), businessOwnerId: 'member-2' } }); };
  const issuePattern = '**/api' + base + '/issues/search';
  await page.route(issuePattern, delayed);
  await selectOption(page.getByRole('combobox', { name: '查看来源事项资料', exact: true }), 'search');
  await pending;
  await selectOption(page.getByRole('combobox', { name: '查看来源事项资料', exact: true }), 'empty');
  await page.getByRole('region', { name: '事项信息', exact: true }).getByText('开发中', { exact: true }).waitFor();
  const stale = page.waitForResponse(response => response.url().endsWith('/issues/search'));
  release(); await stale;
  await page.getByRole('region', { name: '事项信息', exact: true }).getByText('开发中', { exact: true }).waitFor();
  await page.unroute(issuePattern, delayed);

  const denied = route => route.fulfill({ status: 403, json: { error: '事项访问权限已撤销' } });
  await page.route(issuePattern, denied);
  await selectOption(page.getByRole('combobox', { name: '查看来源事项资料', exact: true }), 'search');
  await page.locator('.context-error').getByText('事项访问权限已撤销', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '事项信息', exact: true }).count(), 0);
  assert.equal(await page.getByRole('region', { name: '开发分派', exact: true }).count(), 0);
  await page.unroute(issuePattern, denied);
  await page.getByRole('button', { name: '重新读取协作资料', exact: true }).click();
  await page.getByRole('region', { name: '开发分派', exact: true }).waitFor();

  for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
    await page.setViewportSize({ width, height });
    for (const [kind, url] of [['issue',issueUrl],['task',taskUrl]]) {
      await page.goto(url);
      await page.getByRole('region', { name: '开发分派', exact: true }).getByText(assignmentText, { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${kind} ${width} overflow`);
      await page.screenshot({ path: path.join(output, `${kind}-${width}.png`), fullPage: true });
      const info = page.getByRole('region', { name: '事项信息', exact: true }).locator('details');
      assert.equal(await info.evaluate(el => el.open), width >= 1200);
      if (width < 1200) { await info.locator('summary').click(); await page.screenshot({ path: path.join(output, `${kind}-expanded-${width}.png`), fullPage: true }); }
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await selectPreference(page, 'locale', 'en');
  await page.getByRole('region', { name: 'Development assignment', exact: true }).getByText('演示管理员 assigned to 张明', { exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Source issue information', exact: true }).locator('.source-picker').innerText(), /^Source issue\s/);
  await page.getByRole('region', { name: 'Issue information', exact: true }).getByText('Project', { exact: true }).waitFor();
  await page.getByRole('heading', { name: /^Development scope/ }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(output, 'task-english-320.png'), fullPage: true });
  await selectPreference(page, 'locale', 'zh-CN');
  const originalIssue = projects.response(new URL(origin + '/api' + base + '/issues/search'));
  const longIssue = { ...originalIssue, people: originalIssue.people.map(person => ({ ...person, displayName: person.displayName + ' · 跨平台产品协作与研发支持团队' })), title: '跨平台需求与开发协作资料的长标题展示检查'.repeat(3), tags: ['跨平台协作', '长文本展示', '移动端适配'] };
  let sourceIssue = longIssue;
  const sourceRoute = route => route.fulfill({ json: sourceIssue });
  await page.route(issuePattern, sourceRoute);
  multipleTask.issues = [{ ...multipleTask.issues[0], title: longIssue.title }];
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    await page.goto(taskUrl);
    await page.getByRole('region', { name: '开发分派', exact: true }).waitFor();
    const info = page.getByRole('region', { name: '事项信息', exact: true }).locator('details');
    if (width === 320) await info.locator('summary').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `long metadata at ${width}`);
    await page.screenshot({ path: path.join(output, `task-long-${width}.png`), fullPage: true });
  }
  sourceIssue = { ...originalIssue, developmentAssignment: { ...originalIssue.developmentAssignment, actorId: originalIssue.developerId, method: 'claimed' } };
  await page.goto(taskUrl);
  await page.getByRole('region', { name: '开发分派', exact: true }).getByText('张明自行认领', { exact: true }).waitFor();
  sourceIssue = { ...originalIssue, developerId: null, developmentAssignment: null };
  await page.goto(taskUrl);
  await page.getByRole('region', { name: '开发分派', exact: true }).getByText('尚未分派开发负责人', { exact: true }).waitFor();
  sourceIssue = { ...originalIssue, developmentAssignment: null };
  await page.goto(taskUrl);
  await page.getByRole('region', { name: '开发分派', exact: true }).getByText('分派记录待确认', { exact: true }).waitFor();
  await page.unroute(issuePattern, sourceRoute);
  await page.unroute(taskPattern, taskRoute);
  const manualRoute = route => route.fulfill({ json: { task: { ...originalTask, kind: 'manual', issueIds: [], issues: [], additions: [] } } });
  await page.route(taskPattern, manualRoute);
  await page.goto(taskUrl);
  await page.getByText('此任务为独立开发，暂无来源事项资料。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '开发分派', exact: true }).count(), 0);
  await page.unroute(taskPattern, manualRoute);
  await page.setViewportSize({ width: 1440, height: 900 });
}

module.exports = { verifyIssueContext };
