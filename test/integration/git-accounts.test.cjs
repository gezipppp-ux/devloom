const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const { setImmediate } = require("node:timers");
const { test } = require("node:test");
const { initializeTestDatabase } = require("../support/database.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { projectName, remoteAuthType, remoteUrl, validateGitAccount } = require("../../src/domain/git-account.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { readSettings, saveSettings } = require("../../src/config/execution-settings.cjs");
const {
  testGitConnection,
  createGitCredentialEnvironment,
  withGitAccount,
} = require("../../src/git/account-credentials.cjs");
const { cloneProject } = require("../../src/git/project-clone.cjs");
const { withSshPrivateKey } = require("../../src/git/ssh-key-files.cjs");
const { mutateRepository } = require("../../src/application/repository-services.cjs");
const { gitRemote } = require("../support/git-remote.cjs");

const execute = promisify(execFile);

async function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-git-accounts-"));
  let database, remote;
  t.after(async () => { await remote?.close(); await database?.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); });
  database = await initializeTestDatabase(t, directory);
  remote = await gitRemote(path.join(directory, "git-server"), options);
  const storageRoot = path.join(directory, "members");
  (await saveSystemSettings({ memberStorageRoot: storageRoot }, directory));
  const accounts = new AccountServices(database);
  const actor = await accounts.create({ username: "admin", password: "fixture-password" }, null, true);
  const department = await database.client.department.create({ data: { name: "Fixture department", permissions: [] } });
  const other = await accounts.create({ departmentId: department.id, username: "member", password: "fixture-password" }, actor);
  const services = new GitAccountServices(database, { projects: { authorize: async () => ({ project: { remoteUrl: remote.remoteUrl } }) } });
  const input = { name: "开发 HTTP Git", authType: "http", host: new URL(remote.remoteUrl).origin, username: remote.username, password: remote.password };
  return { directory, database, remote, storageRoot, actor, other, services, input };
}

test("HTTP credentials are encrypted, explicit project checks use them, and revisioned edits preserve omitted secrets", async t => {
  const { database, actor, other, services, input, remote } = await fixture(t);
  await assert.rejects(services.check(actor, { ...input, password: "wrong", projectId: "fixture-project" }), /Git 连接失败/);
  assert.deepEqual((await services.list(actor)), []);
  const saved = await services.save(actor, input);
  assert.equal(saved.username, input.username);
  assert.equal(saved.authType, "http");
  assert.equal(saved.host, new URL(remote.remoteUrl).origin);
  assert.equal(saved.remoteUrl, undefined);
  assert.equal(saved.password, undefined);
  assert.equal(saved.sshPrivateKey, undefined);
  assert.equal((await database.client.gitAccount.findFirstOrThrow()).credentials.includes(input.password), false);
  assert.equal((await services.check(actor, { projectId: "fixture-project" }, saved.id)).ok, true);
  assert.ok(remote.requests.some(request => request.authorization === "Basic " + Buffer.from(input.username + ":" + input.password).toString("base64")));
  await assert.rejects(services.check(actor, { ...input, name: "invalid draft", password: "bad", revision: saved.revision, projectId: "fixture-project" }, saved.id), /Git 连接失败/);
  assert.deepEqual((await services.list(actor)), [saved]);
  const { password: omitted, ...edit } = input;
  assert.ok(omitted);
  const updated = await services.save(actor, { ...edit, name: "renamed", revision: saved.revision }, saved.id);
  assert.equal(updated.name, "renamed");
  assert.equal((await services.store.read(saved.id, actor.id)).password, input.password);
  assert.deepEqual((await services.list(other)), []);
  await assert.rejects(services.save(other, edit, saved.id), /不存在/);
  (await assert.rejects(async () => (await services.remove(other, saved.id)), /不存在/));
});

test("empty Git repositories are a successful connectivity test", async t => {
  const { services, actor, input } = await fixture(t, { empty: true });
  assert.equal((await services.check(actor, { ...input, projectId: "fixture-project" })).ok, true);
  assert.equal((await services.list(actor)).length, 0);
  assert.ok((await services.save(actor, input)).id);
});

