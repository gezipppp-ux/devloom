/* global document, window */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { fork, execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { seedProjectDepartment, prepareHttpProject } = require("../support/project-http.cjs");
const { postgresFixture } = require("../support/postgres.cjs");
const { gitRemote } = require("../support/git-remote.cjs");

const root = path.resolve(__dirname, "../..");

async function availablePort(requestedPort = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function until(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function createFixture(directory) {
  // Copy only source files: never read credentials, runs, uploads or dist.
  for (const name of ["src", "shared", "prisma", "generated/prisma-runtime"])
    fs.cpSync(path.join(root, name), path.join(directory, name), {
      recursive: true,
    });
  fs.cpSync(path.join(root, "web", "src"), path.join(directory, "web", "src"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(root, "package.json"),
    path.join(directory, "package.json"),
  );
  const dependencies = path.join(root, "node_modules");
  fs.symlinkSync(
    dependencies,
    path.join(directory, "node_modules"),
    "junction",
  );
  const config = fs.readFileSync(
    path.join(root, "web", "vite.config.mjs"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(directory, "web", "vite.config.mjs"),
    config.replace(
      "defineConfig({",
      `defineConfig({
  cacheDir: fileURLToPath(new URL('./.vite/', import.meta.url)),
  server: { fs: { allow: [${JSON.stringify(dependencies)}] } },`,
    ),
  );
  fs.writeFileSync(
    path.join(directory, "web", "index.html"),
    '<!doctype html><html><head><title>Development fixture</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
  );
  fs.writeFileSync(
    path.join(directory, "web", "src", "main.js"),
    'import { createApp } from "vue";\nimport Fixture from "./DevFixture.vue";\ncreateApp(Fixture).mount("#app");\n',
  );
  fs.writeFileSync(
    path.join(directory, "web", "src", "DevFixture.vue"),
    `<script setup>
import { onMounted, ref } from 'vue';
const token = ref('');
onMounted(async () => {
  const response = await fetch('/api/bootstrap');
  token.value = (await response.json()).token;
});
</script>
<template><h1>Before hot update</h1><output id="token">{{ token }}</output></template>
`,
  );
  // Child startup/exit records prove both dev instances and their supervisor
  // exit naturally. The instrumentation exists only in this temporary copy.
  fs.writeFileSync(
    path.join(directory, "preload.cjs"),
    `const fs = require('node:fs');
const file = ${JSON.stringify(path.join(directory, "processes.jsonl"))};
const record = (event) => fs.appendFileSync(file, JSON.stringify({ event, pid: process.pid }) + '\\n');
record('start');
process.on('exit', () => record('exit'));
`,
  );
}

async function main() {
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "web-coding-dev-"));
  const processFile = path.join(directory, "processes.jsonl");
  const records = () =>
    fs.existsSync(processFile)
      ? fs
          .readFileSync(processFile, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  const databaseCleanup = [];
  let child;
  let browser;
  let remote;
  let output = "";
  let exited = false;
  let exitCode;
  try {
    const database = await postgresFixture({ after: callback => databaseCleanup.push(callback) });
    await database.deploy();
    createFixture(directory);
    remote = await gitRemote(path.join(directory, "git-server"));
    execFileSync(process.execPath, [path.join(directory, "src", "cli", "init-admin.cjs")], {
      cwd: directory,
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: database.url, RUNNER_DATA_DIR: path.join(directory, "data") },
      input: "development-fixture-password\ndevelopment-fixture-password\n",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const seeding = await database.open();
    await seedProjectDepartment(seeding);
    await seeding.client.systemSetup.update({ where: { id: "installation" }, data: { status: "not_required" } });
    await seeding.close();
    const port = await availablePort();
    // Exercise the default wildcard bind through a real interface when present.
    const address = Object.values(os.networkInterfaces()).flat().find(
      (entry) => entry.family === "IPv4" && !entry.internal,
    )?.address || "127.0.0.1";
    const origin = `http://${address}:${port}`;
    child = fork(
      path.join(directory, "src", "cli", "dev-watch.cjs"),
      ["--port", String(port)],
      {
        cwd: directory,
        windowsHide: true,
        env: {
          ...process.env,
          DATABASE_URL: database.url,
          RUNNER_DATA_DIR: path.join(directory, "data"),
          NODE_OPTIONS: `--require ${JSON.stringify(path.join(directory, "preload.cjs"))}`,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("close", (code) => {
      exited = true;
      exitCode = code;
    });
    await until(
      () => output.includes(`监听地址：0.0.0.0:${port}`),
      "The development server did not start.",
    );
    browser = await chromium.launch({
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : process.platform === "win32"
          ? { channel: "msedge" }
          : {}),
      headless: true,
    });
    const page = await browser.newPage();
    const preAuth = await (await page.request.get(`${origin}/api/auth/session`)).json();
    const login = await page.request.post(`${origin}/api/auth/login`, {
      headers: { origin, "x-csrf-token": preAuth.token },
      data: { username: "admin", password: "development-fixture-password" },
    });
    assert.equal(login.status(), 200);
    const errors = [];
    let documents = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.resourceType() === "document") documents++;
    });
    await page.goto(origin);
    await page.getByRole("heading", { name: "Before hot update" }).waitFor();
    await page.waitForFunction(
      () => document.querySelector("#token")?.textContent.length > 20,
    );
    const originalToken = await page.locator("#token").textContent();
    await page.evaluate(() => {
      window.devFixtureMarker = "retained";
    });
    const component = path.join(directory, "web", "src", "DevFixture.vue");
    fs.writeFileSync(
      component,
      fs
        .readFileSync(component, "utf8")
        .replace("Before hot update", "After hot update"),
    );
    await page.getByRole("heading", { name: "After hot update" }).waitFor();
    assert.equal(
      await page.evaluate(() => window.devFixtureMarker),
      "retained",
    );
    assert.equal(
      documents,
      1,
      "Vue template changes must update without a document reload.",
    );
    assert.equal(await page.locator("#token").textContent(), originalToken);
    assert.equal((await page.request.get(`${origin}/api/bootstrap`)).status(), 200,
      "Frontend HMR must retain the authenticated session.");

    fs.appendFileSync(
      path.join(directory, "src", "config", "runtime.cjs"),
      "\n// Temporary browser fixture: trigger the backend watcher.\n",
    );
    await page.waitForFunction(
      (previous) => {
        const token = document.querySelector("#token")?.textContent;
        return token?.length > 20 && token !== previous && !window.devFixtureMarker;
      },
      originalToken,
      { timeout: 30000 },
    );
    assert.equal(await page.evaluate(() => window.devFixtureMarker), undefined);
    assert.equal(
      documents,
      2,
      "Backend restart must reload the document once.",
    );
    await page.getByRole("heading", { name: "After hot update" }).waitFor();
    const request = async (route, input) => {
      const headers = { "x-csrf-token": await page.locator("#token").textContent() };
      const response = input === undefined ? await page.request.get(origin + route) : await page.request.post(origin + route, { headers, data: input });
      return { status: response.status(), data: await response.json() };
    };
    assert.equal((await request("/api/system/settings", { memberStorageRoot: path.join(directory, "members") })).status, 200);
    const account = await request("/api/account/git-accounts", { name: "fixture", authType: "http", host: new URL(remote.remoteUrl).origin, username: remote.username, password: remote.password });
    assert.equal(account.status, 201);
    const workspace = await prepareHttpProject(request, { name: "Temporary development workspace", gitAccountId: account.data.account.id, remoteUrl: remote.remoteUrl });
    const created = { workspace };
    assert.equal(fs.existsSync(path.join(directory, "data", "db", "web-coding.sqlite")), false);
    const storedWorkspaces = await (await page.request.get(`${origin}/api/workspaces`)).json();
    assert.ok(storedWorkspaces.workspaces.some((workspace) => workspace.id === created.workspace.id));
    assert.deepEqual(errors, []);
    assert.equal(output.match(/后端代码已修改/g)?.length, 1);
    assert.equal(output.match(/DevLoom Dev:/g)?.length, 2);

    for (const location of [
      `/projects/${workspace.projectId}?tab=issues&issue=issue-1`,
      `/projects/${workspace.projectId}?tab=tasks&task=task-1&taskStart=1`,
      "/work?bucket=verify",
    ]) {
      const url = origin + location;
      assert.equal((await page.goto(url)).status(), 200, `direct navigation: ${location}`);
      await page.getByRole("heading", { name: "After hot update" }).waitFor();
      assert.equal(page.url(), url, "direct navigation preserves the detail query");
      assert.equal((await page.reload()).status(), 200, `reload: ${location}`);
      await page.getByRole("heading", { name: "After hot update" }).waitFor();
      assert.equal(page.url(), url, "reload preserves the detail query");
    }

    await browser.close();
    browser = undefined;
    child.send({ type: "dev:shutdown" });
    await until(() => exited, "The development supervisor did not shut down.");
    assert.equal(exitCode, 0);
    const started = records().filter((entry) => entry.event === "start");
    assert.equal(
      started.length,
      3,
      "One supervisor and two development server instances must run.",
    );
    for (const entry of started) {
      assert.ok(
        records().some(
          (record) => record.event === "exit" && record.pid === entry.pid,
        ),
      );
      assert.equal(
        alive(entry.pid),
        false,
        `Development process ${entry.pid} must exit.`,
      );
    }
    assert.equal(
      await availablePort(port),
      port,
      "Shutdown must release the development port.",
    );
    process.stdout.write(
      `Development browser checks passed at ${origin}: default LAN access, Vue HMR, backend restart, token refresh and process cleanup.\n`,
    );
  } catch (error) {
    throw new Error(`${error.message}\nDevelopment server output:\n${output}`, {
      cause: error,
    });
  } finally {
    await browser?.close();
    await remote?.close();
    if (child && !exited) {
      if (child.connected) child.send({ type: "dev:shutdown" }, () => {});
      try {
        await until(() => exited, "Development cleanup timed out.", 10000);
      } catch {
        // Failure cleanup is limited to PIDs started by this temporary fixture.
        for (const entry of records()
          .filter((record) => record.event === "start")
          .reverse()) {
          if (!alive(entry.pid)) continue;
          if (process.platform === "win32")
            execFileSync("taskkill", ["/PID", String(entry.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            });
          else process.kill(entry.pid, "SIGKILL");
        }
        await until(
          () => exited,
          "Development processes could not be stopped.",
          5000,
        );
      }
    }
    for (const cleanup of databaseCleanup) await cleanup();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith("web-coding-dev-"));
    const junction = path.join(resolved, "node_modules");
    if (fs.existsSync(junction)) {
      assert.ok(fs.lstatSync(junction).isSymbolicLink());
      fs.unlinkSync(junction);
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
