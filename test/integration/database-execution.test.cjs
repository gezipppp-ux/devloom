const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { setImmediate: immediate } = require("node:timers/promises");
const { test } = require("node:test");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { AccountStore } = require("../../src/storage/account-store.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { ExecutionStore } = require("../../src/storage/execution-store.cjs");
const { MessageImageStore } = require("../../src/storage/message-image-store.cjs");
const { materializeArtifact, writeArtifact } = require("../../src/storage/artifact-store.cjs");
const { createManualChannel } = require("../../src/channels/manual/adapter.cjs");
const { runExecution } = require("../../src/execution/runner.cjs");
const { sourceFor, runKey } = require("../../src/domain/run-identity.cjs");
const { verifyPassword } = require("../../src/storage/account-passwords.cjs");
const { saveSettings } = require("../../src/config/execution-settings.cjs");
const { updateConfig, writeConfig } = require("../../src/storage/json-files.cjs");
const { main: seedFixtures } = require("../../src/cli/seed-fixtures.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png } = require("../support/helpers.cjs");

async function fixture(t) {
  let database;
  const managers = [];
  t.after(async () => { for (const manager of managers) await manager.close(); database?.close(); });
  const root = temporary(t);
  database = await initializeDatabase(root);
  const accounts = new AccountStore(database);
  const alice = accounts.create({ username: "alice", role: "member", password_hash: "unused-fixture-hash" });
  const bob = accounts.create({ username: "bob", role: "member", password_hash: "unused-fixture-hash" });
  const workspaces = new WorkspaceManager({ directory: path.join(root, "workspaces") });
  const a = workspaces.save({ name: "私有项目" }, undefined, alice);
  const b = workspaces.save({ name: "私有项目" }, undefined, bob);
  const repository = path.join(root, "repo");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "committed");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  fs.writeFileSync(path.join(repository, "tracked.txt"), "root-dirty");
  writeConfig(path.join(root, "system-settings.json"), { worktreeBasePath: path.join(root, "trees") });
  for (const workspace of [a, b]) saveSettings({ repository, worktreeDirectory: "p", baseRef: "main", initCommands: [] }, workspaces.configFile(workspace.id));
  return { root, database, managers, alice, bob, a, b, workspaces, repository, git,
    async reopen() { database.close(); database = await initializeDatabase(root); return database; } };
}

test("SQLite execution uses a temporary Git worktree and fake CLI, retains complete history offline, and honors native locks", async (t) => {
  const context = await fixture(t);
  const { root, database, managers, a, workspaces, repository, git } = context;
  const file = workspaces.configFile(a.id);
  const fake = path.join(root, "fake-cli.cjs");
  fs.writeFileSync(fake, `
    const fs = require("node:fs");
    process.stdin.resume();
    process.stdin.on("end", () => {
      const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
      emit({ type: "thread.started", thread_id: "sqlite-cli-thread" });
      emit({ type: "turn.started" });
      emit({ type: "item.completed", item: { id: "command-1", type: "command_execution", command: "fixture command", aggregated_output: "complete fixture output", exit_code: 0 } });
      emit({ type: "item.completed", item: { id: "answer-1", type: "agent_message", text: "persisted CLI answer" } });
      process.stderr.write("fixture diagnostic");
      fs.writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], "persisted final result");
      emit({ type: "turn.completed" });
    });
  `);
  updateConfig(file, (config) => ({ ...config, codex: { ...config.codex,
    command: process.execPath, command_args: [fake], init_commands: ['node -e "console.log(123)"'] } }));
  const channel = createManualChannel(file, { uploadDirectory: path.join(path.dirname(file), "uploads") });
  const image = channel.uploadImage(png);
  const resolved = await channel.resolve({ requestId: randomUUID(), title: "database task", content: "fixture requirement", images: [image.id] });
  const key = runKey(sourceFor("manual", resolved.item));
  const runsDirectory = path.join(path.dirname(file), "runs");
  const directory = path.join(runsDirectory, key);
  const input = { ...resolved, channel, configFile: file, directory };
  const execution = new ExecutionStore(directory);
  execution.lock();
  await assert.rejects(runExecution(input), /locked/);
  assert.equal(fs.existsSync(execution.lockDirectory), true);
  execution.release();
  const state = await runExecution(input);
  assert.equal(state.execution.status, "completed", state.execution.error);
  assert.equal(state.transition.status, "skipped");
  assert.equal(state.session_id, "sqlite-cli-thread");
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "root-dirty");
  assert.equal(fs.readFileSync(path.join(state.worktree.path, "tracked.txt"), "utf8"), "committed");
  assert.equal(fs.existsSync(path.join(directory, "run.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "requirement.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "final.md")), false);
  assert.equal(fs.existsSync(execution.lockDirectory), false);
  assert.equal(database.readBlob(path.join(directory, "final.md")).data.toString(), "persisted final result");
  const logs = database.handle.prepare("SELECT path,data FROM log_chunks ORDER BY id").all();
  assert.ok(logs.some((row) => row.path.endsWith("initialization.log") && row.data.toString().includes("123")));
  assert.ok(logs.some((row) => row.path.endsWith("stderr.log") && row.data.toString().includes("fixture diagnostic")));
  assert.ok(logs.some((row) => row.path.endsWith("events.jsonl") && row.data.toString().includes("complete fixture output")));
  assert.equal((await runExecution(input)).reused, true);
  const store = new RunStore(runsDirectory);
  assert.equal(store.savedHistory(key).items.find((item) => item.id === "answer-1")?.text, "persisted CLI answer");
  assert.equal(store.savedHistory(key).items.find((item) => item.id === "command-1")?.output, "complete fixture output");
  await context.reopen();
  const offline = new FakeClient();
  offline.connect = async () => { throw new Error("Codex deliberately offline"); };
  offline.request = async () => { throw new Error("Codex deliberately offline"); };
  const manager = new SessionManager({ runsDirectory, configFile: file, client: offline });
  managers.push(manager);
  const view = await manager.view(key);
  assert.equal(view.items.find((item) => item.id === "answer-1").text, "persisted CLI answer");
  assert.equal(view.requirement.markdown, "fixture requirement");
  assert.equal(view.images.length, 1);
  assert.equal(view.warning, undefined);
});

