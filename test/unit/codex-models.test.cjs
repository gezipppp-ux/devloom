const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listModels,
  validateModelSelection,
  resolveTurnModel,
} = require("../../src/codex/models.cjs");
const { FakeClient } = require('../fixtures/web-client.cjs');

test("model discovery paginates, filters hidden entries and only returns picker metadata", async () => {
  const calls = [];
  const client = {
    async connect() {
      calls.push("connect");
    },
    async request(method, params) {
      calls.push({ method, params });
      return params.cursor
        ? {
            data: [
              {
                model: "b",
                displayName: "B",
                supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              },
            ],
            nextCursor: null,
          }
        : {
            data: [
              {
                model: "a",
                displayName: "A",
                secret: "omit-me",
                defaultReasoningEffort: "low",
                supportedReasoningEfforts: [
                  { reasoningEffort: "low" },
                  { reasoningEffort: "future_effort" },
                  { reasoningEffort: "low" },
                  { reasoningEffort: "../bad" },
                ],
              },
              { model: "hidden", hidden: true },
            ],
            nextCursor: "page2",
          };
    },
  };
  const models = await listModels(client);
  assert.deepEqual(
    models.map((entry) => entry.model),
    ["a", "b"],
  );
  assert.deepEqual(models[0].reasoningEfforts, ["low", "future_effort"]);
  assert.equal(JSON.stringify(models).includes("omit-me"), false);
  assert.equal(
    calls.filter((entry) => entry.method === "model/list").length,
    2,
  );
  assert.equal(calls[2].params.cursor, "page2");
});

test('turn defaults resolve concrete model and effort so cleared overrides do not inherit old selections', async () => {
  const client = new FakeClient();
  assert.deepEqual(await resolveTurnModel(client, { model: '', reasoningEffort: '' }, '/fixture'), {
    model: 'fixture-model-a', effort: 'low',
  });
  assert.deepEqual(client.calls.find(({ method }) => method === 'config/read').params, {
    cwd: '/fixture', includeLayers: false,
  });
  client.calls.length = 0;
  assert.deepEqual(await resolveTurnModel(client, { model: 'fixture-model-b', reasoningEffort: '' }, '/fixture'), {
    model: 'fixture-model-b', effort: 'medium',
  });
  assert.equal(client.calls.some(({ method }) => method === 'config/read'), false,
    'explicit model must use its own default effort');
  client.calls.length = 0;
  assert.deepEqual(await resolveTurnModel(client, { model: 'fixture-model-b', reasoningEffort: 'low' }, '/fixture'), {
    model: 'fixture-model-b', effort: 'low',
  });
  assert.equal(client.calls.length, 0, 'validated concrete settings need no second discovery');
});

test('default resolution falls back to catalog and fails closed when configuration cannot be determined', async () => {
  for (const [config, data, expected] of [
    [{}, [{ model: 'a', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], { model: 'a', effort: 'low' }],
    [{ model: 'a', model_reasoning_effort: 'high' }, [{ model: 'a', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }], { model: 'a', effort: 'high' }],
    [{}, [], null],
    [{ model: 'bad model' }, [], null],
    [{ model: 'a' }, [{ model: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], null],
    [{ model: 'a', model_reasoning_effort: 'high' }, [{ model: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], null],
  ]) {
    const client = { async connect() {}, async request(method) { return method === 'config/read' ? { config } : { data }; } };
    const result = resolveTurnModel(client, { model: '', reasoningEffort: '' }, '/fixture');
    if (expected) assert.deepEqual(await result, expected);
    else await assert.rejects(result, /默认/);
  }
  await assert.rejects(resolveTurnModel({
    async connect() {}, async request() { throw new Error('fixture config unavailable'); },
  }, { model: '', reasoningEffort: '' }, '/fixture'), /fixture config unavailable/);
});

test("model discovery rejects broken responses and repeated cursors without creating a session", async () => {
  for (const result of [{}, { data: [], nextCursor: "repeat" }]) {
    const calls = [];
    await assert.rejects(
      listModels({
        async connect() {},
        async request(method) {
          calls.push(method);
          return result;
        },
      }),
      /模型列表/,
    );
    assert.ok(calls.every((method) => method === "model/list"));
    assert.ok(calls.length <= 2);
  }
});

test("task selection validates advertised combinations and defaults without discovery", async () => {
  const client = {
    async connect() {},
    async request() {
      return {
        data: [
          {
            model: "a",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
      };
    },
  };
  await validateModelSelection(
    client,
    { model: "a", reasoningEffort: "low" },
    {},
  );
  await assert.rejects(
    validateModelSelection(client, { model: "a", reasoningEffort: "high" }, {}),
    /不支持/,
  );
  await assert.rejects(
    validateModelSelection(client, { model: "missing" }, {}),
    /可用列表/,
  );
  await assert.rejects(
    validateModelSelection(client, { model: "", reasoningEffort: "low" }, {}),
    /先选择/,
  );
  await assert.rejects(
    validateModelSelection(
      client,
      { model: "a", reasoningEffort: "../bad" },
      {},
    ),
    /无效/,
  );
  const offline = {
    async connect() {
      throw new Error("offline");
    },
  };
  assert.deepEqual(await validateModelSelection(offline, {}), {
    model: "",
    reasoning_effort: "",
  });
  await assert.rejects(
    validateModelSelection(offline, { model: "old", reasoningEffort: "high" }),
    /offline/,
  );
  for (const input of [
    { model: null },
    { model: "bad model" },
    { model: "x".repeat(101) },
    { reasoningEffort: 0 },
    { reasoningEffort: null },
    { reasoningEffort: false },
  ]) {
    await assert.rejects(validateModelSelection(client, input), /无效/);
  }
});
