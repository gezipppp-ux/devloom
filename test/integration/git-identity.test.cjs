const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { createGitCredentialEnvironment } = require("../../src/git/account-credentials.cjs");
const { childEnvironment } = require("../../src/codex/environment.cjs");
const { temporary } = require("../support/helpers.cjs");

test("credentialed worktrees retain system/global commit identity but not authentication, with local identity taking precedence", async t => {
  const directory = temporary(t);
  const globalConfig = path.join(directory, "global.gitconfig");
  const systemConfig = path.join(directory, "system.gitconfig");
  fs.writeFileSync(systemConfig, '[user]\n email = system@example.invalid\n');
  fs.writeFileSync(globalConfig, '[user]\n name = "Fixture \\"Author\\" User"\n useConfigOnly = true\n[credential]\n helper = unsafe-helper\n[http "https://git.example.invalid/"]\n extraHeader = Authorization: secret-global-header\n');
  const names = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"];
  const previous = names.map(name => process.env[name]);
  let credentials;
  try {
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_SYSTEM = systemConfig;
    delete process.env.GIT_CONFIG_NOSYSTEM;
    credentials = await createGitCredentialEnvironment(
      { authType: "http", username: "fixture", password: "fixture-secret" },
      "https://git.example.invalid/team/repo.git",
    );
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
  t.after(() => credentials.dispose());
  const env = { ...childEnvironment(process.env, { stripGit: true }), ...credentials.env };
  delete env.EMAIL;
  const git = (...args) => execFileSync("git", args, { env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const repository = path.join(directory, "repository"), worktree = path.join(directory, "worktree");
  git("init", repository);
  git("-C", repository, "commit", "--allow-empty", "-m", "initial");
  git("-C", repository, "worktree", "add", "-b", "codex/identity", worktree);
  git("-C", worktree, "commit", "--allow-empty", "-m", "worktree commit");
  assert.equal(git("-C", worktree, "log", "-1", "--format=%an <%ae>"), 'Fixture "Author" User <system@example.invalid>');
  assert.equal(git("-C", worktree, "config", "--get", "credential.helper"), "");
  assert.doesNotMatch(fs.readFileSync(credentials.env.GIT_CONFIG_GLOBAL, "utf8"), /fixture-secret|secret-global-header|unsafe-helper/);
  git("-C", worktree, "config", "user.name", "Repository Author");
  git("-C", worktree, "config", "user.email", "repository@example.invalid");
  git("-C", worktree, "commit", "--allow-empty", "-m", "local identity");
  assert.equal(git("-C", worktree, "log", "-1", "--format=%an <%ae>"), "Repository Author <repository@example.invalid>");
});

test("missing Git author defaults do not invent a commit identity", async t => {
  const directory = temporary(t), empty = path.join(directory, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  const names = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"];
  const previous = names.map(name => process.env[name]);
  let credentials;
  try {
    for (const name of names) process.env[name] = empty;
    credentials = await createGitCredentialEnvironment({ authType: "http", username: "fixture", password: "fixture" }, "https://git.example.invalid/repo.git");
    assert.equal(fs.readFileSync(credentials.env.GIT_CONFIG_GLOBAL, "utf8"), "");
  } finally {
    credentials?.dispose();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
