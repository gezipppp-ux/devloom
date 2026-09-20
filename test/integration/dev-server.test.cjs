const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { waitForClone } = require("../support/workspace-clones.cjs");
const { execFileSync, fork } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const { temporary } = require("../support/helpers.cjs");

const root = path.resolve(__dirname, "../..");
const entrypoint = path.join(root, "src", "cli", "dev.cjs");

function within(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function launch(directory, port = 0) {
  const child = fork(
    entrypoint,
    ["--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: directory,
      env: { ...process.env, RUNNER_DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ error }));
  });
  return { child, exited, output: () => output };
}

async function ready(running) {
  const message = new Promise((resolve) => {
    running.child.on("message", (value) => {
      if (value?.type === "dev:ready") resolve(value.origin);
    });
  });
  return within(
    Promise.race([
      message,
      running.exited.then((result) => {
        throw new Error(
          `Development CLI exited before startup: ${JSON.stringify(result)}\n${running.output()}`,
        );
      }),
    ]),
    30000,
    "Development CLI did not report ready",
  );
}

async function stop(running) {
  if (running.child.exitCode !== null || running.child.signalCode !== null)
    return running.exited;
  if (running.child.connected) running.child.send({ type: "dev:shutdown" });
  else running.child.kill();
  try {
    return await within(running.exited, 10000, "Development CLI did not close");
  } catch (error) {
    const connected = running.child.connected;
    running.child.kill("SIGKILL");
    await running.exited;
    throw new Error(
      `${error.message} (IPC connected: ${connected})\n${running.output()}`,
    );
  }
}

function send(url, { headers, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      response.on("error", reject);
    });
    request.setTimeout(10000, () =>
      request.destroy(new Error("Development HTTP request timed out")),
    );
    request.on("error", reject);
    request.end(body);
  });
}

function upgrade(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": Buffer.alloc(16, 1).toString("base64"),
        "sec-websocket-protocol": "vite-hmr",
        ...headers,
      },
    });
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.on("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", (error) => {
      if (error.code === "ECONNRESET") resolve(0);
      else reject(error);
    });
    request.setTimeout(5000, () =>
      request.destroy(new Error("Development WebSocket upgrade timed out")),
    );
    request.end();
  });
}

function fileUrl(file) {
  return `/@fs/${file.split(path.sep).join("/")}`;
}

