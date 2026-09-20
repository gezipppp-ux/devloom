const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { initializeDatabase } = require("../../src/storage/database-lifecycle.cjs");
const { AccountServices } = require("../../src/application/account-services.cjs");
const { GitAccountServices } = require("../../src/application/git-account-services.cjs");
const { WorkspaceManager } = require("../../src/application/workspace-manager.cjs");
const { projectName, remoteAuthType, remoteUrl, validateGitAccount } = require("../../src/domain/git-account.cjs");
const { saveSystemSettings } = require("../../src/config/system-settings.cjs");
const { readSettings, saveSettings } = require("../../src/config/execution-settings.cjs");
const { testGitConnection } = require("../../src/git/account-credentials.cjs");
const { cloneProject } = require("../../src/git/project-clone.cjs");
const { withSshPrivateKey } = require("../../src/git/ssh-key-files.cjs");
const { mutateRepository } = require("../../src/application/repository-services.cjs");
const { gitRemote } = require("../support/git-remote.cjs");

async function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-git-accounts-"));
  let database, remote;
  t.after(async () => { await remote?.close(); database?.close(); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); });
  database = await initializeDatabase(directory);
  remote = await gitRemote(path.join(directory, "git-server"), options);
  const storageRoot = path.join(directory, "members");
  saveSystemSettings({ memberStorageRoot: storageRoot }, directory);
  const accounts = new AccountServices(database);
  const actor = await accounts.create({ username: "admin", password: "fixture-password" }, null, true);
  const other = await accounts.create({ username: "member", password: "fixture-password" }, actor);
  const services = new GitAccountServices(database);
  const input = { name: "开发 HTTP Git", authType: "http", remoteUrl: remote.remoteUrl, username: remote.username, password: remote.password };
  return { directory, database, remote, storageRoot, actor, other, services, input };
}

test("HTTP ordinary passwords with shell characters are tested before encrypted save; edits preserve omitted secrets", async t => {
  const { database, actor, other, services, input, remote } = await fixture(t);
  await assert.rejects(services.save(actor, { ...input, password: "wrong" }), /Git 连接失败/);
  assert.deepEqual(services.list(actor), []);
  const saved = await services.save(actor, input);
  assert.equal(saved.username, input.username);
  assert.equal(saved.authType, "http");
  assert.equal(saved.remoteUrl, remote.remoteUrl);
  assert.equal(saved.password, undefined);
  assert.equal(saved.sshPrivateKey, undefined);
  assert.equal(database.handle.prepare("SELECT credentials FROM user_git_accounts").get().credentials.includes(input.password), false);
  assert.ok(remote.requests.some(request => request.authorization === "Basic " + Buffer.from(input.username + ":" + input.password).toString("base64")));
  await assert.rejects(services.save(actor, { ...input, name: "invalid draft", password: "bad" }, saved.id), /Git 连接失败/);
  assert.deepEqual(services.list(actor), [saved]);
  const { password: omitted, ...edit } = input;
  assert.ok(omitted);
  const updated = await services.save(actor, { ...edit, name: "renamed" }, saved.id);
  assert.equal(updated.name, "renamed");
  assert.equal(services.store.read(saved.id, actor.id).password, input.password);
  assert.deepEqual(services.list(other), []);
  await assert.rejects(services.save(other, edit, saved.id), /不存在/);
  assert.throws(() => services.remove(other, saved.id), /不存在/);
});

test("empty Git repositories are a successful connectivity test", async t => {
  const { services, actor, input } = await fixture(t, { empty: true });
  assert.equal((await services.check(actor, input)).ok, true);
  assert.equal(services.list(actor).length, 0);
  assert.ok((await services.save(actor, input)).id);
});

