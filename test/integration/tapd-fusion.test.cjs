const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { WorkspaceServices } = require("../../src/application/workspace-services.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { savePromptSettings } = require("../../src/config/prompt-settings.cjs");
const { fusionFixture, fusionInput, waitForTurn, finishTurn } = require("../support/tapd-fusion.cjs");

for (const database of [true, false]) test(`fusion preserves each source and one worktree, appends without sending, and continues once (${database ? "PostgreSQL" : "file fixture"})`, async t => {
  const { manager, client, store, configFile, channel, git } = await fusionFixture(t, { database });
  const input = fusionInput();
  const { key } = await manager.start(input);
  await waitForTurn(manager, key);
  assert.equal(client.calls.filter(call => call.method === "thread/start").length, 1);
  const start = client.calls.find(call => call.method === "turn/start");
  assert.equal(start.params.input.filter(part => part.type === "localImage").length, 2);
  assert.match(start.params.input[0].text, /验收 11/);
  assert.match(start.params.input[0].text, /验收 12/);
  assert.match(start.params.input[0].text, /共同根因/);
  assert.equal(git("branch", "--show-current"), "main");
  const state = (await store.read(key));
  const original = (await store.readTask(key));
  const oldImage = fs.readFileSync((await store.imagePath(key, "0")));
  const repeated = await manager.start(input);
  assert.equal(repeated.reused, true);
  await assert.rejects(manager.start({ ...input, title: "不同内容" }), /已有运行记录|不同需求/);
  const addition = { ...fusionInput(["13"]), items: [{ id: "13" }] };
  await assert.rejects(manager.requirements.append(key, addition), /正在执行/);
  await finishTurn(manager, client, key);
  const before = client.calls.filter(call => call.method === "turn/start").length;
  const template = "追加专用模板\n{{title}}\n{{requirements}}\n{{supplement}}\n{{images}}";
  (await savePromptSettings(configFile, { tapd_fusion: template }));
  const response = await manager.requirements.append(key, addition);
  assert.equal(response.requirement.additions[0].status, "ready");
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, before);
  assert.deepEqual((await store.readTask(key)), original);
  assert.deepEqual(fs.readFileSync((await store.imagePath(key, "0"))), oldImage);
  assert.equal((await manager.list())[0].requirementCount, 3);
  assert.match(response.requirement.additions[0].requirement.prompt, /^追加专用模板/);
  assert.equal(response.requirement.additions[0].requirement.requirements[0].type, "board_card");
  (await savePromptSettings(configFile, { tapd_fusion: template.replace("追加专用模板", "后续模板") }));
  await manager.requirements.append(key, addition);
  assert.equal((await store.requirements.read(key)).additions.length, 1);
  await assert.rejects(manager.requirements.append(key, { ...addition, items: [{ id: "14", type: "story" }] }), /不同需求/);
  await assert.rejects(manager.start({ channel: "tapd", workspace: "1", id: "13" }), /归属任务/);
  const beforeSnapshot = (await store.read(key));
  await manager.requirements.continue(key, addition.requestId);
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, before + 1);
  const followup = client.calls.filter(call => call.method === "turn/start").at(-1);
  assert.equal(followup.params.threadId, state.session_id);
  assert.match(followup.params.input[0].text, /验收 13/);
  assert.match(followup.params.input[0].text, /追加专用模板/);
  assert.doesNotMatch(followup.params.input[0].text, /后续模板/);
  assert.equal(followup.params.input.filter(part => part.type === "localImage").length, 1);
  assert.deepEqual((await store.read(key)).worktree, beforeSnapshot.worktree);
  assert.equal((await store.read(key)).source.id, state.source.id);
  await manager.requirements.continue(key, addition.requestId);
  assert.equal(client.calls.filter(call => call.method === "turn/start").length, before + 1);
  await finishTurn(manager, client, key);
  await manager.archive(key);
  const services = new WorkspaceServices({ configFile, channels: manager.channels, sessions: manager });
  const rows = await services.search("tapd", { workspace: "1" });
  for (const id of ["11", "12", "13"]) {
    assert.equal(rows.find(item => item.id === id).localRun.key, key);
    assert.equal(rows.find(item => item.id === id).localRun.archived, true);
  }
  await manager.close();
  const restarted = new SessionManager({ store: new RunStore(store.directory), configFile,
    client: new FakeClient(), channels: manager.channels });
  t.after(() => restarted.close());
  const snapshot = await restarted.view(key);
  assert.equal(snapshot.requirementCount, 3);
  assert.equal(snapshot.requirement.requirements[1].id, "12");
  assert.equal(snapshot.requirement.additions[0].status, "sent");
  assert.ok(snapshot.requirement.additions[0].requirement.requirements[0].images[0].url.includes("addition-images"));
  assert.equal(channel.id, "tapd");
});