test("Gitee project checks use the selected account transport and retain credential ownership and host boundaries", async t => {
  const { database, actor, other } = await fixture(t);
  const calls = [];
  const project = { remoteUrl: "https://gitee.com/team/repo.git", revision: 1 };
  const services = new GitAccountServices(database, {
    projects: { authorize: async () => ({ project: { ...project } }) },
    checkConnection: async (account, remote) => { calls.push({ id: account.id, authType: account.authType, remote }); },
  });
  const draft = await services.store.createKeyDraft(actor.id, { sshPrivateKey: "fixture-private", publicKey: "fixture-public" });
  const ssh = await services.save(actor, { name: "Gitee SSH", authType: "ssh", host: "gitee.com", keyDraftId: draft.id });
  const http = await services.save(actor, { name: "Gitee HTTPS", authType: "http", host: "https://gitee.com", username: "login", password: "fixture-secret" });
  assert.deepEqual(await services.check(actor, { projectId: "fixture-project" }, ssh.id), { ok: true });
  assert.deepEqual(calls.pop(), { id: ssh.id, authType: "ssh", remote: "git@gitee.com:team/repo.git" });
  assert.equal(project.remoteUrl, "https://gitee.com/team/repo.git");
  for (const remote of ["git@gitee.com:team/repo.git", "ssh://git@gitee.com:22/team/repo.git"]) {
    project.remoteUrl = remote;
    assert.deepEqual(await services.check(actor, { projectId: "fixture-project" }, http.id), { ok: true });
    assert.deepEqual(calls.pop(), { id: http.id, authType: "http", remote: "https://gitee.com/team/repo.git" });
  }
  project.remoteUrl = "https://gitee.com/team/repo.git";
  await assert.rejects(services.check(other, { projectId: "fixture-project" }, ssh.id), /不存在/);
  for (const remote of ["https://other.example/team/repo.git", "https://gitee.com:8443/team/repo.git"]) {
    project.remoteUrl = remote;
    await assert.rejects(services.check(actor, { projectId: "fixture-project" }, ssh.id), { code: "GIT_ACCOUNT_REMOTE_MISMATCH" });
  }
  assert.deepEqual(calls, [], "rejected credentials and remotes never reach the network adapter");
});

