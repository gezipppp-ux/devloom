const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { createTapdChannel } = require("../../src/channels/tapd/adapter.cjs");
const { ChannelRegistry } = require("../../src/channels/registry.cjs");
const { WebSessions } = require("../../src/application/sessions.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const {
  item,
  session,
  temporary,
  workflow,
} = require("../support/helpers.cjs");

const input = {
  channel: "tapd",
  id: item.id,
  workspace: item.workspace_id,
  developer: "开发人员",
  tester: "测试人员",
};

function fixture(t, config = {}, dependencies = {}) {
  const directory = temporary(t);
  const configFile = path.join(directory, "config.json");
  fs.writeFileSync(
    configFile,
    JSON.stringify({ tapd: { session }, ...config }),
  );
  const channel = createTapdChannel(configFile, {
    searchUsers: async (_session, { query }) => [{ nick: query }],
    detail: async () => item,
    workflowInfo: async () => workflow,
    ...dependencies,
  });
  return { directory, configFile, channel };
}

test("TAPD resolves only optional bounded text and keeps supplements out of workflow fields", async (t) => {
  let userSearches = 0;
  const { channel, directory } = fixture(
    t,
    {},
    {
      searchUsers: async (_session, { query }) => {
        userSearches += 1;
        return [{ nick: query }];
      },
    },
  );
  for (const supplementaryInstructions of [
    null,
    false,
    42,
    {},
    [],
    "a".repeat(60001),
  ]) {
    await assert.rejects(
      channel.resolve({ ...input, supplementaryInstructions }),
      /补充说明必须是文本，最多 60000 字/,
    );
  }
  assert.equal(userSearches, 0);
  for (const supplementaryInstructions of [undefined, "", " \n\t "]) {
    const resolved = await channel.resolve({
      ...input,
      supplementaryInstructions,
    });
    assert.equal(
      Object.hasOwn(resolved.item, "supplementary_instructions"),
      false,
    );
  }
  const maximum = await channel.resolve({
    ...input,
    supplementaryInstructions: "测".repeat(60000),
  });
  assert.equal(maximum.item.supplementary_instructions.length, 60000);
  const resolved = await channel.resolve({
    ...input,
    supplementaryInstructions: " \n完善筛选\n保留原有交互 \t ",
  });
  const original = structuredClone(item);
  const prepared = await channel.prepare({ ...resolved, directory });
  assert.equal(
    prepared.workitem.supplementary_instructions,
    "完善筛选\n保留原有交互",
  );
  assert.deepEqual(item, original);
  assert.equal(prepared.workitem.description, original.description);
  assert.deepEqual(resolved.config.workflow.fields, {
    developer: "开发人员;",
    custom_field_one: "测试人员;",
    owner: "开发人员;",
  });
});

test("HTTP TAPD supplements reach the first Codex prompt and persist in task and run snapshots", async (t) => {
  const original = { ...item, markdown_description: "原始 Markdown 需求说明" };
  const transitionItems = [];
  const { directory, configFile, channel } = fixture(
    t,
    {},
    {
      detail: async () => original,
      applyTransition: async (_session, workitem, configuration) => {
        transitionItems.push(structuredClone(workitem));
        assert.equal(
          Object.hasOwn(configuration.fields, "supplementary_instructions"),
          false,
        );
        return { verified_status: "developing" };
      },
    },
  );
  const repository = path.join(directory, "repository");
  fs.mkdirSync(repository);
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture repository");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture",
  );
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      tapd: { session },
      codex: {
        repository,
        worktree_root: path.join(directory, "trees"),
        base_ref: "main",
      },
    }),
  );
  const channels = new ChannelRegistry([channel]);
  const client = new FakeClient();
  const manager = new WebSessions({
    runsDirectory: path.join(directory, "runs"),
    configFile,
    channels,
    client,
  });
  const application = createWebServer({ configFile, manager, channels });
  const url = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${url}/api/bootstrap`)).json();
  const post = (supplementaryInstructions) =>
    fetch(`${url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tapd-token": token },
      body: JSON.stringify({ ...input, supplementaryInstructions }),
    });
  for (const invalid of [null, 1, {}, "a".repeat(60001)]) {
    const response = await post(invalid);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /补充说明/);
  }
  assert.equal(manager.sessions.size, 0);
  assert.equal(
    client.calls.some((call) => call.method === "thread/start"),
    false,
  );
  const supplement = "请优先完善筛选的空状态\n指导意见：沿用已有组件与权限规则";
  const response = await post(` \n${supplement}\n `);
  assert.equal(response.status, 202);
  const { key } = await response.json();
  const runtime = manager.sessions.get(key);
  for (let attempts = 0; !runtime.turnId && attempts < 500; attempts += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(runtime.turnId, "Fake Codex should receive the first turn");
  client.notify("turn/completed", {
    turn: { id: runtime.turnId, status: "completed" },
  });
  await runtime.operation;
  const state = manager.store.read(key);
  assert.equal(state.execution.status, "completed");
  assert.equal(state.workitem.supplementary_instructions, supplement);
  assert.equal(state.workitem.description, original.description);
  assert.equal(
    state.workitem.markdown_description,
    original.markdown_description,
  );
  assert.equal(Object.hasOwn(original, "supplementary_instructions"), false);
  assert.deepEqual(state.source, { channel: "tapd", scope: "1", id: item.id });
  const firstTurn = client.calls.find((call) => call.method === "turn/start");
  const prompt = firstTurn.params.input[0].text;
  assert.ok(
    prompt.includes(
      `--- 需求内容开始 ---\n${original.markdown_description}\n--- 需求内容结束 ---`,
    ),
  );
  assert.ok(
    prompt.includes(
      `--- 补充说明与指导意见开始 ---\n${supplement}\n--- 补充说明与指导意见结束 ---`,
    ),
  );
  for (const filename of ["requirement.json", "tapd-task.json"]) {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(manager.store.dir(key), filename), "utf8"),
    );
    assert.equal(snapshot.workitem.supplementary_instructions, supplement);
    assert.equal(snapshot.workitem.description, original.description);
    assert.equal(snapshot.codex_prompt, prompt);
  }
  assert.equal(transitionItems.length, 1);
  assert.equal(transitionItems[0].description, original.description);
  assert.equal(git("branch", "--show-current"), "main");
});
