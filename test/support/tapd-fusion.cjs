const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { createTapdChannel } = require("../../src/channels/tapd/adapter.cjs");
const { ChannelRegistry } = require("../../src/channels/channel-registry.cjs");
const { SessionManager } = require("../../src/application/session-manager.cjs");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { writeConfig } = require("../../src/storage/json-files.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, session, png } = require("./helpers.cjs");

async function fusionFixture(t, { database = true } = {}) {
  const cleanup = [];
  const root = temporary({ after: fn => cleanup.push(fn) });
  const db = database ? await initializeDatabase(root) : null;
  const repository = path.join(root, "repo");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  const configFile = path.join(root, "config.json");
  writeConfig(configFile, { tapd: { session }, codex: { repository, worktree_root: path.join(root, "trees"), base_ref: "main" } });
  const context = { root, database: db, configFile, repository, git, detailCalls: [], failId: null, detailGate: null };
  const channel = createTapdChannel(configFile, {
    detail: async (_session, selected) => {
      context.detailCalls.push(selected.id);
      await context.detailGate;
      if (selected.id === context.failId) throw new Error("模拟资料读取失败");
      const type = selected.type || (selected.id === "13" ? "board_card" : "story");
      return { ...selected, type, title: `测试需求 ${selected.id}`, detail_url: `https://www.tapd.cn/1/${type}/${selected.id}`,
        markdown_description: `验收 ${selected.id}\n![截图](data:image/png;base64,${png.toString("base64")})` };
    },
  });
  channel.search = async ({ query }) => ["11", "12", "13", "14", "15"].map(id => ({
    id, workspace: "1", type: id === "12" ? "bug" : "story", title: `测试需求 ${id}`,
  })).filter(item => !query || item.title.includes(query));
  const client = new FakeClient();
  const manager = new SessionManager({ runsDirectory: path.join(root, "runs"), configFile, client,
    channels: new ChannelRegistry([channel]) });
  Object.assign(context, { client, manager, channel, store: manager.store });
  t.after(async () => { await manager.close(); db?.close(); for (const fn of cleanup.reverse()) fn(); });
  return context;
}

function fusionInput(ids = ["11", "12"]) {
  return { channel: "tapd", workspace: "1", requestId: randomUUID(), title: "登录问题融合修复",
    supplementaryInstructions: "逐条验证验收场景。",
    items: ids.map(id => ({ id, type: id === "12" ? "bug" : "story" })) };
}

async function waitForTurn(manager, key) {
  const deadline = Date.now() + 5000;
  while (!manager.sessions.get(key)?.turnId) {
    if (manager.sessions.get(key)?.error) throw new Error(manager.sessions.get(key).error);
    if (Date.now() > deadline) throw new Error("模拟轮次未启动");
    await delay(10);
  }
}

async function finishTurn(manager, client, key) {
  const runtime = manager.sessions.get(key);
  client.notify("turn/completed", { threadId: runtime.sessionId, turn: { id: runtime.turnId, status: "completed" } });
  await runtime.operation;
  await manager.events.settle(key);
}

module.exports = { fusionFixture, fusionInput, waitForTurn, finishTurn };