test("generated SSH keys expose only public material, stay owner-scoped and are consumed only after successful save", async t => {
  const { database, actor, other } = await fixture(t);
  let fails = true;
  const services = new GitAccountServices(database, { checkConnection: async () => { if (fails) throw new Error("fixture connection failed"); } });
  const draft = await services.generateKey(actor);
  assert.deepEqual(Object.keys(draft).sort(), ["expiresAt", "id", "publicKey"]);
  assert.match(draft.publicKey, /^ssh-ed25519 /);
  const internal = (await services.store.keyDraft(draft.id, actor.id));
  assert.match(internal.sshPrivateKey, /BEGIN OPENSSH PRIVATE KEY/);
  const derived = await withSshPrivateKey(internal.sshPrivateKey, keyFile => execFileSync("ssh-keygen", ["-y", "-f", keyFile], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim());
  assert.equal(derived.split(" ").slice(0, 2).join(" "), draft.publicKey.split(" ").slice(0, 2).join(" "));
  assert.doesNotMatch((await database.client.gitKeyDraft.findFirstOrThrow()).credentials, /PRIVATE KEY/);
  (await assert.rejects(async () => (await services.store.keyDraft(draft.id, other.id)), /失效/));
  const input = { name: "SSH", authType: "ssh", host: "git.example.test", keyDraftId: draft.id };
  await assert.rejects(services.save(actor, input, undefined, async () => { if (fails) throw new Error("fixture authorization failed"); }), /failed/);
  assert.deepEqual((await services.list(actor)), []);
  assert.ok((await services.store.keyDraft(draft.id, actor.id)));
  fails = false;
  const saved = await services.save(actor, input);
  assert.equal(saved.publicKey, draft.publicKey);
  assert.equal(saved.sshPrivateKey, undefined);
  (await assert.rejects(async () => (await services.store.keyDraft(draft.id, actor.id)), /失效/));
  const replacement = await services.generateKey(actor);
  assert.notEqual(replacement.publicKey, saved.publicKey);
  fails = true;
  await assert.rejects(services.save(actor, { ...input, keyDraftId: replacement.id, revision: saved.revision }, saved.id, async () => { if (fails) throw new Error("fixture authorization failed"); }), /failed/);
  assert.equal((await services.list(actor))[0].publicKey, saved.publicKey);
});

test("save reauthorizes and rejects concurrent account edits or deletion before persistence", async t => {
  const { database, actor, input } = await fixture(t);
  const services = new GitAccountServices(database, { checkConnection: async () => {} });
  const saved = await services.save(actor, input);
  let release;
  const releaseConnection = async () => {
    const deadline = Date.now() + 10000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, "function");
    const finish = release; release = null; finish();
  };
  const authorize = () => new Promise(resolve => { release = resolve; });
  const pending = services.save(actor, { ...input, name: "late", revision: saved.revision }, saved.id, authorize);
  const previous = (await services.store.read(saved.id, actor.id));
  (await services.store.save(actor.id, { ...input, name: "newer" }, previous));
  await releaseConnection();
  await assert.rejects(pending, /已更改/);
  assert.equal((await services.list(actor))[0].name, "newer");
  const unauthorized = services.save(actor, { ...input, revision: saved.revision + 1 }, saved.id, () => { throw new Error("permission revoked"); });
  await assert.rejects(unauthorized, /permission revoked/);
  const removed = services.save(actor, { ...input, revision: saved.revision + 1 }, saved.id, authorize);
  (await services.remove(actor, saved.id));
  await releaseConnection();
  await assert.rejects(removed, /已更改/);
  assert.deepEqual((await services.list(actor)), []);
});

test("real HTTP clone creates fixed member paths and fetch uses stored credentials", async t => {
  const { directory, database, actor, services, input, storageRoot, remote } = await fixture(t);
  const account = await services.save(actor, input);
  const manager = new WorkspaceManager({ database, directory: path.join(directory, "workspaces") });
  t.after(() => manager.close());
  const create = { name: "项目 A", remoteUrl: input.host + "/remote.git", gitAccountId: account.id };
  await assert.rejects(manager.createFromGit({ ...create, name: "" }, actor), /名称/);
  assert.equal(fs.existsSync(path.join(storageRoot, "admin")), false);
  const workspace = await manager.createFromGit(create, actor);
  const config = (await manager.store.read(workspace.id, actor.id));
  assert.equal(config.execution.repository, path.join(storageRoot, "admin", "projects", "remote"));
  const settings = (await readSettings(manager.configFile(workspace.id)));
  assert.equal(settings.worktreeRoot, path.join(storageRoot, "admin", "worktree", "remote"));
  assert.equal(fs.existsSync(path.join(config.execution.repository, "README.md")), true);
  assert.doesNotMatch(fs.readFileSync(path.join(config.execution.repository, ".git", "config"), "utf8"), /Authorization|password|extraHeader/);
  (await assert.rejects(async () => (await saveSettings({ repository: directory }, manager.configFile(workspace.id))), /仅允许/));
  (await assert.rejects(async () => (await services.remove(actor, account.id)), /工作区/));
  await assert.rejects(manager.createFromGit({ ...create, name: "duplicate directory" }, actor), /目录已存在/);
  fs.writeFileSync(path.join(remote.repository, "next.txt"), "next fixture change");
  remote.git("add", ".");
  remote.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "next");
  await mutateRepository(manager.configFile(workspace.id), "fetch", { remote: "origin" });
  const head = execFileSync("git", ["-C", config.execution.repository, "rev-parse", "origin/main"], { encoding: "utf8", windowsHide: true }).trim();
  assert.equal(head, remote.git("rev-parse", "HEAD"));
  const nextStorageRoot = path.join(directory, "next-members");
  (await saveSystemSettings({ memberStorageRoot: nextStorageRoot }, directory));
  const changed = (await readSettings(manager.configFile(workspace.id)));
  assert.equal(changed.repository, config.execution.repository, "changing system root never relocates a clone");
  assert.equal(changed.projectsRoot, path.dirname(config.execution.repository));
  assert.equal(changed.worktreeRoot, path.join(nextStorageRoot, "admin", "worktree", "remote"));
  execFileSync("git", ["-C", config.execution.repository, "remote", "set-url", "origin", input.host + "/remote.git" + "-changed"], { windowsHide: true });
  await assert.rejects(mutateRepository(manager.configFile(workspace.id), "fetch", { remote: "origin" }), /远程|远端/);
});

