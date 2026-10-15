/* global document */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setMarkdown } = require("../support/issue-markdown.cjs");

async function verifyWorkflowIssueFields({ page, origin, issue }) {
  const output = path.resolve("state/browser/project-editing");
  fs.mkdirSync(output, { recursive: true });
  for (const [type, fields] of [["requirement", [["reproductionSteps", "复现步骤"], ["expectedResult", "预期结果"], ["actualResult", "实际结果"]]], ["bug", [["acceptanceCriteria", "验收标准"]]]]) {
    let current = { ...issue, type, revision: 1, title: `流程必填资料 ${type}`, workflow: { version: 1, definition: { nodes: [], transitions: [{ requiredFields: fields.map(([key]) => key) }] } } };
    const writes = [];
    const route = async route => {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        writes.push(input);
        current = { ...current, ...input, revision: current.revision + 1 };
      }
      await route.fulfill({ json: current });
    };
    await page.route("**/api/projects/p/issues/i", route);
    try {
      await page.goto(`${origin}/fixture?fixture=issue`);
      await page.getByRole("button", { name: "编辑事项", exact: true }).click();
      for (const [key, label] of fields) await setMarkdown(page, label, `${key} 已补齐`);
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
        await page.screenshot({ path: path.join(output, `workflow-fields-${type}-${width}.png`), fullPage: true });
      }
      await page.getByRole("button", { name: "保存事项", exact: true }).click();
      await page.getByRole("button", { name: "编辑事项", exact: true }).waitFor();
      for (const [key, label] of fields) {
        assert.equal(writes.at(-1)[key], `${key} 已补齐`);
        await page.getByRole("heading", { name: label, exact: true }).waitFor();
        await page.getByText(`${key} 已补齐`, { exact: true }).waitFor();
      }
    } finally { await page.unroute("**/api/projects/p/issues/i", route); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

module.exports = { verifyWorkflowIssueFields };
