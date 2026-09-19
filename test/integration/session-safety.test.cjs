const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { execFileSync, fork, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { worktreeReason } = require("../../src/git/worktree-access.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary } = require("../support/helpers.cjs");

function claimant(t, directory, role, mode) {
  const child = fork(
    path.join(__dirname, "../fixtures/session-owner-process.cjs"),
    [directory, role, mode],
    { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
  );
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let paused;
  let result;
  const started = new Promise((resolve, reject) => {
    paused = resolve;
    child.once("error", reject);
    child.once("exit", () =>
      reject(new Error("Claimant exited before pausing")),
    );
  });
  const finished = new Promise((resolve, reject) => {
    result = resolve;
    child.once("error", reject);
    child.once("exit", () =>
      reject(new Error("Claimant exited before reporting")),
    );
  });
  // Either event may fail before the test starts awaiting its corresponding promise.
  started.catch(() => {});
  finished.catch(() => {});
  child.on("message", (message) => {
    if (message.stage === "paused") paused();
    if (typeof message.claimed === "boolean") result(message);
  });
  return { child, started, finished, exited };
}

for (const mode of ["stale", "gap"]) {
  test(
    `owner recovery excludes a concurrent ${mode === "stale" ? "stale recovery" : "fresh claimant"}`,
    { timeout: 15000 },
    async (t) => {
      const directory = temporary(t);
      const store = new RunStore(directory);
      fs.mkdirSync(store.dir("1-2"));
      const dead = spawnSync(process.execPath, ["-e", ""], {
        windowsHide: true,
      });
      assert.equal(dead.status, 0);
      const file = path.join(store.dir("1-2"), "web-owner.json");
      fs.writeFileSync(file, JSON.stringify({ pid: dead.pid }));
      const first = claimant(t, directory, "first", mode);
      await first.started;
      const second = claimant(t, directory, "second", mode);
      const results = await Promise.all([first.finished, second.finished]);
      const winners = results.filter((result) => result.claimed);
      try {
        assert.equal(winners.length, 1, JSON.stringify(results));
        assert.equal(
          JSON.parse(fs.readFileSync(file, "utf8")).pid,
          winners[0].pid,
        );
      } finally {
        first.child.send("exit");
        second.child.send("exit");
        await Promise.all([first.exited, second.exited]);
      }
    },
  );
}

test("release only removes this store ownership and an interrupted recovery fails closed", (t) => {
  const store = new RunStore(temporary(t));
  store.claim("1-2");
  const file = path.join(store.dir("1-2"), "web-owner.json");
  const replacement = { pid: process.pid, token: "another-owner" };
  fs.writeFileSync(file, JSON.stringify(replacement));
  store.releaseAll();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), replacement);
  fs.mkdirSync(path.join(store.dir("1-2"), "web-owner-recovery"));
  assert.throws(() => store.claim("1-2"), /web-owner-recovery/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), replacement);
});

test("continuation requires the actual registered worktree Git identity", (t) => {
  const directory = temporary(t);
  const repository = path.join(directory, "repository");
  const worktree = path.join(directory, "task");
  const git = (...args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", repository);
  git(
    "-C",
    repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  git("-C", repository, "worktree", "add", "-b", "codex/test", worktree);
  const state = {
    worktree: { repository, path: worktree, branch: "codex/test" },
  };
  assert.equal(worktreeReason(state), null);
  const marker = path.join(worktree, ".git");
  const originalMarker = fs.readFileSync(marker);
  fs.unlinkSync(marker);
  git("init", worktree);
  assert.ok(worktreeReason(state));
  assert.match(
    git("-C", repository, "worktree", "list", "--porcelain"),
    /codex\/test/,
  );
  // Restore the original checkout without moving or deleting any business worktree.
  const replacement = path.resolve(marker);
  assert.equal(
    path.dirname(path.dirname(replacement)),
    path.resolve(directory),
  );
  fs.rmSync(replacement, { recursive: true, force: true });
  fs.writeFileSync(marker, originalMarker);
  assert.equal(worktreeReason(state), null);
});

test("delayed first-turn completion cannot overwrite a newer turn after reconnect", async (t) => {
  const directory = temporary(t);
  const store = new RunStore(directory);
  const key = "1-2";
  fs.mkdirSync(store.dir(key));
  fs.writeFileSync(
    path.join(store.dir(key), "run.json"),
    JSON.stringify({
      workitem: { id: "2", workspace_id: "1", title: "Fixture" },
      worktree: { path: directory },
      session_id: "original",
      execution: { status: "running" },
    }),
  );
  const client = new FakeClient();
  const manager = new SessionManager({ store, client, worktreeReason: () => null });
  t.after(() => manager.close());
  let finishTransition;
  const runtime = manager.runtime(key, "original");
  Object.assign(runtime, {
    turnId: "first",
    connected: true,
    status: "running",
    initial: {
      started: true,
      callback: new Promise((resolve) => {
        finishTransition = resolve;
      }),
      resolve() {},
      reject() {},
    },
  });
  const completed = manager.events.completed(runtime, {
    id: "first",
    status: "completed",
  });
  client.close();
  const next = await manager.send(key, "Continue after reconnect");
  client.emit("request", {
    id: 42,
    method: "item/fileChange/requestApproval",
    params: { threadId: "original", turnId: next.turnId },
  });
  finishTransition();
  await completed;
  assert.equal(runtime.turnId, next.turnId);
  assert.equal(runtime.status, "running");
  assert.equal(runtime.requests.has("42"), true);
  assert.equal(store.read(key).execution.status, "running");
  await manager.interrupt(key);
  assert.equal(store.read(key).execution.status, "interrupted");
});
