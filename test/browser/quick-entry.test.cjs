/* global document, requestAnimationFrame */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectVisual } = require('../fixtures/project-visual.cjs');
const { selectPreference } = require("../support/select.cjs");
const { openIssueCreate } = require('../support/browser-navigation.cjs');

async function verifyQuickEntry(browser) {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const fixture = projectVisual('quick-entry-workspace'), projectId = fixture.projectId;
  const origin = 'http://127.0.0.1:49028', base = `/api/projects/${projectId}`;
  const project = { ...fixture.response(new URL(origin + '/api/projects')).projects[0], name: '拼豆', description: '' };
  const output = path.resolve('state/browser/quick-entry'); fs.mkdirSync(output, { recursive: true });
  let projects = [project], holdProject = false, heldProjects = [], holdSearch = false, heldSearch = [], partialFailure = true;
  let readySpace = false, holdBootstrap = false;
  const heldBootstraps = [];
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    const send = (json, status = 200) => route.fulfill({ status, json });
    if (endpoint.startsWith('/api/')) {
      requests.push({ endpoint, query: url.searchParams.get('query'), method: request.method() });
      if (endpoint === '/api/auth/session') return send({ user: { id: 'visual-admin', username: 'preview', displayName: '预览成员', role: 'admin', status: 'active', mustChangePassword: false }, token: 'fixture', settings: {} });
      if (endpoint === '/api/bootstrap') {
        if (holdBootstrap) await new Promise(resolve => heldBootstraps.push(resolve));
        return send({ token: 'fixture', workspaces: [] });
      }
      if (endpoint === '/api/projects') return send({ projects, canCreateProjects: true });
      if (endpoint === '/api/workbench/recent-projects') return send({ projects: [project] });
      if (endpoint === '/api/account/preferences') return send({ preferences: { unreadRunKeys: [] } });
      if (endpoint === '/api/account/git-accounts') return send({ accounts: [] });
      if (endpoint === base) {
        if (holdProject) await new Promise(resolve => heldProjects.push(resolve));
        return send({ ...fixture.response(url), project, space: readySpace ? { status: 'ready', workspaceId: 'quick-entry-workspace' } : null });
      }
      if (/^\/api\/workbench\/(issues|tasks|deliveries)$/.test(endpoint)) {
        const kind = endpoint.split('/').at(-1), query = url.searchParams.get('query');
        if (!query) return send(fixture.response(url));
        if (holdSearch && query === '旧') await new Promise(resolve => heldSearch.push(resolve));
        if (query === '失败' && kind === 'deliveries' && partialFailure) return send({ error: '模拟交付搜索失败' }, 500);
        const original = fixture.response(url);
        const items = ['旧', '新', '失败'].includes(query) ? kind === 'issues' ? [{ ...original.items[0], title: query === '失败' ? '保留的事项结果' : `${query}搜索结果` }] : [] : original.items.filter(item => item.title.includes(query));
        return send({ ...original, items, total: items.length });
      }
      const result = fixture.response(url);
      return result ? send(result) : send({ error: 'Unexpected fixture API: ' + endpoint }, 404);
    }
    const dist = path.resolve('web/dist'), file = endpoint.startsWith('/assets/') ? path.resolve(dist, '.' + endpoint) : path.join(dist, 'index.html');
    assert.ok(file.startsWith(dist + path.sep));
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  const chooser = () => page.locator('.project-picker-dialog[open]');
  const search = () => page.locator('.quick-search-dialog[open]');
  async function openSearch() {
    if (await page.locator('.ui-global-search').isVisible()) await page.locator('.ui-global-search').click();
    else { await page.locator('.ui-mobile-menu').click(); await page.locator('.ui-drawer-search').click(); }
    await search().getByRole('searchbox').waitFor();
  }
  async function close() { await page.keyboard.press('Escape'); await page.locator('dialog[open]').waitFor({ state: 'hidden' }); }
  async function waitHeld(queue, count) {
    const deadline = Date.now() + 5000;
    while (queue.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(queue.length, count);
  }
  async function capture(name, dialog) {
    const size = await dialog.boundingBox(), viewport = page.viewportSize();
    assert.ok(size.x >= 15 && size.x + size.width <= viewport.width - 15, `${name} fits horizontally`);
    assert.ok(size.y >= 0 && size.y + size.height <= viewport.height + 1, `${name} fits vertically`);
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name} content has no horizontal overflow`);
    await page.screenshot({ path: path.join(output, name + '.png') });
  }
  try {
    await page.goto(origin);
    await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    await openIssueCreate(page);
    await chooser().getByRole('heading', { name: '选择项目', exact: true }).waitFor();
    assert.equal(await chooser().locator('.project-picker-copy small').count(), 0, 'empty descriptions leave no blank description row');
    assert.equal(await chooser().getByRole('searchbox').count(), 0, 'single project requires no filter');
    assert.ok((await chooser().boundingBox()).height < 230, 'single project chooser stays compact');
    await close();
    await openIssueCreate(page, 'Bug');
    await chooser().getByRole('button', { name: '拼豆', exact: true }).click();
    await page.getByRole('heading', { name: '新建 Bug', exact: true }).waitFor();

    await page.goto(origin + '/development');
    holdProject = true;
    await page.getByRole('button', { name: '独立开发', exact: true }).click();
    await chooser().getByRole('button', { name: '拼豆', exact: true }).click();
    await waitHeld(heldProjects, 1);
    await close();
    await page.getByRole('button', { name: '独立开发', exact: true }).click();
    await chooser().getByRole('button', { name: '拼豆', exact: true }).click();
    await waitHeld(heldProjects, 2);
    const firstResponse = page.waitForResponse(response => response.url() === origin + base);
    heldProjects[0](); await firstResponse;
    assert.ok(await chooser().isVisible(), 'a cancelled response cannot close a reopened picker');
    assert.equal(await chooser().getByRole('button', { name: '拼豆', exact: true }).isDisabled(), true);
    holdProject = false; heldProjects[1]();
    await page.waitForURL(url => url.searchParams.get('openIntent') === 'manual');
    assert.equal(requests.some(request => request.method === 'POST' && /\/(runs|tasks|manual)$/.test(request.endpoint)), false, 'project choice never starts execution');

    await page.goto(origin + '/development');
    await page.getByRole('button', { name: '独立开发', exact: true }).waitFor();
    readySpace = true; holdBootstrap = true;
    await page.getByRole('button', { name: '独立开发', exact: true }).click();
    await chooser().getByRole('button', { name: '拼豆', exact: true }).click();
    await waitHeld(heldBootstraps, 1);
    await close();
    await page.getByRole('button', { name: '独立开发', exact: true }).click();
    const oldBootstrap = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
    holdBootstrap = false; readySpace = false; heldBootstraps[0](); await oldBootstrap;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(new URL(page.url()).pathname, '/development', 'cancelling during bootstrap also prevents the old navigation');
    assert.ok(await chooser().isVisible(), 'a delayed bootstrap preserves a reopened picker');
    await close();

    projects = [...Array.from({ length: 6 }, (_, index) => ({ ...project, id: index ? `extra-${index}` : projectId, name: index ? `协作项目 ${index}` : project.name })), { ...project, id: 'archived', name: '归档项目', status: 'archived' }, { ...project, id: 'readonly', name: '只读项目', permissions: ['project.view'] }];
    await page.goto(origin);
    await openIssueCreate(page);
    await chooser().getByRole('searchbox').fill('协作项目 3');
    assert.equal(await chooser().locator('.project-picker-list > button').count(), 1);
    await chooser().getByRole('searchbox').press('ArrowDown');
    assert.ok(await chooser().locator('.project-picker-list > button').evaluate(element => element === document.activeElement));
    await chooser().getByRole('searchbox').fill('项目');
    assert.equal(await chooser().getByRole('button', { name: /归档项目|只读项目/ }).count(), 0);
    await close();
    projects = [project]; await page.goto(origin);

    await openSearch();
    const input = search().getByRole('searchbox');
    assert.ok(await input.evaluate(element => element === document.activeElement));
    await search().getByText('最近项目', { exact: true }).waitFor();
    assert.equal(await search().getByRole('heading').count(), 0, 'input replaces redundant search title');
    assert.equal(await search().getByRole('button', { name: '搜索', exact: true }).count(), 0);
    await input.fill('导出');
    await search().getByText('修复导出结果与筛选条件不一致', { exact: true }).waitFor();
    await input.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForURL(url => url.searchParams.get('issue') === 'export');
    await openSearch();
    await close();
    assert.ok(await page.locator('.ui-global-search').evaluate(element => element === document.activeElement), 'Escape restores trigger focus');

    await openSearch(); holdSearch = true;
    await search().getByRole('searchbox').fill('旧');
    await waitHeld(heldSearch, 3);
    await search().getByRole('searchbox').fill('新');
    await search().getByText('新搜索结果', { exact: true }).waitFor();
    const oldResponses = Promise.all(['issues', 'tasks', 'deliveries'].map(kind => page.waitForResponse(response => new URL(response.url()).pathname === '/api/workbench/' + kind && new URL(response.url()).searchParams.get('query') === '旧')));
    heldSearch.forEach(resolve => resolve()); await oldResponses;
    assert.equal(await search().getByText('旧搜索结果', { exact: true }).count(), 0);
    await search().getByRole('searchbox').fill('不存在');
    await search().getByText('没有找到匹配内容', { exact: true }).waitFor();
    await search().getByRole('searchbox').fill('失败');
    await search().getByText('保留的事项结果', { exact: true }).waitFor();
    await search().getByRole('button', { name: '重试', exact: true }).waitFor();
    partialFailure = false;
    await search().getByRole('button', { name: '重试', exact: true }).click();
    await search().locator('.quick-search-error').waitFor({ state: 'hidden' });
    await search().getByRole('searchbox').fill('');
    await search().getByText('最近项目', { exact: true }).waitFor();
    await close();

    for (const locale of ['zh-CN', 'en']) {
      await selectPreference(page, "locale", locale);
      for (const [width, height] of [[2560,1440],[1920,1080],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
        await page.setViewportSize({width,height});
        await page.goto(origin);
        await page.getByRole('button', { name: locale === 'en' ? 'New issue' : '新建事项', exact: true }).click();
        await page.getByRole('menuitem', { name: locale === 'en' ? 'New requirement' : '新建需求', exact: true }).click();
        await chooser().waitFor(); await capture(`issue-picker-${locale}-${width}`, chooser()); await close();
        await page.goto(origin + '/development');
        await page.getByRole('button', { name: locale === 'en' ? 'Independent development' : '独立开发', exact: true }).click();
        await chooser().waitFor(); await capture(`manual-picker-${locale}-${width}`, chooser()); await close();
        await openSearch(); await search().locator('.quick-search-row').first().waitFor();
        await capture(`search-recent-${locale}-${width}`, search());
        await search().getByRole('searchbox').fill('搜索');
        await search().getByText('客户搜索体验交付', { exact: true }).waitFor();
        await capture(`search-results-${locale}-${width}`, search());
        if (locale === 'zh-CN' && [1920,390].includes(width)) {
          await close(); await selectPreference(page, "theme", 'dark');
          await openSearch(); await search().getByRole('searchbox').fill('搜索');
          await search().getByText('客户搜索体验交付', { exact: true }).waitFor();
          await capture(`search-dark-${width}`, search());
          await close(); await selectPreference(page, "theme", 'light');
        } else await close();
      }
    }
    assert.deepEqual(errors, []);
    console.log('Quick entry passed: shared project pickers, permissions, cancelled request isolation, live search races, keyboard, retry, bilingual and responsive layouts.');
  } finally { heldProjects.forEach(resolve => resolve()); heldSearch.forEach(resolve => resolve()); heldBootstraps.forEach(resolve => resolve()); await context.close(); }
}
module.exports = { verifyQuickEntry };