test("importing the development entrypoint is inert from a separate data directory", (t) => {
  const directory = temporary(t);
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `const assert = require('node:assert/strict'); const entry = require(${JSON.stringify(entrypoint)}); assert.equal(typeof entry.main, 'function'); process.stdout.write('imported');`,
    ],
    {
      cwd: directory,
      env: { ...process.env, RUNNER_DATA_DIR: directory },
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(output, "imported");
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("development CLI serves Vite and workspace APIs on one guarded origin", async (t) => {
  const directory = temporary(t);
  const { gitRemote } = require("../support/git-remote.cjs");
  const remote = await gitRemote(path.join(directory, "git-server"));
  t.after(() => remote.close());
  const accountPassword = "development-fixture-password";
  execFileSync(
    process.execPath,
    [
      path.join(root, "src", "cli", "init-admin.cjs"),
    ],
    {
      cwd: directory,
      env: { ...process.env, RUNNER_DATA_DIR: directory },
      input: `${accountPassword}\n${accountPassword}\n`,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const privateFile = path.join(directory, "private-fixture.json");
  const secret = "development-test-private-data-must-not-be-served";
  fs.writeFileSync(privateFile, JSON.stringify({ secret }));
  const running = launch(directory);
  try {
    const origin = await ready(running);
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await send(origin);
    assert.equal(page.status, 200, page.text);
    assert.match(page.text, /\/\@vite\/client/);
    assert.match(page.text, /\/src\/main\.js/);
    const csp = page.headers["content-security-policy"];
    assert.ok(
      csp.includes(`connect-src 'self' ${origin.replace("http:", "ws:")}`),
    );
    assert.ok(csp.includes("worker-src 'self' blob:"));
    assert.equal(csp.includes("'unsafe-eval'"), false);

    const client = await send(`${origin}/@vite/client`);
    assert.equal(client.status, 200, client.text);
    assert.match(client.headers["content-type"], /javascript/);
    const socketToken = /const wsToken = "([^"]+)"/.exec(client.text)?.[1];
    assert.ok(socketToken, "Vite supplies its WebSocket token");
    const socketUrl = `${origin}/?token=${encodeURIComponent(socketToken)}`;
    assert.equal(await upgrade(socketUrl, { origin }), 101);
    for (const invalid of [
      { origin: "http://evil.example" },
      { host: `evil.example:${new URL(origin).port}`, origin },
      { "sec-fetch-site": "cross-site", origin },
    ])
      assert.notEqual(await upgrade(socketUrl, invalid), 101);

    const main = await send(`${origin}/src/main.js`);
    assert.equal(main.status, 200, main.text);
    assert.match(main.text, /createApp/);
    const component = await send(`${origin}/src/app/App.vue`);
    assert.equal(component.status, 200, component.text);
    assert.match(component.text, /__hmrId/);
    const shared = await send(
      `${origin}${fileUrl(path.join(root, "shared", "task-metadata.json"))}?import`,
    );
    assert.equal(shared.status, 200, shared.text);
    assert.match(shared.text, /in_progress/);

    assert.equal((await send(`${origin}/api/bootstrap`)).status, 401);
    const initial = await send(`${origin}/api/auth/session`);
    const initialCookie = initial.headers["set-cookie"][0].split(";", 1)[0];
    const login = await send(`${origin}/api/auth/login`, {
      method: "POST",
      headers: {
        cookie: initialCookie,
        origin,
        "content-type": "application/json",
        "x-tapd-token": JSON.parse(initial.text).token,
      },
      body: JSON.stringify({ username: "admin", password: accountPassword }),
    });
    assert.equal(login.status, 200, login.text);
    const cookie = login.headers["set-cookie"][0].split(";", 1)[0];
    const bootstrap = await send(`${origin}/api/bootstrap`, {
      headers: { cookie },
    });
    assert.equal(bootstrap.status, 200);
    const { token, workspaces } = JSON.parse(bootstrap.text);
    assert.equal(typeof token, "string");
    assert.deepEqual(workspaces, []);
    assert.equal(
      bootstrap.headers["content-security-policy"].includes("ws:"),
      false,
    );
    const headers = {
      cookie,
      origin,
      "content-type": "application/json",
      "x-tapd-token": token,
    };
    const system = await send(`${origin}/api/system/settings`, { method: "POST", headers, body: JSON.stringify({ memberStorageRoot: path.join(directory, "members") }) });
    assert.equal(system.status, 200);
    const account = await send(`${origin}/api/account/git-accounts`, { method: "POST", headers, body: JSON.stringify({ name: "fixture", authType: "http", remoteUrl: remote.remoteUrl, username: remote.username, password: remote.password }) });
    assert.equal(account.status, 201, account.text);
    const payload = JSON.stringify({ requestId: randomUUID(), name: "开发服务隔离测试", gitAccountId: JSON.parse(account.text).account.id, remoteUrl: remote.remoteUrl });
    const created = await send(`${origin}/api/workspaces`, {
      method: "POST",
      headers,
      body: payload,
    });
    assert.equal(created.status, 202, created.text);
    const clone = await waitForClone(async () => JSON.parse((await send(`${origin}/api/workspace-clones/${JSON.parse(created.text).clone.id}`, { headers: { cookie } })).text).clone);
    assert.equal(clone.status, "completed", JSON.stringify(clone));
    const workspace = clone.workspace;
    assert.equal(workspace.name, "开发服务隔离测试");
    const configFile = path.join(directory, "db", "web-coding.sqlite");
    const database = require("better-sqlite3")(configFile, { readonly: true });
    try {
      assert.equal(
        database
          .prepare("SELECT id FROM workspaces WHERE id=?")
          .get(workspace.id).id,
        workspace.id,
      );
    } finally {
      database.close();
    }

    for (const pathname of [
      "/",
      "/@vite/client",
      "/src/main.js",
      "/api/bootstrap",
    ])
      for (const invalid of [
        { host: `evil.example:${new URL(origin).port}` },
        { origin: "http://evil.example" },
        { "sec-fetch-site": "cross-site" },
      ])
        assert.equal(
          (await send(`${origin}${pathname}`, { headers: invalid })).status,
          403,
          `${pathname} ${JSON.stringify(invalid)}`,
        );
    for (const value of [undefined, "wrong-token"])
      assert.equal(
        (
          await send(`${origin}/api/workspaces`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              ...(value ? { "x-tapd-token": value } : {}),
            },
            body: payload,
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await send(`${origin}/api/workspaces`, {
          method: "POST",
          headers: { ...headers, origin: "http://evil.example" },
          body: payload,
        })
      ).status,
      403,
    );
    const catalog = JSON.parse(
      (await send(`${origin}/api/workspaces`, { headers: { cookie } })).text,
    );
    assert.deepEqual(catalog.workspaces, [workspace]);

    for (const file of [
      privateFile,
      configFile,
      path.join(root, "config", "tapd.example.json"),
      path.join(root, "src", "config", "runtime.cjs"),
    ])
      for (const query of ["", "?import", "?raw"]) {
        const response = await send(`${origin}${fileUrl(file)}${query}`);
        assert.ok(
          [403, 404].includes(response.status),
          `${file}${query}: ${response.status} ${response.text.slice(0, 120)}`,
        );
        assert.equal(response.text.includes(secret), false);
      }
  } catch (error) {
    t.diagnostic(error.stack);
    throw error;
  } finally {
    assert.deepEqual(
      await stop(running),
      { code: 0, signal: null },
      running.output(),
    );
  }
});

test("development CLI exits after a port collision instead of retaining Vite watchers", async (t) => {
  const directory = temporary(t);
  const occupied = http.createServer((_request, response) =>
    response.end("occupied"),
  );
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  const running = launch(directory, port);
  try {
    const result = await within(
      running.exited,
      15000,
      "Port collision left the development CLI running",
    );
    assert.equal(result.code, 1, running.output());
    assert.match(running.output(), /EADDRINUSE/);
    assert.equal((await send(`http://127.0.0.1:${port}`)).text, "occupied");
  } finally {
    await stop(running);
    await new Promise((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