test("generated SSH keys expose only public material, stay owner-scoped and are consumed only after successful save", async t => {
  const { database, actor, other } = await fixture(t);
  let fails = true;
  const services = new GitAccountServices(database, { checkConnection: async () => { if (fails) throw new Error("fixture connection failed"); } });
  const draft = await services.generateKey(actor);
  assert.deepEqual(Object.keys(draft).sort(), ["expiresAt", "id", "publicKey"]);
  assert.match(draft.publicKey, /^ssh-ed25519 /);
  const internal = services.store.keyDraft(draft.id, actor.id);
  assert.match(internal.sshPrivateKey, /BEGIN OPENSSH PRIVATE KEY/);
  const derived = await withSshPrivateKey(internal.sshPrivateKey, keyFile => execFileSync("ssh-keygen", ["-y", "-f", keyFile], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim());
  assert.equal(derived.split(" ").slice(0, 2).join(" "), draft.publicKey.split(" ").slice(0, 2).join(" "));
  assert.doesNotMatch(database.handle.prepare("SELECT credentials FROM git_key_drafts").get().credentials, /PRIVATE KEY/);
  assert.throws(() => services.store.keyDraft(draft.id, other.id), /失效/);
  const input = { name: "SSH", authType: "ssh", remoteUrl: "git@git.example.test:team/project.git", keyDraftId: draft.id };
  await assert.rejects(services.save(actor, input), /failed/);
  assert.deepEqual(services.list(actor), []);
  assert.ok(services.store.keyDraft(draft.id, actor.id));
  fails = false;
  const saved = await services.save(actor, input);
  assert.equal(saved.publicKey, draft.publicKey);
  assert.equal(saved.sshPrivateKey, undefined);
  assert.throws(() => services.store.keyDraft(draft.id, actor.id), /失效/);
  const replacement = await services.generateKey(actor);
  assert.notEqual(replacement.publicKey, saved.publicKey);
  fails = true;
  await assert.rejects(services.save(actor, { ...input, keyDraftId: replacement.id }, saved.id), /failed/);
  assert.equal(services.list(actor)[0].publicKey, saved.publicKey);
});

test("save reauthorizes and rejects concurrent account edits or deletion after connectivity completes", async t => {
  const { database, actor, input } = await fixture(t);
  const services = new GitAccountServices(database, { checkConnection: async () => {} });
  const saved = await services.save(actor, input);
  let release;
  services.checkConnection = () => new Promise(resolve => { release = resolve; });
  const pending = services.save(actor, { ...input, name: "late" }, saved.id);
  const previous = services.store.read(saved.id, actor.id);
  services.store.save(actor.id, { ...input, name: "newer" }, previous);
  release();
  await assert.rejects(pending, /已更改/);
  assert.equal(services.list(actor)[0].name, "newer");
  const unauthorized = services.save(actor, input, saved.id, () => { throw new Error("permission revoked"); });
  release();
  await assert.rejects(unauthorized, /permission revoked/);
  const removed = services.save(actor, input, saved.id);
  services.remove(actor, saved.id);
  release();
  await assert.rejects(removed, /已更改/);
  assert.deepEqual(services.list(actor), []);
});

test("real HTTP clone creates fixed member paths and fetch uses stored credentials", async t => {
  const { directory, database, actor, services, input, storageRoot, remote } = await fixture(t);
  const account = await services.save(actor, input);
  const manager = new WorkspaceManager({ database, directory: path.join(directory, "workspaces") });
  t.after(() => manager.close());
  const create = { name: "项目 A", remoteUrl: input.remoteUrl, gitAccountId: account.id };
  await assert.rejects(manager.createFromGit({ ...create, name: "" }, actor), /名称/);
  assert.equal(fs.existsSync(path.join(storageRoot, "admin")), false);
  const workspace = await manager.createFromGit(create, actor);
  const config = manager.store.read(workspace.id, actor.id);
  assert.equal(config.codex.repository, path.join(storageRoot, "admin", "projects", "remote"));
  const settings = readSettings(manager.configFile(workspace.id));
  assert.equal(settings.worktreeRoot, path.join(storageRoot, "admin", "worktree", "remote"));
  assert.equal(fs.existsSync(path.join(config.codex.repository, "README.md")), true);
  assert.doesNotMatch(fs.readFileSync(path.join(config.codex.repository, ".git", "config"), "utf8"), /Authorization|password|extraHeader/);
  assert.throws(() => saveSettings({ repository: directory }, manager.configFile(workspace.id)), /仅允许/);
  assert.throws(() => services.remove(actor, account.id), /工作区/);
  await assert.rejects(manager.createFromGit({ ...create, name: "duplicate directory" }, actor), /目录已存在/);
  fs.writeFileSync(path.join(remote.repository, "next.txt"), "next fixture change");
  remote.git("add", ".");
  remote.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "next");
  await mutateRepository(manager.configFile(workspace.id), "fetch", { remote: "origin" });
  const head = execFileSync("git", ["-C", config.codex.repository, "rev-parse", "origin/main"], { encoding: "utf8", windowsHide: true }).trim();
  assert.equal(head, remote.git("rev-parse", "HEAD"));
  const nextStorageRoot = path.join(directory, "next-members");
  saveSystemSettings({ memberStorageRoot: nextStorageRoot }, directory);
  const changed = readSettings(manager.configFile(workspace.id));
  assert.equal(changed.repository, config.codex.repository, "changing system root never relocates a clone");
  assert.equal(changed.projectsRoot, path.dirname(config.codex.repository));
  assert.equal(changed.worktreeRoot, path.join(nextStorageRoot, "admin", "worktree", "remote"));
  execFileSync("git", ["-C", config.codex.repository, "remote", "set-url", "origin", input.remoteUrl + "-changed"], { windowsHide: true });
  await assert.rejects(mutateRepository(manager.configFile(workspace.id), "fetch", { remote: "origin" }), /远程|远端/);
});

test("failed or competing clones clean only their own directory; symlinks and existing code are preserved", async t => {
  const { storageRoot, services, actor, input } = await fixture(t);
  const saved = await services.save(actor, input);
  const account = services.store.read(saved.id, actor.id);
  const target = path.join(storageRoot, "admin", "projects", "repo");
  const request = { target, memberStorageRoot: storageRoot, account, remote: input.remoteUrl };
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
      if (scenario === "account-changed") services.store.save(actor.id, { ...input, name: "changed" }, services.store.read(saved.id, actor.id));
      return cloneProject(request);
    } });
    await assert.rejects(manager.createFromGit({ name: "pending", remoteUrl: input.remoteUrl, gitAccountId: saved.id }, actor, () => {
      assert.equal(database.handle.inTransaction, true);
      if (scenario === "revoked") throw new Error("authorization revoked");
    }), scenario === "revoked" ? /revoked/ : /Git 账号已更改/);
    assert.deepEqual(manager.list(actor), []);
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
  assert.throws(() => validateGitAccount({ name: "old", authType: "ssh", remoteUrl: "git@host:repo.git", sshPrivateKey: "private" }), /未知字段/);
  assert.throws(() => validateGitAccount({ name: "mismatch", authType: "ssh", remoteUrl: "http://host/repo.git" }), /不匹配/);
});

test("connection failures never expose URLs, passwords or subprocess diagnostics", async () => {
  const password = "never-reveal-fixture-password";
  const account = { authType: "http", username: "fixture", password };
  await assert.rejects(testGitConnection(account, "http://127.0.0.1:1/private.git"), error => {
    assert.doesNotMatch(error.message, /never-reveal|private\.git|127\.0\.0\.1|Command failed/);
    return /Git 连接失败/.test(error.message);
  });
});
