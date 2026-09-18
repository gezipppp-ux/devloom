const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { buildTask } = require("../../src/channels/tapd/task-package.cjs");
const { item, session, temporary } = require("../support/helpers.cjs");

test("TAPD supplementary instructions provide execution content without changing the original description", async (t) => {
  t.mock.method(global, "fetch", () =>
    assert.fail("Plain supplementary text must not download remote images"),
  );
  const directory = temporary(t);
  const supplementary =
    "完善筛选的空状态\n参考说明：![设计草稿](https://example.invalid/draft.png)";
  const workitem = {
    ...item,
    description: "",
    markdown_description: "",
    supplementary_instructions: supplementary,
  };
  const task = await buildTask(workitem, session, directory);
  assert.equal(task.execution_ready, true);
  assert.equal(task.blocked_reason, null);
  assert.deepEqual(task.images, []);
  assert.equal(task.workitem.description, "");
  assert.equal(task.workitem.markdown_description, "");
  assert.ok(
    task.codex_prompt.includes(
      `--- 补充说明与指导意见开始 ---\n${supplementary}\n--- 补充说明与指导意见结束 ---`,
    ),
  );
  assert.match(task.codex_prompt, /TAPD 原始描述为空，请阅读补充说明/);
  assert.doesNotMatch(task.codex_prompt, /仅有图片/);
  assert.equal(
    fs.readFileSync(path.join(directory, "task.md"), "utf8"),
    task.codex_prompt,
  );
  const saved = JSON.parse(
    fs.readFileSync(path.join(directory, "tapd-task.json"), "utf8"),
  );
  assert.equal(saved.workitem.supplementary_instructions, supplementary);
  assert.equal(saved.workitem.description, "");
});

test("omitted or blank TAPD supplementary instructions retain the original execution rules and prompt", async (t) => {
  const original = await buildTask(item, session, temporary(t));
  const blank = await buildTask(
    { ...item, supplementary_instructions: " \n\t " },
    session,
    temporary(t),
  );
  assert.equal(original.execution_ready, true);
  assert.equal(blank.codex_prompt, original.codex_prompt);
  assert.doesNotMatch(blank.codex_prompt, /补充说明与指导意见/);
  const empty = await buildTask(
    {
      ...item,
      description: "<p><br>&nbsp;</p>",
      supplementary_instructions: " \n ",
    },
    session,
    temporary(t),
  );
  assert.equal(empty.execution_ready, false);
  assert.equal(empty.blocked_reason, "TAPD 需求缺少描述和图片。");
});
