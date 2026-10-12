const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { SessionManager } = require("../support/session-manager.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { RunStore } = require("../../src/storage/run-store.cjs");
const { createWebServer } = require("../../src/http/server.cjs");
const { MAX_IMAGE_BYTES } = require("../../src/domain/image-format.cjs");
const {
  validateSessionMessage,
} = require("../../src/domain/session-message.cjs");
const { FakeClient } = require("../fixtures/web-client.cjs");
const { temporary, png } = require("../support/helpers.cjs");

function saveRun(store, key = "1-2") {
  const state = {
    agent: { provider: "codex" },
    workitem: { id: "2", workspace_id: "1", title: "图片会话" },
    source: { channel: "tapd", scope: "1", id: "2" },
    session_id: "original",
    worktree: {
      path: store.directory,
      repository: store.directory,
      branch: "codex/fixture",
    },
    execution: { status: "completed" },
    transition: { status: "succeeded" },
  };
  fs.mkdirSync(store.dir(key), { recursive: true });
  fs.writeFileSync(
    path.join(store.dir(key), "run.json"),
    JSON.stringify(state),
  );
  return state;
}

function setup(t) {
  const directory = temporary(t);
  const store = new RunStore(path.join(directory, "runs"));
  const state = saveRun(store);
  const client = new FakeClient();
  const options = {
    store,
    client,
    configFile: path.join(directory, "config.json"),
    worktreeReason: () => null,
  };
  const manager = new SessionManager(options);
  t.after(() => manager.close());
  return { directory, store, state, client, manager, key: "1-2", options };
}

test("session pictures persist, start and steer the original thread, and remain visible in SSE and restarted history", async (t) => {
  const { manager, key, store, state, client, options } = setup(t);
  const events = [];
  manager.on("event", (event) => events.push(event));
  const uploaded = await manager.uploadMessageImage(key, png);
  assert.equal(client.calls.length, 0, "upload cannot resume or start Codex");
  assert.equal(uploaded.contentType, "image/png");
  assert.equal(uploaded.path, undefined);
  assert.equal(uploaded.size, png.length);
  const file = (await manager.messageImagePath(key, uploaded.id));
  assert.deepEqual(fs.readFileSync(file), png);

  const started = await manager.send(key, "", [uploaded.id]);
  await manager.events.drain();
  const firstInput = client.calls.find((call) => call.method === "turn/start")
    .params.input;
  assert.deepEqual(firstInput, [{ type: "localImage", path: file }]);
  const userEvent = events.find((event) => event.item?.id === "user-1");
  assert.deepEqual(userEvent.item.images, [uploaded]);
  assert.equal(JSON.stringify(userEvent).includes(file), false);
  assert.equal(
    (await manager.view(key)).items.find((item) => item.id === "user-1")
      .images[0].id,
    uploaded.id,
  );

  await manager.send(key, "请对照截图", [uploaded.id]);
  await manager.events.drain();
  const steer = client.calls.at(-1);
  assert.equal(steer.method, "turn/steer");
  assert.equal(steer.params.expectedTurnId, started.turnId);
  assert.deepEqual(steer.params.input, [
    { type: "text", text: "请对照截图", text_elements: [] },
    { type: "localImage", path: file },
  ]);
  await manager.send(key, undefined, [uploaded.id]);
  assert.deepEqual(client.calls.at(-1).params.input, firstInput);
  const saved = (await store.read(key));
  for (const property of ["session_id", "source", "worktree", "transition"])
    assert.deepEqual(saved[property], state[property]);
  await manager.close();

  const restoredClient = new FakeClient();
  const original = restoredClient.request.bind(restoredClient);
  restoredClient.request = async (method, params) =>
    method === "thread/items/list"
      ? {
          data: [
            {
              turnId: "turn-2",
              item: {
                id: "encoded",
                type: "userMessage",
                content: [
                  {
                    type: "image",
                    url: `data:image/png;base64,${png.toString("base64")}`,
                  },
                ],
              },
            },
            {
              turnId: "turn-1",
              item: { id: "local", type: "userMessage", content: firstInput },
            },
            {
              turnId: "turn-0",
              item: {
                id: "foreign",
                type: "userMessage",
                content: [
                  {
                    type: "localImage",
                    path: path.join(options.store.directory, "secret.png"),
                  },
                  { type: "image", url: "https://private.invalid/file.png" },
                ],
              },
            },
          ],
          nextCursor: null,
        }
      : original(method, params);
  const restored = new SessionManager({
    ...options,
    store: new RunStore(store.directory),
    client: restoredClient,
  });
  t.after(() => restored.close());
  const history = await restored.history(key);
  assert.deepEqual(
    history.items.slice(1).map((item) => item.images),
    [[uploaded], [uploaded]],
  );
  assert.equal(history.items[0].images, undefined);
  assert.equal(JSON.stringify(history).includes(file), false);
  assert.deepEqual(
    fs.readFileSync((await restored.messageImagePath(key, uploaded.id))),
    png,
  );
});

test("session image validation rejects empty messages, invalid references, unsupported bytes, oversize and changed files before Codex starts", async (t) => {
  const { manager, client, key, store } = setup(t);
  for (const [text, images] of [
    ["", []],
    [null, []],
    ["x".repeat(60001), []],
    ["hello", null],
    ["hello", "picture"],
    ["hello", ["../picture"]],
    ["hello", Array.from({ length: 21 }, () => randomUUID())],
  ])
    await assert.rejects(manager.send(key, text, images));
  const duplicate = randomUUID();
  assert.throws(
    () => validateSessionMessage("", [duplicate, duplicate]),
    /不重复/,
  );
  assert.equal(
    validateSessionMessage(
      "",
      Array.from({ length: 20 }, () => randomUUID()),
    ).images.length,
    20,
  );
  await assert.rejects(
    manager.uploadMessageImage(key, Buffer.from("<svg></svg>")),
    /PNG/,
  );
  await assert.rejects(
    manager.uploadMessageImage(key, Buffer.alloc(MAX_IMAGE_BYTES + 1)),
    /10 MiB/,
  );
  await assert.rejects(
    manager.uploadMessageImage(key, Buffer.alloc(0)),
    /1 字节/,
  );
  await assert.rejects(manager.send(key, "", [randomUUID()]), {
    code: "ENOENT",
  });
  const picture = await manager.uploadMessageImage(key, png);
  saveRun(store, "1-3");
  await assert.rejects(manager.send("1-3", "", [picture.id]), {
    code: "ENOENT",
  });
  const file = (await manager.messageImagePath(key, picture.id));
  const modified = Buffer.from(png);
  modified[modified.length - 1] ^= 1;
  fs.writeFileSync(file, modified);
  await assert.rejects(manager.send(key, "", [picture.id]), /发生变化/);
  (await assert.rejects(async () => (await manager.messageImagePath(key, "..")), /无效/));
  assert.equal(client.calls.length, 0);
});

test("session image uploads honor worktree, preparation, approvals and ownership fences", async (t) => {
  const { manager, key, store, client } = setup(t);
  manager.worktreeReason = () => "工作区已移除";
  await assert.rejects(manager.uploadMessageImage(key, png), /已移除/);
  manager.worktreeReason = () => null;
  const runtime = manager.runtime(key, "original");
  runtime.status = "initializing";
  await assert.rejects(manager.uploadMessageImage(key, png), /准备/);
  runtime.status = "idle";
  runtime.requests.set("question", {});
  await assert.rejects(manager.uploadMessageImage(key, png), /审批/);
  runtime.requests.clear();
  fs.mkdirSync(path.join(store.dir(key), ".lock"));
  await assert.rejects(manager.uploadMessageImage(key, png), /CLI/);
  fs.rmdirSync(path.join(store.dir(key), ".lock"));
  const other = new RunStore(store.directory);
  other.claim(key);
  await assert.rejects(manager.uploadMessageImage(key, png), /另一个 Web CLI/);
  other.releaseAll();
  assert.equal(client.calls.length, 0);
  assert.equal(
    fs.existsSync(path.join(store.dir(key), "message-images")),
    false,
  );
});

test("message image storage refuses a directory redirected outside its run", async (t) => {
  const { manager, key, store, directory } = setup(t);
  const outside = path.join(directory, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(
    outside,
    path.join(store.dir(key), "message-images"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(manager.uploadMessageImage(key, png), /不属于/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("HTTP message images require origin/token and isolate workspace and run IDs while serving persistent safe URLs", async (t) => {
  const directory = temporary(t);
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
    createManager: (options) =>
      new SessionManager({
        ...options,
        client: new FakeClient(),
        worktreeReason: () => null,
      }),
  });
  const a = (await workspaces.save({ name: "A" }));
  const b = (await workspaces.save({ name: "B" }));
  for (const id of [a.id, b.id]) {
    const store = (await workspaces.get(id)).sessions.store;
    saveRun(store);
    saveRun(store, "1-3");
  }
  const application = createWebServer({ testIdentity: true, workspaces });
  const origin = await application.listen(0);
  t.after(() => application.close());
  const { token } = await (await fetch(`${origin}/api/bootstrap`)).json();
  const endpoint = `${origin}/api/workspaces/${a.id}/runs/1-2`;
  const upload = (
    url = `${endpoint}/message-images`,
    headers = { "x-tapd-token": token },
    bytes = png,
  ) => fetch(url, { method: "POST", headers, body: bytes });
  assert.equal((await upload(undefined, {})).status, 403);
  assert.equal(
    (
      await upload(undefined, {
        "x-tapd-token": token,
        origin: "http://evil.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await upload(`${endpoint.replace("1-2", "1-9")}/message-images`)).status,
    404,
  );
  assert.equal(
    (await upload(undefined, undefined, Buffer.from("not an image"))).status,
    400,
  );
  const response = await upload();
  assert.equal(response.status, 201);
  const image = await response.json();
  assert.equal(
    image.url,
    `/api/workspaces/${a.id}/runs/1-2/message-images/${image.id}`,
  );
  assert.equal(image.path, undefined);
  const stored = await fetch(`${origin}${image.url}`);
  assert.equal(stored.status, 200);
  assert.equal(stored.headers.get("content-type"), "image/png");
  assert.equal(stored.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await stored.arrayBuffer()), png);
  assert.equal(
    (await fetch(`${origin}${image.url.replace(a.id, b.id)}`)).status,
    404,
  );
  assert.equal(
    (await fetch(`${origin}${image.url.replace("1-2", "1-3")}`)).status,
    404,
  );
  const send = (url) =>
    fetch(url, {
      method: "POST",
      headers: { "x-tapd-token": token, "content-type": "application/json" },
      body: JSON.stringify({ images: [image.id] }),
    });
  assert.equal(
    (await send(`${endpoint.replace(a.id, b.id)}/messages`)).status,
    404,
  );
  assert.equal((await send(`${endpoint}/messages`)).status, 202);
  assert.equal((await workspaces.get(b.id)).sessions.client.calls.length, 0);
});
