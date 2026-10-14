/* global window, PopStateEvent */
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
  await page.locator('.project-tab-bar, .issue-back, .development-heading').first().waitFor();
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
module.exports = { navigateWorkspace, openProjectTab };
