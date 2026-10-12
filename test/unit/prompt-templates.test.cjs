const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const {
  promptTemplateCatalog,
  MAX_PROMPT_TEMPLATE_LENGTH,
  getPromptTemplates,
  validatePromptTemplate,
  renderPromptTemplate,
} = require("../../src/domain/prompt-templates.cjs");
const {
  readPromptSettings,
  savePromptSettings,
} = require("../../src/config/prompt-settings.cjs");
const {
  buildManualTaskPackage,
} = require("../../src/channels/manual/task-package.cjs");
const {
  temporary,
  png,
} = require("../support/helpers.cjs");

const manualTemplate = "自定义手动需求：{{title}}\n{{content}}\n{{images}}";
const { developmentPrompt } = require("../../src/domain/project-development.cjs");

test("mixed project issues use their own templates and preserve literal text and global image order", () => {
  const issues = [
    { type: "bug", number: 1, revision: 2, title: "标题 {{content}}", description: "$& {{title}}", reproductionSteps: "步骤", expectedResult: "预期", actualResult: "实际", files: [{ name: "bug.png", mimeType: "image/png" }] },
    { type: "requirement", number: 2, revision: 1, title: "需求", description: "功能", acceptanceCriteria: "标准", files: [{ name: "ignored.txt", mimeType: "text/plain" }, { name: "requirement.png", mimeType: "image/png" }] },
  ];
  const result = developmentPrompt(issues, false, { bug: "修复 {{title}}\n{{content}}\n{{images}}", requirement: "实现 {{title}}\n{{content}}\n{{images}}" });
  assert.ok(result.includes("修复 标题 {{content}}"));
  assert.ok(result.includes("$& {{title}}"));
  assert.match(result, /复现步骤：\n步骤[\s\S]*预期结果：\n预期[\s\S]*实际结果：\n实际/);
  assert.match(result, /图片 1：bug.png[\s\S]*实现 需求[\s\S]*验收标准：\n标准[\s\S]*图片 2：requirement.png/);
  assert.throws(() => developmentPrompt([{ ...issues[0], description: "a".repeat(60000) }]), /超过 60000/);
});

test("prompt templates reject missing, unknown, malformed and oversized placeholders without evaluating expressions", () => {
  assert.equal(validatePromptTemplate("requirement", manualTemplate), manualTemplate);
  assert.deepEqual(getPromptTemplates(), {
    bug: promptTemplateCatalog.bug.defaultTemplate,
    requirement: promptTemplateCatalog.requirement.defaultTemplate,
  });
  for (const invalid of [
    null,
    1,
    {},
    [],
    " \n ",
    "仅有标题 {{title}}",
    manualTemplate + "{{unknown}}",
    manualTemplate + "{{title",
    manualTemplate + "title}}",
    manualTemplate + "{{{title}}}",
    manualTemplate + "{{process.exit()}}",
    manualTemplate + "{{ title }}",
    "a".repeat(MAX_PROMPT_TEMPLATE_LENGTH + 1) + manualTemplate,
  ])
    assert.throws(() => validatePromptTemplate("requirement", invalid));
  assert.throws(() => validatePromptTemplate("unknown", manualTemplate));
  for (const invalid of [null, [], "template", { requirement: null }, { other: "text" }])
    assert.throws(() => getPromptTemplates({ prompt_templates: invalid }));
  const content = "{{title}} {{unknown}} ${process.exit(1)} $& $` $'";
  assert.equal(
    renderPromptTemplate("requirement", manualTemplate, {
      title: "Literal $& title",
      content,
      images: "No images",
    }),
    `自定义手动需求：Literal $& title\n${content}\nNo images`,
  );
  assert.throws(
    () => renderPromptTemplate("requirement", manualTemplate, { title: "Only title" }),
    /缺少填充值/,
  );
});

test("workspace prompt settings preserve credentials and execution configuration, support partial updates and reset overrides", async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, "config.json");
  const defaults = (await readPromptSettings(file));
  const retained = {
    version: 3,
    workspace: { id: randomUUID(), name: "独立工作区" },
    execution: { repository: "example", baseBranch: "" },
    workflow: { allow_write: true },
    future_setting: { enabled: true },
  };
  fs.writeFileSync(file, JSON.stringify(retained));
  assert.deepEqual((await savePromptSettings(file, { requirement: manualTemplate })), {
    ...defaults, requirement: manualTemplate,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    ...retained,
    prompt_templates: { requirement: manualTemplate },
  });
  const before = fs.readFileSync(file, "utf8");
  for (const invalid of [
    null,
    [],
    "bad",
    { extra: "bad" },
    { requirement: undefined },
    { requirement: 1 },
    { requirement: " " },
    { requirement: manualTemplate, tapd: "missing placeholders" },
  ]) {
    (await assert.rejects(async () => (await savePromptSettings(file, invalid))));
    assert.equal(fs.readFileSync(file, "utf8"), before);
  }
  assert.deepEqual((await savePromptSettings(file, { requirement: null })), defaults);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), retained);
  assert.deepEqual(fs.readdirSync(directory), ["config.json"]);
});

test("manual default prompt retains full content and exact image order, and custom templates keep real attachments", async (t) => {
  const directory = temporary(t);
  const workitem = {
    id: randomUUID(),
    title: "标题中的 {{content}}",
    markdown_description: "需求\n" + "内容".repeat(30000),
    image_ids: ["first", "second"],
  };
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const readImage = (id) => ({
    bytes: id === "first" ? png : jpeg,
    extension: id === "first" ? "png" : "jpg",
  });
  const original = (await buildManualTaskPackage({ item: workitem, directory, readImage }));
  const imageList = original.task.images
    .map((image) => `图片 ${image.index}：${image.path}`)
    .join("\n");
  const images = `附带 2 张本地图片，顺序与用户上传顺序一致，请结合图片理解需求。\n${imageList}`;
  assert.ok(original.task.prompt.includes(workitem.markdown_description));
  assert.ok(original.task.prompt.includes(`标题：${workitem.title}`));
  assert.ok(original.task.prompt.includes(images));
  assert.match(original.task.prompt, /验收标准/);
  const custom = (await buildManualTaskPackage({
    item: workitem,
    directory,
    readImage,
    config: {
      prompt_templates: {
        requirement: manualTemplate + "\n{{image_count}}\n{{image_list}}",
      },
    },
  }));
  assert.equal(
    custom.task.prompt,
    `自定义手动需求：${workitem.title}\n${workitem.markdown_description}\n${images}\n2\n${imageList}`,
  );
  assert.deepEqual(custom.task.images, original.task.images);
  assert.deepEqual(fs.readFileSync(custom.task.images[0].path), png);
  assert.deepEqual(fs.readFileSync(custom.task.images[1].path), jpeg);
  assert.equal(custom.task.execution_ready, true);
});
