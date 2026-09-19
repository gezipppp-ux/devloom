const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { ExecutionStore } = require("../../src/storage/execution-store.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { MessageImageStore } = require("../../src/storage/message-image-store.cjs");
const { ManualUploadStore } = require("../../src/channels/manual/manual-upload-store.cjs");
const { buildManualTaskPackage } = require("../../src/channels/manual/task-package.cjs");
const { SessionViews } = require("../../src/application/session-views.cjs");
const { png } = require("../support/helpers.cjs");

async function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-db-artifacts-"));
  let database = await initializeDatabase(directory);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, get database() { return database; }, async reopen() {
    database.close(); database = await initializeDatabase(directory); return database;
  } };
}

test("database run state and paginated history survive restart without JSON files or Codex", async (t) => {
  const fixture = await setup(t);
  const directory = path.join(fixture.directory, "runs", "1-2");
  const execution = new ExecutionStore(directory);
  execution.save({ session_id: "stable", workitem: { title: "DB history" }, execution: { status: "completed" } });
  execution.writeTask({ workitem: { title: "snapshot" }, codex_prompt: "full prompt", images: [] });
  execution.append("initialization.log", "database log\n");
  let store = new RunStore(path.dirname(directory));
  for (let i = 0; i < 75; i++) store.saveHistoryItem("1-2", { id: `item-${i}`, type: "agentMessage", text: `answer ${i}` });
  store.saveHistoryItem("1-2", { id: "item-74", type: "agentMessage", text: "complete answer" });
  assert.equal(fs.existsSync(path.join(directory, "run.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "requirement.json")), false);
  assert.equal(fs.existsSync(path.join(directory, "initialization.log")), false);
  await fixture.reopen();
  store = new RunStore(path.dirname(directory));
  const views = new SessionViews({ store, client: { connect() { throw new Error("Codex is offline"); } },
    sessions: new Map(), worktreeReason: () => null, assertOpen() {} });
  const first = await views.history("1-2");
  assert.equal(first.items.length, 50);
  assert.equal(first.items.at(-1).text, "complete answer");
  const second = await views.history("1-2", first.nextCursor);
  assert.equal(second.items.length, 25);
  assert.equal(second.items[0].id, "item-0");
  assert.equal(second.nextCursor, null);
  assert.equal(store.list()[0].state.session_id, "stable");
  assert.equal(store.readTask("1-2").codex_prompt, "full prompt");
  assert.equal(fixture.database.handle.prepare("SELECT count(*) AS total FROM log_chunks").get().total, 1);
});

test("manual and conversation image blobs rebuild deleted caches and remain scoped", async (t) => {
  const fixture = await setup(t);
  const uploads = new ManualUploadStore(path.join(fixture.directory, "uploads"));
  const uploaded = uploads.upload(png);
  assert.equal(fs.existsSync(path.join(uploads.directory, uploaded.id)), false);
  const runDirectory = path.join(fixture.directory, "runs", "1-2");
  const { task } = buildManualTaskPackage({ item: { id: "2", title: "images", markdown_description: "body", image_ids: [uploaded.id] },
    directory: runDirectory, readImage: (id) => uploads.read(id) });
  const execution = new ExecutionStore(runDirectory);
  execution.writeTask(task);
  execution.save({ session_id: "original", workitem: {}, execution: { status: "completed" } });
  const messages = new MessageImageStore(runDirectory);
  const message = messages.save(png);
  const cached = messages.read(message.id).path;
  fs.unlinkSync(cached);
  fs.unlinkSync(task.images[0].path);
  await fixture.reopen();
  const store = new RunStore(path.dirname(runDirectory));
  assert.deepEqual(fs.readFileSync(store.imagePath("1-2", "0")), png);
  assert.deepEqual(fs.readFileSync(store.messageImages("1-2").read(message.id).path), png);
  assert.throws(() => new MessageImageStore(path.join(fixture.directory, "runs", "1-3")).read(message.id), /不存在/);
  assert.throws(() => store.imagePath("1-2", "../0"), /无效/);
  fixture.database.handle.prepare("UPDATE attachments SET expires_at=? WHERE path=?")
    .run("2000-01-01T00:00:00.000Z", `uploads/${uploaded.id}`);
  assert.throws(() => uploads.read(uploaded.id), /过期/);
  uploads.cleanup();
  assert.equal(fixture.database.readBlob(path.join(uploads.directory, uploaded.id)), undefined);
});
