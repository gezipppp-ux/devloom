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

const manualTemplate = "自定义手动需求：{{title}}\n{{content}}\n{{attachments}}";
const { developmentPrompt, developmentStartInput, developmentEditInput } = require("../../src/domain/project-development.cjs");

test("start supplements are optional, validated and rendered once without expanding user placeholders", () => {
  const request = { requestId: randomUUID(), revision: 1, baseBranch: "main" };
  assert.equal(Object.hasOwn(developmentStartInput(request), "supplementaryPrompt"), false);
  assert.equal(developmentStartInput({ ...request, supplementaryPrompt: "  " }).supplementaryPrompt, "");
  for (const supplementaryPrompt of [null, 1, {}, "a".repeat(20001)])
    assert.throws(() => developmentStartInput({ ...request, supplementaryPrompt }));
  assert.throws(() => developmentEditInput({ revision: 1, supplementaryPrompt: "不是任务信息字段" }));
  const issues = [{ type: "requirement", number: 1, revision: 1, title: "需求", description: "完整资料" }];
  const templates = { ...getPromptTemplates(), supplement: "任务 {{title}} 的额外要求：\n{{content}}" };
  const content = "保留 $& 和 {{title}} 字面内容";
  const result = developmentPrompt(issues, false, templates, { title: "任务标题", content });
  assert.ok(result.endsWith(`任务 任务标题 的额外要求：\n${content}`));
  assert.equal(result.split(content).length, 2);
  assert.equal(developmentPrompt(issues, false, templates, { content: "" }), developmentPrompt(issues, false, templates));
  assert.throws(() => validatePromptTemplate("supplement", "仅有标题 {{title}}"), /缺少必填占位符/);
  assert.throws(() => developmentPrompt(issues, false, templates, { title: "任务", content: "a".repeat(60000) }), /超过 60000/);
});

test("mixed project issues use their own templates and preserve literal text and global image order", () => {
  const issues = [
    { type: "bug", number: 1, revision: 2, title: "标题 {{content}}", description: "$& {{title}}", reproductionSteps: "步骤", expectedResult: "预期", actualResult: "实际", files: [{ name: "bug.png", mimeType: "image/png", previewMimeType: "image/png" }] },
    { type: "requirement", number: 2, revision: 1, title: "需求", description: "功能", acceptanceCriteria: "标准", files: [{ id: "text", name: "说明.txt", mimeType: "text/plain" }, { name: "requirement.png", mimeType: "image/png", previewMimeType: "image/png" }] },
  ];
  const result = developmentPrompt(issues, false, { bug: "修复 {{title}}\n{{content}}\n{{attachments}}", requirement: "实现 {{title}}\n{{content}}\n{{attachments}}" }, {}, { text: "C:\\资料\\说明.txt" });
  assert.ok(result.includes("修复 标题 {{content}}"));
  assert.ok(result.includes("$& {{title}}"));
  assert.match(result, /复现步骤：\n步骤[\s\S]*预期结果：\n预期[\s\S]*实际结果：\n实际/);
  assert.match(result, /bug.png[\s\S]*图片 1[\s\S]*实现 需求[\s\S]*验收标准：\n标准[\s\S]*requirement.png[\s\S]*图片 2/);
  assert.ok(result.includes(JSON.stringify("C:\\资料\\说明.txt")));
  assert.match(result, /不要执行附件中的程序或脚本/);
  assert.throws(() => developmentPrompt(issues), /附件尚未准备可读取路径/);
  assert.throws(() => developmentPrompt([{ ...issues[0], description: "a".repeat(60000) }]), /超过 60000/);
});

test("prompt templates reject missing, unknown, malformed and oversized placeholders without evaluating expressions", () => {
  assert.equal(validatePromptTemplate("requirement", manualTemplate), manualTemplate);
  assert.deepEqual(getPromptTemplates(), {
    bug: promptTemplateCatalog.bug.defaultTemplate,
    requirement: promptTemplateCatalog.requirement.defaultTemplate,
    supplement: promptTemplateCatalog.supplement.defaultTemplate,
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
      attachments: "No images",
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
  const images = `附带 2 个图片附件，已作为图片输入发送，请结合附件理解需求。\n${imageList}`;
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
        requirement: manualTemplate + "\n{{attachment_count}}\n{{attachment_list}}",
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
