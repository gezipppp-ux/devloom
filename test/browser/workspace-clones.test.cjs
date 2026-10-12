/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyWorkspaceClones(page, origin, output) {
  let status = "running", percentage = 42, disconnected = false;
  const clone = () => ({ id: "fixture-clone", name: "大型仓库克隆测试", status,
    progress: { stage: "receiving", percent: percentage },
    error: status === "failed" ? "克隆失败，请检查网络或磁盘空间。" : null,
    workspace: null,
  });
  await page.route("**/api/workspace-clones", route => disconnected
    ? route.fulfill({ status: 503, json: { error: "模拟网络中断" } })
    : route.fulfill({ json: { clones: [clone()] } }));
  await page.reload();
  await page.getByRole("button", { name: "克隆任务（1）", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "工作区克隆进度", exact: true });
  await dialog.getByText(/下载仓库对象 · 42%/).waitFor();
  assert.equal(await dialog.getByRole("progressbar").getAttribute("value"), "42");
  await dialog.getByText(/关闭此窗口、刷新或关闭浏览器不会中止克隆/).waitFor();
  await page.keyboard.press("Escape");
  percentage = 63;
  await page.reload();
  await page.getByRole("button", { name: "克隆任务（1）", exact: true }).click();
  await dialog.getByText(/下载仓库对象 · 63%/).waitFor();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await dialog.getByRole("button", { name: "关闭窗口，后台继续", exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, `workspace-clone-progress-${width}.png`) });
  }
  disconnected = true;
  await page.locator('.operation-message[data-type="error"]').filter({ hasText: "进度暂时无法更新" }).waitFor();
  assert.equal(await dialog.getByRole("progressbar").getAttribute("value"), "63");
  disconnected = false;
  status = "failed";
  await dialog.getByText("克隆失败，请检查网络或磁盘空间。", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("progressbar").count(), 0);
  await page.screenshot({ path: path.join(output, "workspace-clone-failed-320.png") });
  await page.keyboard.press("Escape");
  await page.unroute("**/api/workspace-clones");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
}
module.exports = { verifyWorkspaceClones };
