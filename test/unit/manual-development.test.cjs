const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { manualDevelopmentInput, manualDevelopmentPrompt } = require("../../src/domain/project-development.cjs");
const { getPromptTemplates } = require("../../src/domain/prompt-templates.cjs");

test("independent development accepts text or images and rejects invalid source and execution fields", () => {
  const input = { requestId: randomUUID(), title: "独立开发", content: "验收目标", baseBranch: "main" };
  assert.equal(Object.hasOwn(manualDevelopmentInput(input), "taskType"), false);
  assert.equal(manualDevelopmentInput({ ...input, content: "", images: [randomUUID()] }).images.length, 1);
  for (const patch of [{ content: null }, { images: null }, { title: " " }, { content: " " }, { taskType: "invalid" }, { baseBranch: "HEAD" }, { executorId: randomUUID() }, { issueIds: [randomUUID()] }, { images: ["../foreign"] }])
    assert.throws(() => manualDevelopmentInput({ ...input, ...patch }), { statusCode: 400 });
  const image = randomUUID();
  assert.throws(() => manualDevelopmentInput({ ...input, images: [image, image] }), { statusCode: 400 });
});

test("independent prompts apply the development template once and bound the rendered instruction", () => {
  const request = manualDevelopmentInput({ requestId: randomUUID(), title: "独立修复", content: "$& {{title}}", images: [], baseBranch: "main" });
  const templates = { ...getPromptTemplates(), requirement: "Development {{title}}\n{{content}}\n{{images}}" };
  assert.match(manualDevelopmentPrompt(request, templates), /Development 独立修复\n\$& \{\{title\}\}/);
  assert.throws(() => manualDevelopmentPrompt({ ...request, content: "a".repeat(40000) }, { ...templates, requirement: "{{title}}{{content}}{{content}}{{images}}" }), { statusCode: 400 });
});
