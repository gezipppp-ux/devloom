/* global document, window, localStorage, StorageEvent */
const assert = require("node:assert/strict");
const path = require("node:path");

async function verifyMergeDevelopmentDialog({ page, origin, fixture, output }) {
  const base = fixture.response(new URL(`${origin}/api/projects/${fixture.projectId}/tasks`)).tasks[0];
  const titles = [
    "爆款洞察作品详情弹窗与原型不一致，比例信息位置及视觉样式需整改",
    "热门账号洞察的账号分类未充分利用单行空间，提前显示“更多”",
    "爆款洞察行业热榜筛选区与原型不一致，缺少作品类型筛选",
  ];
  const tasks = titles.map((title, index) => ({ ...base, id: `merge-${index}`, title, status: "planned", canMerge: true, releaseId: null, release: null, runKey: null, execution: null, issueIds: [`issue-${index}`] }));
  const tasksUrl = `**/api/projects/${fixture.projectId}/tasks?*`;
  const respond = route => route.fulfill({ json: { tasks, nextOffset: null } });
  await page.route(tasksUrl, respond);
  const changeLocale = async value => page.evaluate(value => {
    localStorage.setItem("web-coding.locale", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "web-coding.locale", newValue: value, storageArea: localStorage }));
  }, value);
  try {
    await page.goto(`${origin}/projects/${fixture.projectId}?tab=tasks`);
    for (const title of titles) await page.getByRole("checkbox", { name: `选择开发任务 ${title}`, exact: true }).check();
    const trigger = page.getByRole("button", { name: "合并所选任务（3）", exact: true });
    await trigger.click();
    const dialog = page.locator(".merge-development-dialog");
    const input = dialog.locator("textarea");
    await input.fill("   ");
    assert.equal(await dialog.locator("footer .primary").isDisabled(), true);
    await input.fill(titles[0]);
    for (const language of ["zh-CN", "en"]) {
      await changeLocale(language);
      assert.equal(await input.inputValue(), titles[0], "language changes preserve the title draft");
      for (const [width, height] of [[1920,1080],[2560,1440],[1440,900],[1280,720],[768,1024],[390,844],[320,740]]) {
        await page.setViewportSize({ width, height });
        await input.focus();
        await dialog.locator('.merge-development-field').scrollIntoViewIfNeeded();
        const layout = await dialog.evaluate(element => {
          const rect = target => target.getBoundingClientRect();
          const modal = rect(element), header = rect(element.querySelector("header")), footer = rect(element.querySelector("footer"));
          const label = rect(element.querySelector(".merge-development-label")), input = rect(element.querySelector("textarea"));
          return { overflow: element.scrollWidth > element.clientWidth, left: modal.left, right: modal.right, top: modal.top, bottom: modal.bottom, headerTop: header.top, footerBottom: footer.bottom, gap: input.top - label.bottom, pageOverflow: document.documentElement.scrollWidth > window.innerWidth };
        });
        assert.equal(layout.overflow || layout.pageOverflow, false, JSON.stringify(layout));
        assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= height, JSON.stringify(layout));
        assert.ok(layout.headerTop >= 0 && layout.footerBottom <= height, "header and submit remain in the viewport");
        assert.ok(layout.gap >= 12, "focus outline cannot collide with the label");
        if (width >= 768) assert.equal(Math.round(layout.right - layout.left), 624, "the selected spacious layout keeps its desktop width");
        await page.screenshot({ path: path.join(output, `merge-development-${language}-${width}.png`) });
        if (width < 768) {
          await dialog.locator('.merge-development-note').scrollIntoViewIfNeeded();
          const note = await dialog.locator('.merge-development-note').boundingBox();
          const footer = await dialog.locator('footer').boundingBox();
          assert.ok(note.y + note.height <= footer.y, "the merge impact remains readable above the fixed footer");
          await page.screenshot({ path: path.join(output, `merge-development-${language}-${width}-bottom.png`) });
        }
      }
    }
    await changeLocale("zh-CN");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await trigger.evaluate(element => document.activeElement === element), "closing returns focus to the merge action");
    await trigger.click();
    await input.fill("合并后的长标题草稿，失败或切换语言后仍保留");
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const submissions = [];
    const endpoint = `**/api/projects/${fixture.projectId}/tasks/merge`;
    const fail = async route => { submissions.push(route.request().postDataJSON()); await hold; await route.fulfill({ status: 409, json: { error: "模拟合并冲突，标题已保留。" } }); };
    await page.route(endpoint, fail);
    await dialog.locator("footer .primary").click();
    await page.waitForFunction(() => document.querySelector(".merge-development-dialog textarea").disabled);
    assert.equal(await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), true, "saving cannot dismiss the dialog");
    release();
    await page.getByText("模拟合并冲突，标题已保留。", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "合并后的长标题草稿，失败或切换语言后仍保留");
    await dialog.locator("footer .primary").click();
    await page.waitForFunction(() => !document.querySelector(".merge-development-dialog textarea").disabled);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0], "retry preserves request identity and task revisions");
    await page.unroute(endpoint, fail);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    tasks.push(...Array.from({ length: 17 }, (_,index) => ({ ...tasks[index % 3], id: `extra-${index}`, issueIds: [`extra-issue-${index}`] })));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.getByRole("checkbox", { name: "选择当前页全部任务", exact: true }).check();
    await page.getByRole("button", { name: "合并所选任务（20）", exact: true }).click();
    assert.equal(await dialog.locator("li").count(), 20);
    await input.scrollIntoViewIfNeeded();
    const footer = await dialog.locator("footer").boundingBox();
    assert.ok(footer.y + footer.height <= 720, "20-task scope keeps the submit footer reachable");
    await page.screenshot({ path: path.join(output, "merge-development-many-1280.png") });
    await page.keyboard.press("Escape");
  } finally {
    await changeLocale("zh-CN");
    await page.unroute(tasksUrl, respond);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}

module.exports = { verifyMergeDevelopmentDialog };
