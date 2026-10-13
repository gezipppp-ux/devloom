const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateSupplier, supplierSelection } = require("../../src/domain/agent-supplier.cjs");
const { fetchSupplierModels, checkSupplier } = require("../../src/codex/supplier-api.cjs");
const { AppServerClient } = require("../../src/codex/app-server-client.cjs");
const { CodexAgent } = require("../../src/agents/codex-agent.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { readModelCatalog } = require("../../src/codex/model-catalog.cjs");

const input = () => ({ name: "示例", agentType: "codex", baseUrl: "https://example.invalid/v1/", apiKey: "test-only-key", enabled: true,
  models: [{ model: "custom-model", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }], defaultModel: "custom-model" });
test("supplier validation rejects credentials in URLs, invalid defaults and incompatible explicit preferences", () => {
  const supplier = validateSupplier(input());
  assert.equal(supplier.baseUrl, "https://example.invalid/v1");
  for (const patch of [{ baseUrl: "https://user:secret@example.invalid" }, { baseUrl: "file:///etc/passwd" }, { baseUrl: "https://example.invalid/?key=secret" },
    { agentType: "claude" }, { models: [] }, { defaultModel: "unknown" }, { apiKey: "" }, { apiKey: "key\nvalue" }])
    assert.throws(() => validateSupplier({ ...input(), ...patch }));
  const edit = input(); delete edit.apiKey;
  assert.equal(validateSupplier({ ...edit, revision: 1 }, supplier).apiKey, supplier.apiKey);
  assert.deepEqual(supplierSelection(supplier, {}), { model: "", reasoningEffort: "", permissionMode: undefined });
  assert.throws(() => supplierSelection(supplier, { model: "old-model" }), /重新选择/);
  assert.throws(() => supplierSelection(supplier, { model: "custom-model", reasoningEffort: "xhigh" }), /重新选择/);
  for (const reasoningSource of ["codex", "custom"]) {
    const value = input(); value.models[0].reasoningSource = reasoningSource;
    assert.equal(validateSupplier(value).models[0].reasoningSource, reasoningSource);
  }
  const invalid = input(); invalid.models[0].reasoningSource = "guessed";
  assert.throws(() => validateSupplier(invalid), /来源无效/);
});
test("native supplier catalog includes hidden models, uses no thread methods and closes discovery after success or failure", async () => {
  for (const fail of [false, true]) {
    let closed = false; const methods = [];
    const client = { async connect() {}, async close() { closed = true; }, async request(method, params) {
      methods.push(method); assert.equal(params.includeHidden, true);
      if (fail) throw new Error("fixture catalog unavailable");
      return { data: [{ model: "fixture-code", hidden: true, displayName: "Fixture", secret: "not-public",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "high" }] };
    } };
    if (fail) await assert.rejects(readModelCatalog({ client }), /fixture catalog unavailable/);
    else {
      const models = await readModelCatalog({ client });
      assert.equal(models[0].model, "fixture-code");
      assert.deepEqual(models[0].reasoningEfforts, ["low", "high"]);
      assert.equal(models[0].defaultReasoningEffort, "high");
      assert.doesNotMatch(JSON.stringify(models), /secret|not-public/);
    }
    assert.equal(closed, true); assert.deepEqual(methods, ["model/list"]);
  }
});
test("supplier discovery and manual check enforce Responses results and suppress upstream error bodies", async () => {
  const calls = [];
  const connection = { baseUrl: "https://fixture.invalid/v1", apiKey: "fixture-key", model: "custom-model" };
  const fetcher = async (url, options) => { calls.push({ url, options }); return Response.json({ data: [{ id: "custom-model" }, { id: "custom-model" }, { id: "invalid model" }] }); };
  assert.deepEqual(await fetchSupplierModels(connection, fetcher), [{ model: "custom-model", label: "custom-model" }]);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-key");
  const result = await checkSupplier(connection, async (url, options) => {
    assert.equal(url, "https://fixture.invalid/v1/responses");
    assert.deepEqual(JSON.parse(options.body), { model: "custom-model", input: "Reply with OK.", stream: false, store: false, max_output_tokens: 128 });
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] });
  });
  assert.equal(result.ok, true);
  for (const body of [{ choices: [{ message: { content: "OK" } }] }, { status: "incomplete", output: [] }, {}])
    await assert.rejects(checkSupplier(connection, async () => Response.json(body)), /Responses/);
  await assert.rejects(fetchSupplierModels(connection, async () => new Response("fixture-key private diagnostic", { status: 401 })), error => /401/.test(error.message) && !/fixture-key|diagnostic/.test(error.message));
  await assert.rejects(fetchSupplierModels(connection, async () => new Response("x".repeat(1024 * 1024 + 1))), /大小限制/);
  await assert.rejects(fetchSupplierModels(connection, async () => { throw new Error("redirect leaked fixture-key"); }), /无法连接/);
});
test("native diagnostics and response values redact supplier credentials", () => {
  const client = new AppServerClient({}, { supplier: { apiKey: "fixture-secret" } });
  assert.deepEqual(client.redact({ error: { message: "Bearer fixture-secret" }, output: ["fixture-secret"] }), { error: { message: "Bearer [redacted]" }, output: ["[redacted]"] });
});
test("native effort defaults cannot override supplier support and configured defaults work without native discovery", async t => {
  const client = new FakeClient(), supplier = { ...validateSupplier(input()), models: [
    { model: "fixture-model-b", reasoningEfforts: ["low"], defaultReasoningEffort: "" },
    { model: "custom-model", reasoningEfforts: ["high"], defaultReasoningEffort: "high" },
  ] };
  const agent = new CodexAgent({ client, supplier }); t.after(() => agent.close());
  await assert.rejects(agent.prepareTurn({ model: "fixture-model-b", reasoningEffort: "", permissionMode: "ask" }), /默认思考强度不受/);
  client.calls.length = 0;
  const prepared = await agent.prepareTurn({ model: "custom-model", reasoningEffort: "", permissionMode: "ask" });
  assert.equal(prepared.reasoningEffort, "high");
  assert.equal(client.calls.some(call => call.method === "model/list"), false);
  await agent.resumeSession({ sessionId: "fixture", cwd: "/fixture", selection: { model: "fixture-model-b", reasoningEffort: "", permissionMode: "ask" } });
  assert.equal(client.calls.at(-1).params.config, undefined, "unresolved defaults must not send a null TOML override");
});
