/* global document, window, PopStateEvent */
// Exercise the same history navigation used by project development-space links.
async function navigateWorkspace(page, workspace) {
  await page.evaluate(id => {
    const url = new URL(window.location.href);
    url.pathname = "/";
    // Match useWorkspaceSelection.navigate: a task key belongs to its workspace.
    if (url.searchParams.get("workspace") !== id) url.searchParams.delete("task");
    url.searchParams.set("workspace", id);
    if (url.href === window.location.href) return;
    window.history.pushState({ ...window.history.state }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, workspace.id);
}
async function openProjectTab(page, name) {
  await page.locator('.project-tab-bar, .issue-back, .issue-create-back, .development-heading').first().waitFor();
  const createBack = page.locator('.issue-create-back');
  if (await createBack.isVisible()) await createBack.click();
  const back = page.locator('button.issue-back');
  if (await back.isVisible()) await back.click();
  const taskConfirmationBack = page.getByRole('button', { name: '返回任务详情', exact: true });
  if (await taskConfirmationBack.isVisible()) await taskConfirmationBack.click();
  const taskBack = page.getByRole('button', { name: '返回任务列表', exact: true });
  if (await taskBack.isVisible()) await taskBack.click();
  const editorDialog = page.locator('.project-members dialog[open], .project-assets dialog[open], .project-releases dialog[open]');
  if (await editorDialog.isVisible()) await editorDialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator(".project-tab-bar").waitFor();
  const label = name;
  const primary = page.getByRole("navigation", { name: "项目功能", exact: true }).getByRole("button", { name: label, exact: true });
  if (await primary.count()) return primary.click();
  const more = page.locator(".project-more");
  if (await more.getAttribute("open") === null) await more.locator("summary").click();
  return more.getByRole("button", { name: label, exact: true }).click();
}
async function openSessionList(page) {
  if (!await page.getByRole('dialog', { name: '会话列表', exact: true }).isVisible()) await page.getByRole('button', { name: '切换会话', exact: false }).click();
}
async function openSessionContext(page, name = '会话信息') {
  if (!await page.locator('.session-drawer').isVisible()) await page.getByRole('button', { name: '上下文', exact: true }).click();
  const button = page.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
async function openIssueCreate(page, type = '需求') {
  await page.getByRole('button', { name: '新建事项', exact: true }).click();
  await page.getByRole('menuitem', { name: type === 'Bug' ? '新建 Bug' : '新建需求', exact: true }).click();
}
async function openAccountMenu(page) {
  await page.bringToFront();
  const panel = page.locator('.ui-account-menu');
  if (!await panel.count()) return;
  // The responsive dialog closes when crossing the mobile breakpoint. Wait for
  // that state update before opening it, including after a test resizes a page.
  await page.waitForFunction(() => document.querySelector('.ui-account-menu').classList.contains('account-sheet') === (window.innerWidth < 768));
  if (!await panel.isVisible()) await page.locator('.ui-avatar').click();
  await panel.waitFor({ state: 'visible' });
}
async function accountAction(page, name) {
  await openAccountMenu(page);
  await page.locator('.ui-account-menu').getByRole('button', { name, exact: true }).click();
}
module.exports = { navigateWorkspace, openProjectTab, openSessionList, openSessionContext, openIssueCreate, openAccountMenu, accountAction };
