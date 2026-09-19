/* global KeyboardEvent */
const assert = require("node:assert/strict");

async function verifyStartTaskLock(page) {
  let captured;
  let release;
  const pending = new Promise((resolve) => { captured = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const intercepted = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    captured();
    await gate;
    await route.continue();
  };
  const searches = [];
  const record = (request) => {
    if (new URL(request.url()).pathname === "/api/requirements")
      searches.push(request.url());
  };
  await page.route("**/api/runs", intercepted);
  page.on("request", record);
  try {
    await page.getByRole("button", { name: "创建 session 并开始开发 →", exact: true }).click();
    await pending;
    for (const name of ["TAPD 工作区 ID", "需求 ID", "开发人员", "测试人员"])
      assert.equal(await page.getByLabel(name, { exact: true }).isDisabled(), true,
        `${name} must remain locked while task creation is pending`);
    const query = page.getByPlaceholder("输入需求标题关键词");
    assert.equal(await query.isDisabled(), true);
    // A queued key event must not begin a search and release the creation lock.
    await query.evaluate((input) => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    assert.equal(await page.getByRole("button", { name: "正在处理…", exact: true }).isDisabled(), true);
    assert.deepEqual(searches, [], "search must not run during task creation");
  } finally {
    release();
    await page.unroute("**/api/runs", intercepted);
    page.off("request", record);
  }
}

module.exports = { verifyStartTaskLock };