test("a workspace provides its saved HTTP Git account to Codex worktree processes without changing origin", async t => {
  const { directory, database, actor, services, input, storageRoot, remote } = await fixture(t);
  const account = await services.save(actor, input);
  const manager = new WorkspaceManager({ database, directory: path.join(directory, "workspaces"),
    createManager: options => ({ ...options, close: async () => {} }) });
  t.after(() => manager.close());
  const workspace = await manager.createFromGit({ name: "推送凭据", remoteUrl: input.host + "/remote.git", gitAccountId: account.id }, actor);
  const config = (await manager.store.read(workspace.id, actor.id));
  const worktree = path.join(storageRoot, "admin", "worktree", "remote", "push-credential");
  execFileSync("git", ["-C", config.execution.repository, "worktree", "add", "-b", "codex/push-credential", worktree, "HEAD"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const context = (await manager.get(workspace.id, actor));
  assert.equal(await context.sessions.gitCredentialRevision(), 1);
  const credentials = await context.sessions.gitCredentialProvider();
  try {
    await execute("git", ["-C", worktree, "ls-remote", "--exit-code", "origin", "refs/heads/main"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...credentials.env },
    });
  } finally {
    credentials.dispose?.();
  }
  assert.ok(remote.requests.some(request => request.authorization === "Basic " + Buffer.from(input.username + ":" + input.password).toString("base64")));
  assert.doesNotMatch(fs.readFileSync(path.join(config.execution.repository, ".git", "config"), "utf8"), /Authorization|password|extraHeader/);
  (await services.store.save(actor.id, { ...input, password: "rotated-fixture-password" }, (await services.store.read(account.id, actor.id))));
  assert.equal(await context.sessions.gitCredentialRevision(), 2, "cached workspace contexts observe account revisions");
  const rotated = await context.sessions.gitCredentialProvider();
  try {
    assert.equal(rotated.revision, 2);
    assert.ok(Object.values(rotated.env).includes("Authorization: Basic " + Buffer.from(input.username + ":rotated-fixture-password").toString("base64")));
  } finally { rotated.dispose(); }
});

test("Codex SSH credential environments keep an empty config beside the private key and clean both when the client closes", async t => {
  const credentials = await createGitCredentialEnvironment(
    { authType: "ssh", sshPrivateKey: "fixture private key" },
    "git@git.example.test:team/project.git",
  );
  t.after(() => credentials.dispose());
  const file = /-i '([^']+)'/.exec(credentials.env.GIT_SSH_COMMAND)?.[1];
  const configFile = /-F '([^']+)'/.exec(credentials.env.GIT_SSH_COMMAND)?.[1];
  assert.ok(file);
  assert.ok(configFile);
  assert.equal(path.dirname(configFile), path.dirname(file));
  assert.equal(fs.readFileSync(configFile, "utf8"), "");
  assert.equal(fs.existsSync(file), true);
  credentials.dispose();
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(configFile), false);
  assert.equal(fs.existsSync(path.dirname(file)), false);
});

