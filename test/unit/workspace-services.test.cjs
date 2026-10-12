const assert = require("node:assert/strict");
const { test } = require("node:test");
const { WorkspaceServices } = require("../../src/application/workspace-services.cjs");
const { DEFAULT_ACCOUNT_SETTINGS } = require("../../src/domain/account.cjs");
const { createAgent } = require("../../src/agents/registry.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");

function services() {
  const client = new FakeClient();
  const agent = createAgent({ provider: "codex", client });
  return new WorkspaceServices({
    channels: {},
    sessions: {
      async start(input) {
        await agent.validateSelection(input);
        return input;
      },
    },
  });
}

test("new runs translate unset personal defaults into the valid native default selection", async () => {
  const input = { channel: "manual", title: "fixture" };
  const result = await services().startRun(input, DEFAULT_ACCOUNT_SETTINGS);
  assert.deepEqual(result, { ...input, model: "", reasoningEffort: "", permissionMode: "ask" });
  assert.deepEqual(input, { channel: "manual", title: "fixture" });
});

test("new runs inherit personal selections while explicit empty selections override them", async () => {
  const defaults = { model: "fixture-model-b", reasoningEffort: "medium", permissionMode: "full" };
  assert.deepEqual(await services().startRun({}, defaults), defaults);
  assert.deepEqual(await services().startRun({ model: "", reasoningEffort: "", permissionMode: "ask" }, defaults), {
    model: "", reasoningEffort: "", permissionMode: "ask",
  });
  assert.deepEqual(await services().startRun({ title: "no account context" }), { title: "no account context" });
});

test("explicit null execution selections still fail validation instead of inheriting defaults", async () => {
  for (const input of [{ model: null }, { reasoningEffort: null }])
    await assert.rejects(services().startRun(input, DEFAULT_ACCOUNT_SETTINGS), /无效的模型或思考强度/);
});
