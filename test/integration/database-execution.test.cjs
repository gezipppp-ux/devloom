const { startFixtureSession } = require("../support/cli-execution.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { setImmediate: immediate } = require("node:timers/promises");
const { test } = require("node:test");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountStore } = require("../../src/storage/account-store.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { SessionManager } = require("../support/session-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { ExecutionStore } = require("../../src/storage/execution-store.cjs");
const { MessageImageStore } = require("../../src/storage/message-image-store.cjs");
const { materializeArtifact, writeArtifact } = require("../../src/storage/artifact-store.cjs");
const { createManualChannel } = require("../../src/channels/manual/adapter.cjs");
const { runExecution } = require("../../src/execution/runner.cjs");
const { sourceFor, runKey } = require("../../src/domain/run-identity.cjs");
const { readSettings, saveSettings } = require("../../src/config/execution-settings.cjs");
const { readOptional, updateConfig, writeConfig } = require("../../src/storage/json-files.cjs");
const { worktreePlan, createWorktree } = require("../../src/git/worktrees.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png } = require("../support/helpers.cjs");
const { seedWorkspaceProject } = require("../support/workspace-project.cjs");

async function fixture(t) {
  let database;
  const managers = [];
  t.after(async () => { for (const manager of managers) await manager.close(); await database?.close(); });
  const root = temporary(t);
  database = await initializeTestDatabase(t, root);
  const accounts = new AccountStore(database);
  const alice = (await accounts.create({ username: "alice", role: "member", password_hash: "unused-fixture-hash" }));
  const bob = (await accounts.create({ username: "bob", role: "member", password_hash: "unused-fixture-hash" }));
  const workspaces = new WorkspaceManager({ directory: path.join(root, "workspaces") });
  const a = (await workspaces.save({ name: "私有项目" }, undefined, alice));
  const b = (await workspaces.save({ name: "私有项目" }, undefined, bob));
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
  (await writeConfig(path.join(root, "system-settings.json"), { memberStorageRoot: path.join(root, "trees") }));
  for (const workspace of [a, b]) {
    (await seedWorkspaceProject(workspaces.configFile(workspace.id), repository, "p"));
    (await saveSettings({ baseRef: "main", initCommands: [] }, workspaces.configFile(workspace.id)));
  }
  return { root, database, managers, alice, bob, a, b, workspaces, repository, git,
    async reopen() { await database.close(); database = await initializeTestDatabase(t, root); return database; } };
}

test("PostgreSQL execution uses a temporary Git worktree and fake CLI, retains complete history offline, and honors native locks", async (t) => {
  const context = await fixture(t);
  const { root, database, managers, a, workspaces, repository, git } = context;
  const file = workspaces.configFile(a.id);
  const fake = path.join(root, "fake-cli.cjs");
  fs.writeFileSync(fake, `
    const fs = require("node:fs");
    process.stdin.resume();
    process.stdin.on("end", () => {
      const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
      emit({ type: "thread.started", thread_id: "postgres-cli-thread" });
      emit({ type: "turn.started" });
      emit({ type: "item.completed", item: { id: "command-1", type: "command_execution", command: "fixture command", aggregated_output: "complete fixture output", exit_code: 0 } });
      emit({ type: "item.completed", item: { id: "answer-1", type: "agent_message", text: "persisted CLI answer" } });
      process.stderr.write("fixture diagnostic");
      fs.writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], "persisted final result");
      emit({ type: "turn.completed" });
    });
  `);
  (await updateConfig(file, (config) => ({ ...config,
    agent: { provider: "codex", options: { command: process.execPath, command_args: [fake] } },
    execution: { ...config.execution, initCommands: ['node -e "console.log(123)"'] } })));
  const channel = createManualChannel(file, { uploadDirectory: path.join(path.dirname(file), "uploads") });
  const image = (await channel.uploadImage(png));
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
  const state = await runExecution(input, { startSession: startFixtureSession });
  assert.equal(state.execution.status, "completed", state.execution.error);
  assert.equal(state.transition.status, "skipped");
  assert.equal(state.session_id, "postgres-cli-thread");
  assert.equal(path.dirname(state.worktree.path), path.join(root, "trees", "alice", "worktree", "p"));
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "root-dirty");
  assert.equal(fs.readFileSync(path.join(state.worktree.path, "tracked.txt"), "utf8"), "committed");
  assert.equal(fs.existsSync(path.join(directory, "run.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "requirement.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "final.md")), false);
  assert.equal(fs.existsSync(execution.lockDirectory), false);
  assert.equal((await database.readBlob(path.join(directory, "final.md"))).data.toString(), "persisted final result");
  const logs = await database.client.logChunk.findMany({ orderBy: { id: "asc" } });
  assert.ok(logs.some((row) => row.path.endsWith("initialization.log") && Buffer.from(row.data).toString().includes("123")));
  assert.ok(logs.some((row) => row.path.endsWith("stderr.log") && Buffer.from(row.data).toString().includes("fixture diagnostic")));
  assert.ok(logs.some((row) => row.path.endsWith("events.jsonl") && Buffer.from(row.data).toString().includes("complete fixture output")));
  assert.equal((await runExecution(input)).reused, true);
  const store = new RunStore(runsDirectory);
  assert.equal((await store.savedHistory(key)).items.find((item) => item.id === "answer-1")?.text, "persisted CLI answer");
  assert.equal((await store.savedHistory(key)).items.find((item) => item.id === "command-1")?.output, "complete fixture output");
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

test("PostgreSQL Web streaming and message images survive restart without connecting to Codex", async (t) => {
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
  await manager.events.drain();
  await runtime.operation;
  const image = await manager.uploadMessageImage(started.key, png);
  await manager.send(started.key, "review this picture", [image.id]);
  await manager.events.drain();
  await manager.events.completed(runtime, { id: runtime.turnId, status: "completed" });
  assert.ok((await database.client.logChunk.findMany({ where: { path: { endsWith: "agent-events.jsonl" } } }))
    .some((row) => Buffer.from(row.data).toString().includes("saved tool output")));
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

test("username worktree roots apply to new tasks while legacy UUID paths retain their sessions and Git identities", async (t) => {
  const { root, managers, alice, a, b, workspaces, repository, git } = await fixture(t);
  const file = workspaces.configFile(a.id);
  const runsDirectory = path.join(path.dirname(file), "runs");
  const item = { id: randomUUID(), workspace_id: "local", title: "旧成员目录任务", type: "requirement" };
  const source = sourceFor("manual", item);
  const key = runKey(source);
  const legacy = worktreePlan(repository, item, "main", {
    root: path.join(root, "trees", "u-" + alice.id, "p"),
    workspaceId: a.id,
    source,
    name: "legacy",
  });
  createWorktree(legacy);
  fs.writeFileSync(path.join(legacy.path, "keep.txt"), "original task content");
  const legacyState = {
    version: 3,
    workspace_id: a.id,
    source,
    workitem: item,
    worktree: legacy,
    session_id: "legacy-member-thread",
    agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask" },
    execution: { status: "completed" },
    transition: { status: "skipped" },
  };
  (await new ExecutionStore(path.join(runsDirectory, key)).save(legacyState));
  const client = new FakeClient();
  const manager = new SessionManager({ runsDirectory, configFile: file, client });
  managers.push(manager);
  await manager.send(key, "继续原来的任务");
  const resumed = client.calls.find((call) => call.method === "thread/resume").params;
  assert.equal(resumed.threadId, legacyState.session_id);
  assert.equal(resumed.cwd, legacy.path);
  assert.deepEqual(client.calls.filter((call) => call.method === "turn/start").at(-1).params.sandboxPolicy.writableRoots, [legacy.path]);
  assert.equal(client.calls.some((call) => call.method === "thread/start"), false);
  await manager.interrupt(key);

  for (const [workspace, username] of [[a, "alice"], [b, "bob"]]) {
    const selectedFile = workspaces.configFile(workspace.id);
    const selected = workspace.id === a.id ? manager : new SessionManager({
      runsDirectory: path.join(path.dirname(selectedFile), "runs"),
      configFile: selectedFile,
      client: new FakeClient(),
    });
    if (selected !== manager) managers.push(selected);
    const started = await selected.start({ channel: "manual", requestId: randomUUID(), title: "新成员目录任务", content: "模拟需求" });
    const runtime = selected.sessions.get(started.key);
    const deadline = Date.now() + 10000;
    while (!runtime.turnId && runtime.pipelineActive && Date.now() < deadline) await immediate();
    assert.ok(runtime.turnId, runtime.error);
    const state = (await selected.store.read(started.key));
    assert.equal(path.dirname(state.worktree.path), path.join(root, "trees", username, "worktree", "p"));
    assert.equal(selected.client.calls.filter((call) => call.method === "thread/start").at(-1).params.cwd, state.worktree.path);
    assert.notEqual(state.worktree.branch, legacy.branch);
    await selected.interrupt(started.key);
    await runtime.operation;
  }
  const retained = (await manager.store.read(key));
  assert.equal(retained.session_id, legacyState.session_id);
  assert.deepEqual(retained.worktree, legacyState.worktree);
  assert.deepEqual(retained.source, source);
  assert.equal(retained.workspace_id, a.id);
  assert.equal(fs.readFileSync(path.join(legacy.path, "keep.txt"), "utf8"), "original task content");
  assert.equal(git("show-ref", "--hash", `refs/heads/${legacy.branch}`), legacy.base_commit);
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(fs.readFileSync(path.join(repository, "tracked.txt"), "utf8"), "root-dirty");
});

test("member roots and workspace subdirectories cannot redirect settings into another member", async (t) => {
  const { root, a, workspaces } = await fixture(t);
  const file = workspaces.configFile(a.id);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  for (const scenario of ["member-root", "workspace-child"]) {
    const base = path.join(root, scenario);
    const member = path.join(base, "alice");
    const peer = path.join(base, "bob");
    fs.mkdirSync(peer, { recursive: true });
    if (scenario === "workspace-child") fs.mkdirSync(path.join(member, "worktree"), { recursive: true });
    const link = scenario === "member-root" ? member : path.join(member, "worktree", "p");
    fs.symlinkSync(peer, link, linkType);
    (await writeConfig(path.join(root, "system-settings.json"), { memberStorageRoot: base }));
    const projectName = "p";
    (await updateConfig(file, (config) => ({ ...config, execution: { ...config.execution, projectName } })));
    const before = (await readOptional(file));
    (await assert.rejects(async () => (await readSettings(file)), /符号链接/, scenario));
    (await assert.rejects(async () => (await saveSettings({ baseRef: "main", initCommands: [] }, file)), /符号链接/, scenario));
    assert.deepEqual((await readOptional(file)), before);
    assert.deepEqual(fs.readdirSync(peer), []);
  }
});

test("execution rechecks member isolation when preparation replaces a root or child with a junction", async (t) => {
  const { root, a, workspaces, git } = await fixture(t);
  const file = workspaces.configFile(a.id);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  for (const scenario of ["member-root", "workspace-child"]) {
    const base = path.join(root, "during-prepare-" + scenario);
    const member = path.join(base, "alice");
    const peer = path.join(base, "bob");
    const link = scenario === "member-root" ? member : path.join(member, "worktree", "p");
    fs.mkdirSync(link, { recursive: true });
    fs.mkdirSync(peer);
    fs.writeFileSync(path.join(peer, "keep.txt"), "other member content");
    (await writeConfig(path.join(root, "system-settings.json"), { memberStorageRoot: base }));
    const channel = createManualChannel(file, { uploadDirectory: path.join(path.dirname(file), "uploads") });
    const resolved = await channel.resolve({ requestId: randomUUID(), title: "拒绝准备期间越界", content: "模拟需求" });
    const prepare = channel.prepare.bind(channel);
    channel.prepare = async (input) => {
      const prepared = await prepare(input);
      assert.ok(path.resolve(link).startsWith(path.resolve(root) + path.sep));
      fs.rmdirSync(link);
      fs.symlinkSync(peer, link, linkType);
      return prepared;
    };
    let created = false, started = false;
    const branches = git("for-each-ref", "--format=%(refname)", "refs/heads");
    const key = runKey(sourceFor("manual", resolved.item));
    const directory = path.join(path.dirname(file), "runs", key);
    await assert.rejects(runExecution({ ...resolved, configFile: file, directory, channel }, {
      createWorktree() { created = true; throw new Error("Unexpected worktree creation"); },
      startSession() { started = true; throw new Error("Unexpected Codex execution"); },
    }), /符号链接/, scenario);
    assert.equal(created, false);
    assert.equal(started, false);
    assert.equal((await new ExecutionStore(directory).read()).execution.status, "failed");
    assert.equal(git("for-each-ref", "--format=%(refname)", "refs/heads"), branches);
    assert.deepEqual(fs.readdirSync(peer), ["keep.txt"]);
    assert.equal(fs.readFileSync(path.join(peer, "keep.txt"), "utf8"), "other member content");
  }
});

test("database image caches are reconstructible, reject symlinks, and cannot cross workspace boundaries", async (t) => {
  const { root, database, a, b, workspaces } = await fixture(t);
  const first = path.join(path.dirname(workspaces.configFile(a.id)), "runs", "1-2");
  const second = path.join(path.dirname(workspaces.configFile(b.id)), "runs", "1-2");
  const store = new MessageImageStore(first);
  const uploaded = (await store.save(png));
  const filename = store.filename(uploaded);
  assert.equal(fs.existsSync(filename), false);
  assert.deepEqual(fs.readFileSync((await store.read(uploaded.id)).path), png);
  fs.unlinkSync(filename);
  assert.deepEqual(fs.readFileSync((await store.read(uploaded.id)).path), png);
  fs.writeFileSync(filename, "corrupted cache");
  assert.deepEqual(fs.readFileSync((await store.read(uploaded.id)).path), png);
  (await assert.rejects(async () => (await new MessageImageStore(second).read(uploaded.id)), /不存在/));
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const escaped = path.join(first, "escape", "image.png");
  (await writeArtifact(escaped, png, { mimeType: "image/png" }));
  fs.symlinkSync(outside, path.dirname(escaped), process.platform === "win32" ? "junction" : "dir");
  (await assert.rejects(async () => (await materializeArtifact(escaped)), /符号链接/));
  assert.equal(fs.existsSync(path.join(outside, "image.png")), false);
  const runs = new RunStore(path.dirname(first));
  await database.writeDocument(path.join(first, "requirement.json"), { images: [{ path: path.join(second, "images", "image.png") }] });
  (await assert.rejects(async () => (await runs.imagePath("1-2", "0")), /不属于/));
  const channelA = createManualChannel(workspaces.configFile(a.id), { uploadDirectory: path.join(path.dirname(workspaces.configFile(a.id)), "uploads") });
  const channelB = createManualChannel(workspaces.configFile(b.id), { uploadDirectory: path.join(path.dirname(workspaces.configFile(b.id)), "uploads") });
  const upload = (await channelA.uploadImage(png));
  await assert.rejects(channelB.resolve({ requestId: randomUUID(), title: "cross workspace", images: [upload.id] }), /不存在/);
});