test("failed preparation is atomic; overlapping starts and appends cannot claim the same source", async t => {
  const context = await fusionFixture(t);
  const { manager, client, store } = context;
  const { key } = await manager.start(fusionInput());
  await waitForTurn(manager, key);
  await finishTurn(manager, client, key);
  const before = (await store.requirements.read(key));
  context.failId = "14";
  await assert.rejects(manager.requirements.append(key, fusionInput(["13", "14"])), /模拟资料读取失败/);
  assert.deepEqual((await store.requirements.read(key)), before);
  assert.equal((await store.requirements.assignments()).has("1-13"), false);
  context.failId = null;
  let release;
  context.detailGate = new Promise(resolve => { release = resolve; });
  const append = manager.requirements.append(key, fusionInput(["13"]));
  await new Promise(resolve => setTimeout(resolve, 20));
  const other = await manager.start(fusionInput(["13", "15"]));
  release();
  await assert.rejects(append, /归属任务/);
  await waitForTurn(manager, other.key);
  await finishTurn(manager, client, other.key);
  assert.deepEqual((await store.requirements.read(key)), before);
  assert.equal((await store.requirements.assignments()).get("1-13"), other.key);
});

test("failed Web preparation cannot release a concurrent CLI reservation", async t => {
  const { manager, store } = await fusionFixture(t);
  const key = "1-11";
  (await store.requirements.claim(key, [{ channel: "tapd", scope: "1", id: "11" }]));
  fs.mkdirSync(path.join(store.dir(key), ".lock"), { recursive: true });
  const result = await manager.start({ channel: "tapd", workspace: "1", id: "11" });
  await manager.sessions.get(result.key)?.operation;
  assert.equal((await store.requirements.assignments()).get("1-11"), key);
  await assert.rejects(manager.start(fusionInput(["11", "12"])), /归属任务/);
  fs.rmdirSync(path.join(store.dir(key), ".lock"));
  (await store.requirements.releaseUnstarted(key));
  assert.equal((await store.requirements.assignments()).has("1-11"), false);
});

test("append failures before dispatch stay ready; unknown RPC outcome is persisted and cannot replay after restart", async t => {
  const { manager, client, configFile, store } = await fusionFixture(t);
  const { key } = await manager.start(fusionInput());
  await waitForTurn(manager, key);
  await finishTurn(manager, client, key);
  const input = fusionInput(["13"]);
  await manager.requirements.append(key, input);
  const originalRequest = client.request.bind(client);
  client.request = async (method, params) => {
    if (method === "config/read") throw new Error("模拟模型读取失败");
    return originalRequest(method, params);
  };
  await assert.rejects(manager.requirements.continue(key, input.requestId), /模拟模型读取失败/);
  assert.equal((await store.requirements.read(key)).additions[0].status, "ready");
  client.request = async (method, params) => {
    if (method === "turn/start") throw new Error("模拟响应丢失");
    return originalRequest(method, params);
  };
  await assert.rejects(manager.requirements.continue(key, input.requestId), /模拟响应丢失/);
  assert.equal((await store.requirements.read(key)).additions[0].status, "uncertain");
  await manager.close();
  const replacement = new FakeClient();
  const restarted = new SessionManager({ store: new RunStore(store.directory), client: replacement, configFile, channels: manager.channels });
  t.after(() => restarted.close());
  await assert.rejects(restarted.requirements.continue(key, input.requestId), /不会自动重发/);
  assert.equal(replacement.calls.filter(call => call.method === "turn/start").length, 0);
});

test("legacy single TAPD task accepts additions without changing its original identity; HTTP serves only attached images", async t => {
  const { manager, client, store, configFile } = await fusionFixture(t);
  const { key } = await manager.start({ channel: "tapd", workspace: "1", id: "11" });
  await waitForTurn(manager, key);
  await finishTurn(manager, client, key);
  // Reproduce a pre-feature record with no membership document.
  (await store.database.deleteDocument(store.requirements.file(key)));
  const state = (await store.read(key));
  const input = fusionInput(["12"]);
  const application = createWebServer({ manager, configFile, testIdentity: true });
  t.after(() => application.close());
  const origin = await application.listen(0);
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const post = (route, body) => fetch(`${origin}/api/runs/${key}/${route}`, { method: "POST", headers: {
    origin, "x-tapd-token": token, "content-type": "application/json",
  }, body: JSON.stringify(body) });
  const response = await post("requirements", input);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  const image = result.requirement.additions[0].requirement.requirements[0].images[0];
  assert.equal((await fetch(`${origin}${image.url}`)).status, 200);
  assert.equal((await fetch(`${origin}/api/runs/${key}/addition-images/${fusionInput().requestId}/0`)).status, 400);
  assert.deepEqual((await store.read(key)).source, state.source);
  assert.equal((await manager.list())[0].requirementCount, 2);
  assert.equal((await store.requirements.assignments()).get("1-11"), key);
  await assert.rejects(manager.requirements.append(key, { ...fusionInput(["13"]), workspace: "2" }), /同一个 TAPD 项目/);
  assert.equal(path.basename(store.dir(key)), "1-11");
});
