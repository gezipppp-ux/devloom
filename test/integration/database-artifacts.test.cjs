const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { initializeTestDatabase } = require("../support/database.cjs");
const { ExecutionStore } = require("../../src/storage/execution-store.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { MessageImageStore } = require("../../src/storage/message-image-store.cjs");
const { ManualUploadStore } = require("../../src/channels/manual/manual-upload-store.cjs");
const { buildManualTaskPackage } = require("../../src/channels/manual/task-package.cjs");
const { SessionViews } = require("../../src/application/session-views.cjs");
const { png } = require("../support/helpers.cjs");

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-db-artifacts-"));
  let database = await initializeTestDatabase(t, directory);
  t.after(async () => { await database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, get database() { return database; }, async reopen() {
    await database.close(); database = await initializeTestDatabase(t, directory); return database;
  } };
}

test("database run state and paginated history survive restart without JSON files or Codex", async (t) => {
  const fixture = await setup(t);
  const directory = path.join(fixture.directory, "runs", "1-2");
  const execution = new ExecutionStore(directory);
  (await execution.save({ agent: { provider: "codex" }, session_id: "stable", workitem: { title: "DB history" }, execution: { status: "completed" } }));
  (await execution.writeTask({ workitem: { title: "snapshot" }, prompt: "full prompt", images: [] }));
  (await execution.append("initialization.log", "database log\n"));
  let store = new RunStore(path.dirname(directory));
  for (let i = 0; i < 75; i++) (await execution.saveHistoryItem({ id: `item-${i}`, type: "agentMessage", text: `answer ${i}` }));
  (await store.saveHistoryItem("1-2", { id: "item-74", type: "agentMessage", text: "complete answer" }));
  assert.equal(fs.existsSync(path.join(directory, "run.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "requirement.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "initialization.log")), false);
  await fixture.reopen();
  store = new RunStore(path.dirname(directory));
  const views = new SessionViews({ store, agent: { id: "codex", label: "Codex", capabilities: { history: true }, connect() { throw new Error("Codex is offline"); } },
    sessions: new Map(), worktreeReason: () => null, assertOpen() {} });
  const first = await views.history("1-2");
  assert.equal(first.items.length, 50);
  assert.equal(first.items.at(-1).text, "complete answer");
  const second = await views.history("1-2", first.nextCursor);
  assert.equal(second.items.length, 25);
  assert.equal(second.items[0].id, "item-0");
  assert.equal(second.nextCursor, null);
  assert.equal((await store.list())[0].state.session_id, "stable");
  assert.equal((await store.readTask("1-2")).prompt, "full prompt");
  assert.equal(await fixture.database.client.logChunk.count(), 1);
});

test("archive and restore persist across database reopen while retaining history and run identity", async (t) => {
  const fixture = await setup(t);
  const directory = path.join(fixture.directory, "runs", "1-2");
  const execution = new ExecutionStore(directory);
  (await execution.save({ agent: { provider: "codex" }, session_id: "stable", workitem: { title: "Archived" }, execution: { status: "completed" } }));
  let store = new RunStore(path.dirname(directory));
  (await store.saveHistoryItem("1-2", { id: "item", type: "agentMessage", text: "retained history" }));
  (await store.archive("1-2"));
  await fixture.reopen();
  store = new RunStore(path.dirname(directory));
  assert.equal((await store.isArchived("1-2")), true);
  (await store.restore("1-2"));
  await fixture.reopen();
  store = new RunStore(path.dirname(directory));
  assert.equal((await store.isArchived("1-2")), false);
  assert.equal((await store.savedHistory("1-2")).items[0].text, "retained history");
  assert.equal((await store.read("1-2")).session_id, "stable");
  assert.equal(fs.existsSync(path.join(directory, "session-archive.json")), false);
});

test("permanently deleting a run removes its database documents, history, logs and attachments", async (t) => {
  const fixture = await setup(t);
  const user = await fixture.database.client.user.create({ data: { username: "delete-owner", displayName: "owner", passwordHash: "fixture" } });
  const workspace = await fixture.database.client.workspace.create({ data: { ownerUserId: user.id, name: "delete workspace" } });
  const directory = path.join(fixture.directory, "workspaces", workspace.id, "runs", "1-2");
  const execution = new ExecutionStore(directory);
  (await execution.save({ agent: { provider: "codex" }, session_id: "stable", workitem: { title: "Delete me" }, execution: { status: "completed" } }));
  (await execution.writeTask({ workitem: { title: "snapshot" }, prompt: "prompt", images: [] }));
  (await execution.append("initialization.log", "log\n"));
  const store = new RunStore(path.dirname(directory));
  (await store.saveHistoryItem("1-2", { id: "item", type: "agentMessage", text: "history" }));
  await (await store.messageImages("1-2")).save(png);
  await fixture.database.client.agentSupplierUse.create({ data: { workspaceId: workspace.id, runKey: "1-2", supplierId: "codex-server-config", token: "fixture-lease", status: "unknown" } });
  (await store.deleteRun("1-2"));
  assert.equal((await store.hasRun("1-2")), false);
  assert.equal(await fixture.database.client.runDocument.count(), 0);
  assert.equal(await fixture.database.client.sessionItem.count(), 0);
  assert.equal(await fixture.database.client.logChunk.count(), 0);
  assert.equal(await fixture.database.client.attachment.count(), 0);
  assert.equal(await fixture.database.client.agentSupplierUse.count(), 0, "confirmed run deletion atomically releases supplier references");
});

test("manual and conversation image blobs rebuild deleted caches and remain scoped", async (t) => {
  const fixture = await setup(t);
  const uploads = new ManualUploadStore(path.join(fixture.directory, "uploads"));
  const uploaded = (await uploads.upload(png));
  assert.equal(fs.existsSync(path.join(uploads.directory, uploaded.id)), false);
  const runDirectory = path.join(fixture.directory, "runs", "1-2");
  const { task } = (await buildManualTaskPackage({ item: { id: "2", title: "images", markdown_description: "body", image_ids: [uploaded.id] },
    directory: runDirectory, readImage: async (id) => (await uploads.read(id)) }));
  const execution = new ExecutionStore(runDirectory);
  (await execution.writeTask(task));
  (await execution.save({ agent: { provider: "codex" }, session_id: "original", workitem: {}, execution: { status: "completed" } }));
  const messages = new MessageImageStore(runDirectory);
  const message = (await messages.save(png));
  const cached = (await messages.read(message.id)).path;
  fs.unlinkSync(cached);
  fs.unlinkSync(task.images[0].path);
  await fixture.reopen();
  const store = new RunStore(path.dirname(runDirectory));
  assert.deepEqual(fs.readFileSync((await store.imagePath("1-2", "0"))), png);
  assert.deepEqual(fs.readFileSync((await (await store.messageImages("1-2")).read(message.id)).path), png);
  (await assert.rejects(async () => (await new MessageImageStore(path.join(fixture.directory, "runs", "1-3")).read(message.id)), /不存在/));
  (await assert.rejects(async () => (await store.imagePath("1-2", "../0")), /无效/));
  await fixture.database.client.attachment.update({ where: { path: `uploads/${uploaded.id}` }, data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } });
  (await assert.rejects(async () => (await uploads.read(uploaded.id)), /过期/));
  (await uploads.cleanup());
  assert.equal(await fixture.database.readBlob(path.join(uploads.directory, uploaded.id)), undefined);
});