test("SSH Git operations keep their isolated config alive until completion and clean it on success or failure", async () => {
  for (const fail of [false, true]) {
    let file, configFile;
    const operation = withGitAccount(
      { authType: "ssh", sshPrivateKey: "fixture private key" },
      "git@git.example.test:team/project.git",
      run => run(["ls-remote", "--", "git@git.example.test:team/project.git"]),
      async (args, env) => {
        assert.equal(args[0], "ls-remote");
        file = /-i '([^']+)'/.exec(env.GIT_SSH_COMMAND)?.[1];
        configFile = /-F '([^']+)'/.exec(env.GIT_SSH_COMMAND)?.[1];
        assert.ok(file);
        assert.ok(configFile);
        assert.equal(path.dirname(configFile), path.dirname(file));
        assert.equal(fs.readFileSync(configFile, "utf8"), "");
        assert.equal(fs.readFileSync(file, "utf8"), "fixture private key");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(fs.existsSync(configFile), true);
        assert.equal(env.GIT_SSH_VARIANT, "ssh");
        if (fail) throw new Error("fixture SSH failure");
        return "fixture refs";
      },
    );
    if (fail) await assert.rejects(operation, /fixture SSH failure/);
    else assert.equal(await operation, "fixture refs");
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(configFile), false);
    assert.equal(fs.existsSync(path.dirname(file)), false);
  }
});

