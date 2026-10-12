const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { temporary } = require("../support/helpers.cjs");
const {
  readOptional,
  writeConfig,
} = require("../../src/storage/json-files.cjs");
const {
  readSystemSettings,
  saveSystemSettings,
} = require("../../src/config/system-settings.cjs");
const { listDirectories } = require("../../src/storage/directories.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { createWebServer } = require("../../src/http/server.cjs");

test("system base directory is canonical, persisted separately and validated before saving", async (t) => {
  const directory = temporary(t);
  const file = path.join(directory, "system-settings.json");
  assert.equal(
    (await readSystemSettings(directory)).memberStorageRoot,
    path.join(os.homedir(), ".web-coding-workspaces"),
  );
  assert.equal(fs.existsSync(file), false);
  (await writeConfig(file, { unrelated: { keep: true } }));
  const base = path.join(directory, "测试目录 with spaces", "trees");
  const result = (await saveSystemSettings(
    { memberStorageRoot: `${base}${path.sep}` },
    directory,
  ));
  assert.equal(result.memberStorageRoot, fs.realpathSync.native(base));
  assert.equal(result.platform, process.platform);
  assert.deepEqual((await readSystemSettings(directory)), result);
  assert.deepEqual((await readOptional(file)).unrelated, { keep: true });
  assert.deepEqual(fs.readdirSync(base), []);
  const saved = fs.readFileSync(file, "utf8");
  for (const memberStorageRoot of [
    "",
    "relative/path",
    "../outside",
    null,
    12,
    `${base}\ninvalid`,
  ])
    (await assert.rejects(
      async () => (await saveSystemSettings({ memberStorageRoot }, directory)),
      /绝对路径/,
    ));
  for (const input of [
    null,
    [],
    {},
    { memberStorageRoot: base, repository: base },
  ])
    (await assert.rejects(async () => (await saveSystemSettings(input, directory))));
  const regularFile = path.join(directory, "file.txt");
  fs.writeFileSync(regularFile, "fixture");
  (await assert.rejects(async () =>
    (await saveSystemSettings({ memberStorageRoot: regularFile }, directory)),
  ));
  assert.equal(fs.readFileSync(file, "utf8"), saved);
});

test("server directory browser lists only directories with pagination and parent navigation", async (t) => {
  const directory = temporary(t);
  for (const name of ["folder-1", "folder-2", "folder-10", "中文目录"])
    fs.mkdirSync(path.join(directory, name));
  fs.writeFileSync(path.join(directory, "private.txt"), "not returned");
  const first = await listDirectories(
    { path: directory, limit: "2" },
    directory,
  );
  assert.equal(first.path, fs.realpathSync.native(directory));
  assert.equal(first.parentPath, path.dirname(first.path));
  assert.equal(first.directories.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(
    first.roots.some(
      (root) =>
        root.path.toLowerCase() === path.parse(directory).root.toLowerCase(),
    ),
  );
  const second = await listDirectories(
    { path: directory, limit: "2", offset: "2" },
    directory,
  );
  assert.equal(second.hasMore, false);
  assert.equal(
    new Set(
      [...first.directories, ...second.directories].map((entry) => entry.path),
    ).size,
    4,
  );
  assert.ok(!JSON.stringify(first).includes("private.txt"));
  const selected = await listDirectories(
    { path: first.directories[0].path },
    directory,
  );
  assert.equal(selected.parentPath, first.path);
  assert.deepEqual(selected.directories, []);
  assert.equal((await listDirectories({}, directory)).path, first.path);
  assert.equal(
    (await listDirectories({}, path.join(directory, "missing"))).path,
    await fs.promises.realpath(os.homedir()),
  );
  for (const input of [
    { path: "relative" },
    { path: path.join(directory, "missing") },
    { path: path.join(directory, "private.txt") },
    { offset: "-1" },
    { limit: "201" },
    { limit: "0" },
  ])
    await assert.rejects(listDirectories(input, directory));
});

test("global system endpoints work before workspace creation and enforce origin and page token", async (t) => {
  const directory = temporary(t);
  const workspaces = new WorkspaceManager({
    directory: path.join(directory, "workspaces"),
  });
  const app = createWebServer({ testIdentity: true, workspaces });
  t.after(() => app.close());
  const origin = await app.listen(0);
  const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json();
  assert.deepEqual(bootstrap.workspaces, []);
  assert.equal((await fetch(`${origin}/api/system/settings`)).status, 200);
  const base = path.join(directory, "new-base");
  const write = (headers = {}, input = { memberStorageRoot: base }) =>
    fetch(`${origin}/api/system/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  assert.equal((await write()).status, 403);
  assert.equal(
    (
      await write({
        "x-tapd-token": bootstrap.token,
        origin: "https://elsewhere.invalid",
      })
    ).status,
    403,
  );
  assert.equal(fs.existsSync(base), false);
  const response = await write({ "x-tapd-token": bootstrap.token });
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.equal(settings.memberStorageRoot, fs.realpathSync.native(base));
  assert.deepEqual(
    await (await fetch(`${origin}/api/system/settings`)).json(),
    settings,
  );
  const browse = await fetch(
    `${origin}/api/system/directories?path=${encodeURIComponent(directory)}`,
  );
  assert.equal(browse.status, 200);
  assert.ok(
    (await browse.json()).directories.some(
      (entry) => entry.name === "new-base",
    ),
  );
  assert.equal(
    (
      await fetch(`${origin}/api/system/directories`, {
        headers: { origin: "https://elsewhere.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${origin}/api/system/directories?limit=invalid`)).status,
    400,
  );
  assert.equal(
    (
      await write(
        { "x-tapd-token": bootstrap.token },
        { memberStorageRoot: "relative" },
      )
    ).status,
    400,
  );
  assert.equal((await fetch(`${origin}/api/settings`)).status, 400);
  assert.deepEqual((await workspaces.list()), []);
});