test("SQLite Web streaming and message images survive restart without connecting to Codex", async (t) => {
  const context = await fixture(t);
  const { managers, a, workspaces, database } = context;
  const file = workspaces.configFile(a.id);
  const runsDirectory = path.join(path.dirname(file), "runs");
  const client = new FakeClient();
  const request = client.request.bind(client);
  client.request = async (method, params) => method === "thread/items/list"
    ? { data: [], nextCursor: null } : request(method, params);
  const manager = new SessionManager({ runsDirectory, configFile: file, client });
  managers.push(manager);
  const started = await manager.start({ channel: "manual", requestId: randomUUID(), title: "Web database task", content: "fixture requirement" });
  const runtime = manager.sessions.get(started.key);
  const deadline = Date.now() + 10000;
  while (!runtime.turnId && Date.now() < deadline) await immediate();
  assert.ok(runtime.turnId, runtime.error);
  const turn = runtime.turnId;
  client.notify("item/agentMessage/delta", { turnId: turn, itemId: "live-answer", delta: "first " });
  client.notify("item/agentMessage/delta", { turnId: turn, itemId: "live-answer", delta: "second" });
  client.notify("item/completed", { turnId: turn, item: { id: "live-answer", type: "agentMessage", text: "first second" } });
  client.notify("item/completed", { turnId: turn, item: { id: "command", type: "commandExecution", command: "fixture", aggregatedOutput: "saved tool output", exitCode: 0 } });
  client.notify("turn/completed", { turn: { id: turn, status: "completed" } });
  await runtime.operation;
  const image = await manager.uploadMessageImage(started.key, png);
  await manager.send(started.key, "review this picture", [image.id]);
  await manager.events.completed(runtime, { id: runtime.turnId, status: "completed" });
  assert.ok(database.handle.prepare("SELECT data FROM log_chunks WHERE path LIKE '%codex-events.jsonl'").all()
    .some((row) => row.data.toString().includes("saved tool output")));
  await manager.close();
  await context.reopen();
  const offline = new FakeClient();
  offline.connect = async () => { throw new Error("offline"); };
  offline.request = async () => { throw new Error("offline"); };
  const restarted = new SessionManager({ runsDirectory, configFile: file, client: offline });
  managers.push(restarted);
  const view = await restarted.view(started.key);
  assert.equal(view.items.find((item) => item.id === "live-answer").text, "first second");
  assert.equal(view.items.find((item) => item.id === "command").output, "saved tool output");
  assert.equal(view.items.find((item) => item.id === "user-2").images[0].id, image.id);
  assert.equal(view.warning, undefined);
});