test("failed or competing clones clean only their own directory; symlinks and existing code are preserved", async t => {
  const { storageRoot, services, actor, input } = await fixture(t);
  const saved = await services.save(actor, input);
  const account = (await services.store.read(saved.id, actor.id));
  const target = path.join(storageRoot, "admin", "projects", "repo");
  const request = { target, memberStorageRoot: storageRoot, account, remote: input.host + "/remote.git" };
  await assert.rejects(cloneProject({ ...request, account: { ...account, password: "wrong" } }), /Git 克隆失败/);
  assert.equal(fs.existsSync(target), false);
  const results = await Promise.allSettled([cloneProject(request), cloneProject(request)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.ok(fs.existsSync(path.join(target, "README.md")));
  await assert.rejects(cloneProject(request), /目录已存在/);
  const rejected = path.join(storageRoot, "admin", "projects", "rejected");
  await assert.rejects(cloneProject({ ...request, target: rejected, publish: () => { throw new Error("authorization revoked"); } }), /revoked/);
  assert.equal(fs.existsSync(rejected), false);
  const outside = path.join(storageRoot, "peer");
  fs.mkdirSync(outside);
  const link = path.join(storageRoot, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(cloneProject({ ...request, target: path.join(link, "repo") }), /符号链接/);
  await assert.rejects(cloneProject({ ...request, memberStorageRoot: link, target: path.join(link, "repo") }), /符号链接/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("workspace publication rechecks authorization and credentials inside the short transaction", async t => {
  const { directory, database, storageRoot, actor, services, input } = await fixture(t);
  const saved = await services.save(actor, input);
  for (const scenario of ["revoked", "account-changed"]) {
    const manager = new WorkspaceManager({ database, directory: path.join(directory, "workspaces"), cloneProject: async request => {
      if (scenario === "account-changed") (await services.store.save(actor.id, { ...input, name: "changed" }, (await services.store.read(saved.id, actor.id))));
      return cloneProject(request);
    } });
    await assert.rejects(manager.createFromGit({ name: "pending", remoteUrl: input.host + "/remote.git", gitAccountId: saved.id }, actor, () => {
      assert.notEqual(database.client, database.baseClient);
      if (scenario === "revoked") throw new Error("authorization revoked");
    }), scenario === "revoked" ? /revoked/ : /Git 账号已更改/);
    assert.deepEqual((await manager.list(actor)), []);
    assert.equal(fs.existsSync(path.join(storageRoot, "admin", "projects", "remote")), false);
  }
});

test("HTTP and SSH address validation is explicit and rejects secret-bearing URLs and removed fields", () => {
  for (const protocol of ["http", "https"]) assert.equal(remoteAuthType(protocol + "://git.example.test:3000/team/project.git"), "http");
  for (const remote of ["git@git.example.test:team/project.git", "ssh://git@git.example.test:2222/team/project.git"]) {
    assert.equal(remoteAuthType(remote), "ssh"); assert.equal(projectName(remote), "project");
  }
  for (const remote of ["http://user:secret@example.test/repo", "file:///repo", "http://host/", "http://host/repo?token=secret", "-invalid", "git@host:repo\n"])
    assert.throws(() => remoteUrl(remote), /地址/);
  for (const name of ["..", "CON", "aux.txt"]) assert.throws(() => projectName("http://host/" + name + ".git"), /项目目录/);
  assert.throws(() => validateGitAccount({ name: "old", protocol: "http" }), /未知字段/);
  assert.throws(() => validateGitAccount({ name: "old", authType: "ssh", host: "host", sshPrivateKey: "private" }), /未知字段/);
  assert.throws(() => validateGitAccount({ name: "mismatch", authType: "ssh", host: "http://host" }), /主机/);
});

test("connection failures never expose URLs, passwords or subprocess diagnostics", async () => {
  const password = "never-reveal-fixture-password";
  const account = { authType: "http", username: "fixture", password };
  await assert.rejects(testGitConnection(account, "http://127.0.0.1:1/private.git"), error => {
    assert.doesNotMatch(error.message, /never-reveal|private\.git|127\.0\.0\.1|Command failed/);
    return /Git 连接失败/.test(error.message);
  });
});

test("referenced accounts cannot switch protocol even if a workspace is published during asynchronous authorization", async t => {
  const { directory, database, actor, input } = await fixture(t);
  const services = new GitAccountServices(database, { checkConnection: async () => {} });
  const manager = new WorkspaceManager({ database, directory: path.join(directory, "workspaces"), cloneProject: async ({ publish }) => publish() });
  t.after(() => manager.close());
  for (const type of ["http", "ssh"]) {
    const draft = (await services.store.createKeyDraft(actor.id, { sshPrivateKey: "fixture-private", publicKey: "fixture-public" }));
    const ssh = { name: `SSH ${type}`, authType: "ssh", host: "git.example.invalid", keyDraftId: draft.id };
    const http = { ...input, name: `HTTP ${type}` };
    const initial = type === "http" ? http : ssh;
    const replacement = type === "http" ? ssh : http;
    const saved = await services.save(actor, initial);
    const before = (await services.store.read(saved.id, actor.id));
    let release;
    const authorize = () => new Promise(resolve => { release = resolve; });
    const pending = services.save(actor, { ...replacement, revision: saved.revision }, saved.id, authorize);
    await manager.createFromGit({ name: `workspace ${type}`, remoteUrl: initial.authType === "http" ? initial.host + "/remote.git" : "git@" + initial.host + ":repo.git", gitAccountId: saved.id }, actor);
    const deadline = Date.now() + 10000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, "function");
    release();
    await assert.rejects(pending, error => error.statusCode === 409 && /不能切换主机或认证方式/.test(error.message));
    assert.deepEqual((await services.store.read(saved.id, actor.id)), before);
    if (type === "http") assert.ok((await services.store.keyDraft(draft.id, actor.id)), 'a rejected update must not consume the new key');
    services.checkConnection = async () => {};
    const { keyDraftId, ...sameType } = initial;
    assert.ok(keyDraftId || type === "http");
    const updated = await services.save(actor, { ...sameType, name: `renamed ${type}`, revision: saved.revision }, saved.id);
    assert.equal(updated.authType, type);
  }
  const unreferenced = await services.save(actor, { ...input, name: "unreferenced" });
  const draft = (await services.store.createKeyDraft(actor.id, { sshPrivateKey: "fixture-private", publicKey: "fixture-public" }));
  const changed = await services.save(actor, { name: "unreferenced", authType: "ssh", host: "git.example.invalid", keyDraftId: draft.id, revision: unreferenced.revision }, unreferenced.id);
  assert.equal(changed.authType, "ssh");
});
