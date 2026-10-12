const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { temporary } = require("../support/helpers.cjs");
const { defaultChannels } = require("../../src/channels/channel-registry.cjs");
const { projectInput } = require("../../src/domain/project-input.cjs");
const { getPromptTemplates, promptTemplateCatalog } = require("../../src/domain/prompt-templates.cjs");
const { savePromptSettings } = require("../../src/config/prompt-settings.cjs");
const { ProjectServices } = require("../../src/application/project-services.cjs");
const { presentProject } = require("../../src/application/project-presenter.cjs");
const { serveProjectContent } = require("../../src/http/project-content-api.cjs");

test("retired source settings cannot be submitted or exposed, and do not block manual prompts", async t => {
  const directory = temporary(t);
  const file = path.join(directory, "config.json");
  const legacy = { initCommands: ["npm ci"], tapd: { session: { cookie_header: "retired-secret" } },
    prompts: { manual: "{{title}}\n{{content}}\n{{images}}", tapd: "old template", tapd_fusion: "old fusion template" } };
  fs.writeFileSync(file, JSON.stringify({ ...legacy, prompt_templates: legacy.prompts }));
  const channels = defaultChannels(file, { uploadDirectory: path.join(directory, "uploads") });
  assert.deepEqual((await channels.list()).map(channel => channel.id), ["manual"]);
  assert.equal(channels.get().id, "manual");
  assert.throws(() => channels.get("tapd"), /未接入/);
  for (const settings of [{ tapd: {} }, { prompts: { tapd: null } }, { prompts: { tapd_fusion: "old" } }])
    assert.throws(() => projectInput({ settings, revision: 1 }, true));
  const project = { id: "fixture", settings: legacy };
  const settings = presentProject(project, ["project.configure"]).settings;
  assert.deepEqual(settings, { initCommands: ["npm ci"], prompts: { manual: legacy.prompts.manual } });
  assert.equal(presentProject(project).settings, undefined);
  const services = new ProjectServices({});
  assert.deepEqual(services.settings({}, legacy), settings);
  const context = services.workspaceConfig("workspace", project, { userId: "owner" }, "account", "https://example.test/repo.git", "/recorded/repository", { tapd: legacy.tapd });
  assert.equal(Object.hasOwn(context, "tapd"), false);
  assert.deepEqual(context.prompt_templates, settings.prompts);
  assert.deepEqual(Object.keys(promptTemplateCatalog), ["manual"]);
  assert.deepEqual(getPromptTemplates({ prompt_templates: legacy.prompts }), { manual: legacy.prompts.manual });
  const before = fs.readFileSync(file, "utf8");
  for (const channel of ["tapd", "tapd_fusion"])
    await assert.rejects(savePromptSettings(file, { [channel]: null }), /仅允许/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const saved = await savePromptSettings(file, { manual: null });
  assert.deepEqual(saved, { manual: promptTemplateCatalog.manual.defaultTemplate });
  const resolved = await channels.get().resolve({ requestId: "00000000-0000-4000-8000-000000000001", title: "手动需求", content: "仍可创建" });
  assert.equal(resolved.item.title, "手动需求");
});

test("removed project import routes never dispatch source services", async () => {
  const services = new Proxy({}, { get() { assert.fail("retired route must not call a service"); } });
  for (const method of ["GET", "POST"])
    assert.equal(await serveProjectContent({ method }, {}, new URL("http://localhost/api/projects/project/issues/import/tapd"), { services }), false);
});
