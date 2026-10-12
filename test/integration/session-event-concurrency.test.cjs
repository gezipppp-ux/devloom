const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { CodexAgent } = require("../../src/agents/codex-agent.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { temporary } = require("../support/helpers.cjs");

// No process or network transport: the real adapter receives only this native
// protocol double, so the test exercises connection invalidation end to end.
class RotatingClient extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.calls = [];
    this.rotated = false;
  }

  async connect() {
    this.calls.push({ method: "connect" });
    this.connected = true;
  }

  async refreshGitCredentials() {
    if (this.rotated) return false;
    this.rotated = true;
    this.connected = false;
    this.emit("disconnected", new Error("fixture Git credentials changed"));
    return true;
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (!this.connected) throw new Error("fixture transport disconnected");
    if (method === "thread/read") return { thread: { status: { type: "idle" } } };
    if (method === "thread/resume") return {};
    if (method === "turn/start") return { turn: { id: "continued-turn", status: "inProgress" } };
    if (method === "turn/interrupt") return {};
    throw new Error(`Unexpected fixture operation: ${method}`);
  }

  async close() { this.connected = false; }
}

test("credential rotation reconnects another idle session while the first disconnect state is still persisting", { timeout: 10000 }, async (t) => {
  const directory = temporary(t);
  const store = new RunStore(path.join(directory, "runs"));
  const client = new RotatingClient();
  const agent = new CodexAgent({ client });
  const manager = new SessionManager({
    store, agent, configFile: path.join(directory, "config.json"), worktreeReason: () => null,
  });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let timer;
  let sending;
  try {
    for (const key of ["1-1", "1-2"]) {
      await writeConfig(path.join(store.dir(key), "run.json"), {
        agent: { provider: "codex", model: "fixture-model", reasoningEffort: "high", permissionMode: "ask" },
        source: { channel: "tapd", scope: "1", id: key.slice(2) },
        workitem: { id: key.slice(2), workspace_id: "1", title: `Fixture ${key}` },
        worktree: { path: directory }, session_id: key, execution: { status: "completed" },
      });
      manager.runtime(key, key).connected = true;
    }
    const originalLog = store.log.bind(store);
    store.log = async (key, event) => {
      if (key === "1-1" && event.type === "state") {
        entered.resolve();
        await release.promise;
      }
      return originalLog(key, event);
    };
    // Observe failures immediately while waiting for the first session's
    // persistence hook, so a regression cannot cause an unhandled rejection.
    sending = manager.send("1-2", "continue with the rotated credentials")
      .then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const outcome = await Promise.race([
      sending,
      new Promise(resolve => { timer = setTimeout(() => resolve({ blocked: true }), 2000); }),
    ]);
    assert.equal(outcome.blocked, undefined, "unrelated persistence must not block reconnection");
    assert.equal(outcome.error, undefined, outcome.error?.message);
    assert.equal(outcome.value.sessionId, "1-2");
    assert.equal(outcome.value.turnId, "continued-turn");
    assert.deepEqual(client.calls.map(call => call.method), ["connect", "thread/read", "thread/resume", "turn/start"]);
    assert.equal(client.calls.find(call => call.method === "thread/resume").params.threadId, "1-2");
    assert.equal(client.calls.find(call => call.method === "turn/start").params.threadId, "1-2");
    assert.equal(manager.sessions.get("1-2").connected, true);
    release.resolve();
    await manager.events.drain();
    assert.equal(manager.sessions.get("1-2").connected, true,
      "a delayed disconnect from the old connection must not invalidate the resumed session");
    assert.equal(fs.existsSync(path.join(store.dir("1-2"), "run.json")), true);
  } finally {
    clearTimeout(timer);
    release.resolve();
    await sending;
    await manager.close();
  }
});
