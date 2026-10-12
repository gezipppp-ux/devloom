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
module.exports = { navigateWorkspace };
