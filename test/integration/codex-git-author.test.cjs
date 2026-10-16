const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { AppServerClient } = require("../../src/codex/app-server-client.cjs");
const { CodexAgent } = require("../../src/agents/codex-agent.cjs");
const { createGitCredentialEnvironment } = require("../../src/git/account-credentials.cjs");
const { temporary } = require("../support/helpers.cjs");

for (const mode of ["nullable", "filtered"]) test(`configured commit authors reach ${mode} Codex shells on new and resumed sessions, including rotation and clearing`, async t => {
  const repository = temporary(t), worktree = path.join(repository, "task");
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init");
  for (const prefix of ["user", "author", "committer"]) {
    git("config", `${prefix}.name`, "Original Author");
    git("config", `${prefix}.email`, "original@example.invalid");
  }
  git("-c", "core.hooksPath=", "commit", "--allow-empty", "-m", "initial");
  git("worktree", "add", "-b", "codex/author", worktree);
  const originalConfig = git("config", "--local", "--list");
  let account = { authType: "http", username: "login", password: "fixture-secret", authorName: "指定作者", authorEmail: "chosen@example.invalid", revision: 1 };
  const client = new AppServerClient({ command: process.execPath, command_args: [
    path.resolve(__dirname, "../fixtures/codex-git-author.cjs"), path.join(repository, ".git", "fixture-session.json"), mode,
  ] }, {
    gitCredentialProvider: () => createGitCredentialEnvironment(account, "https://git.example.invalid/repo.git"),
    gitCredentialRevision: () => account.revision,
  });
  const agent = new CodexAgent({ client });
  t.after(() => agent.close());
  const selection = { model: "", permissionMode: "full", reasoningEffort: "" };
  await agent.connect();
  assert.deepEqual(await agent.createSession({ cwd: worktree, selection }), { sessionId: "author-session" });
  const commit = () => client.request("fixture/commit", { cwd: worktree });
  assert.deepEqual(await commit(), { identity: "指定作者 <chosen@example.invalid>|指定作者 <chosen@example.invalid>", setting: mode === "filtered" ? "preserved" : null });
  assert.doesNotMatch(JSON.stringify(client.child.spawnargs), /fixture-secret|Authorization/);
  account = { ...account, authorName: "Updated Author", authorEmail: "updated@example.invalid", revision: 2 };
  assert.equal(await agent.refreshGitCredentials(), true);
  await agent.connect();
  await agent.resumeSession({ sessionId: "author-session", cwd: worktree, selection });
  assert.equal((await commit()).identity, "Updated Author <updated@example.invalid>|Updated Author <updated@example.invalid>");
  account = { ...account, authorName: "", authorEmail: "", revision: 3 };
  assert.equal(await agent.refreshGitCredentials(), true);
  await agent.connect();
  await agent.resumeSession({ sessionId: "author-session", cwd: worktree, selection });
  assert.equal((await commit()).identity, "Original Author <original@example.invalid>|Original Author <original@example.invalid>");
  assert.equal(git("config", "--local", "--list"), originalConfig);
});