test("database image caches are reconstructible, reject symlinks, and cannot cross workspace boundaries", async (t) => {
  const { root, database, a, b, workspaces } = await fixture(t);
  const first = path.join(path.dirname(workspaces.configFile(a.id)), "runs", "1-2");
  const second = path.join(path.dirname(workspaces.configFile(b.id)), "runs", "1-2");
  const store = new MessageImageStore(first);
  const uploaded = store.save(png);
  const filename = store.filename(uploaded);
  assert.equal(fs.existsSync(filename), false);
  assert.deepEqual(fs.readFileSync(store.read(uploaded.id).path), png);
  fs.unlinkSync(filename);
  assert.deepEqual(fs.readFileSync(store.read(uploaded.id).path), png);
  fs.writeFileSync(filename, "corrupted cache");
  assert.deepEqual(fs.readFileSync(store.read(uploaded.id).path), png);
  assert.throws(() => new MessageImageStore(second).read(uploaded.id), /不存在/);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const escaped = path.join(first, "escape", "image.png");
  writeArtifact(escaped, png, { mimeType: "image/png" });
  fs.symlinkSync(outside, path.dirname(escaped), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => materializeArtifact(escaped), /符号链接/);
  assert.equal(fs.existsSync(path.join(outside, "image.png")), false);
  const runs = new RunStore(path.dirname(first));
  database.writeDocument(path.join(first, "requirement.json"), { images: [{ path: path.join(second, "images", "image.png") }] });
  assert.throws(() => runs.imagePath("1-2", "0"), /不属于/);
  const channelA = createManualChannel(workspaces.configFile(a.id), { uploadDirectory: path.join(path.dirname(workspaces.configFile(a.id)), "uploads") });
  const channelB = createManualChannel(workspaces.configFile(b.id), { uploadDirectory: path.join(path.dirname(workspaces.configFile(b.id)), "uploads") });
  const upload = channelA.uploadImage(png);
  await assert.rejects(channelB.resolve({ requestId: randomUUID(), title: "cross workspace", images: [upload.id] }), /不存在/);
});

test("development seeds require an explicit empty directory and issue unique random credentials without running tasks", async (t) => {
  let database;
  t.after(() => database?.close());
  const root = temporary(t);
  await assert.rejects(seedFixtures([], { write() {} }), /显式指定/);
  const existing = path.join(root, "existing");
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, "keep.txt"), "existing content");
  await assert.rejects(seedFixtures(["--data-dir", existing], { write() {} }), /空目录/);
  assert.equal(fs.readFileSync(path.join(existing, "keep.txt"), "utf8"), "existing content");
  const selected = path.join(root, "fixtures");
  let output = "";
  await seedFixtures(["--data-dir", selected], { write(value) { output += value; } });
  const result = JSON.parse(output);
  assert.equal(new Set(result.accounts.map(({ password }) => password)).size, 3);
  database = await initializeDatabase(selected);
  const accounts = new AccountStore(database);
  for (const account of result.accounts) {
    const saved = accounts.byUsername(account.username);
    assert.equal(await verifyPassword(account.password, saved.password_hash), true);
    assert.notEqual(saved.password_hash, account.password);
  }
  assert.equal(database.handle.prepare("SELECT COUNT(*) AS count FROM workspaces").get().count, 2);
  assert.equal(database.handle.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 0);
  await assert.rejects(seedFixtures(["--data-dir", selected], { write() {} }), /空目录/);
});
