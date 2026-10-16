const { selectOption, selectPreference } = require("../support/select.cjs");
/* global document, window */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyIndependentDelivery({ page, origin, projectId, output }) {
  const task = { id: "independent-delivery-task", title: "优化开发环境启动速度", kind: "manual", status: "started", revision: 4, canComplete: true, issues: [], issueIds: [], additions: [] };
  const base = `${origin}/api/projects/${projectId}`;
  const publications = [], completions = [];
  await page.route(base + "/tasks/session?*", route => route.fulfill({ json: { task } }));
  await page.route(base + "/deliveries", async route => { publications.push(route.request().postDataJSON()); await route.fulfill({ json: { id: "independent-published", ...publications.at(-1) } }); });
  await page.route(base + "/deliveries/independent-published", route => route.fulfill({ json: { delivery: { id: "independent-published", ...publications.at(-1), status: "pending", checklist: [], checkedItems: [] }, issue: null, permissions: ["collaboration.view"], people: [] } }));
  await page.route(base + "/tasks/independent-delivery-task/complete", async route => { completions.push(route.request().postDataJSON()); await route.fulfill({ json: { task: { ...task, status: "completed" } } }); });
  const open = async () => {
    await page.goto(origin + "/?workspace=ux-workspace&task=1-1");
    await page.locator(".session-header").waitFor();
    assert.equal(await page.locator(".session-drawer").isVisible(), false);
    await page.locator(".session-composer textarea").fill("交付后继续保留的会话草稿");
    await page.getByRole("button", { name: "整理成果", exact: true }).click();
    await page.getByRole("heading", { name: task.title, exact: true }).waitFor();
  };
  try {
    await open();
    assert.equal(await page.getByRole("combobox", { name: "关联事项", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "发布交付", exact: true }).isDisabled(), true);
    await page.getByLabel("交付标题", { exact: true }).fill("启动速度优化成果");
    await page.getByLabel("交付说明", { exact: true }).fill("完成缓存复用，保留失败反馈。");
    await page.getByLabel("验证结果", { exact: true }).fill("构建已通过；线上耗时待验证。");
    await page.getByLabel("提交标识（可选）", { exact: true }).fill("abc123");
    await selectOption(page.getByRole("combobox", { name: "交付验证人", exact: true }), "member-2");
    await selectPreference(page, "locale", "en");
    assert.equal(await page.getByLabel("Delivery title", { exact: true }).inputValue(), "启动速度优化成果");
    await selectPreference(page, "locale", "zh-CN");
    for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `delivery overflow at ${width}`);
      const publish = page.getByRole("button", { name: "发布交付", exact: true });
      await publish.scrollIntoViewIfNeeded();
      const bounds = await publish.boundingBox();
      await page.screenshot({ path: path.join(output, `independent-delivery-${width}.png`) });
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `publish reachable at ${width}: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "发布交付", exact: true }).click();
    await page.getByRole("heading", { name: "启动速度优化成果", exact: true }).waitFor();
    assert.equal(publications.length, 1);
    assert.equal(publications[0].taskId, task.id);
    assert.equal(publications[0].reviewerId, "member-2");
    assert.equal(Object.hasOwn(publications[0], "issueId"), false);
    assert.match(publications[0].body, /构建已通过；线上耗时待验证/);
    assert.equal(completions.length, 0, "sharing does not finish development");
    await open();
    await page.getByRole("button", { name: "返回会话", exact: true }).click();
    assert.equal(await page.locator(".session-composer textarea").inputValue(), "交付后继续保留的会话草稿");
    await page.getByRole("button", { name: "整理成果", exact: true }).click();
    await page.getByRole("button", { name: "仅结束个人开发", exact: true }).click();
    await page.getByRole("button", { name: "确认完成开发任务", exact: true }).click();
    await page.locator(".session-header").waitFor();
    assert.deepEqual(completions, [{ revision: 4 }]);
    assert.equal(publications.length, 1, "private completion never publishes notes");
  } finally {
    await page.unroute(base + "/tasks/session?*"); await page.unroute(base + "/deliveries");
    await page.unroute(base + "/deliveries/independent-published"); await page.unroute(base + "/tasks/independent-delivery-task/complete");
  }
}
module.exports = { verifyIndependentDelivery };
