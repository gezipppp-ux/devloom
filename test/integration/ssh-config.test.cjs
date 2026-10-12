const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { withGitAccount } = require("../../src/git/account-credentials.cjs");
const { withSshPrivateKey } = require("../../src/git/ssh-key-files.cjs");

function findWindowsExecutables(name) {
  try {
    return execFileSync("where.exe", [name], { encoding: "utf8", windowsHide: true })
      .trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function sshImplementations() {
  if (process.platform !== "win32") return [{ name: "PATH OpenSSH", command: "ssh" }];
  const systemSsh = findWindowsExecutables("ssh.exe")[0];
  const bundled = new Set();
  for (const git of findWindowsExecutables("git.exe")) {
    let directory = path.dirname(git);
    for (let level = 0; level < 3; level += 1) {
      const ssh = path.join(directory, "usr", "bin", "ssh.exe");
      if (fs.existsSync(ssh)) bundled.add(ssh);
      directory = path.dirname(directory);
    }
  }
  return [
    { name: "PATH OpenSSH", command: systemSsh },
    ...(bundled.size ? [...bundled].map(command => ({ name: `Git bundled OpenSSH (${command})`, command }))
      : [{ name: "Git bundled OpenSSH", command: null }]),
  ];
}

test("SSH private key callbacks retain their string argument and clean key and config after rejection", async () => {
  let keyFile, configFile;
  await assert.rejects(withSshPrivateKey("fixture private key", async (file, config) => {
    keyFile = file;
    configFile = config;
    assert.equal(typeof file, "string");
    assert.equal(path.dirname(file), path.dirname(config));
    assert.equal(fs.readFileSync(config, "utf8"), "");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(config).mode & 0o777, 0o600);
    }
    throw new Error("fixture rejected operation");
  }), /fixture rejected operation/);
  assert.equal(fs.existsSync(keyFile), false);
  assert.equal(fs.existsSync(configFile), false);
  assert.equal(fs.existsSync(path.dirname(keyFile)), false);
});

test("installed SSH implementations parse the generated account command without a network connection", async t => {
  for (const { name, command } of sshImplementations()) {
    await t.test(name, { skip: !command && "SSH implementation is not installed; coverage unavailable" }, async () => {
      await withGitAccount(
        { authType: "ssh", sshPrivateKey: "fixture private key, never used for authentication" },
        "git@ssh-config.example.invalid:team/repo.git",
        run => run(["fixture-config-check"]),
        async (_args, env) => {
          // Decode the generated shell quoting, but execute SSH directly with -G:
          // configuration parsing cannot authenticate or open a connection.
          const tokens = env.GIT_SSH_COMMAND.match(/'(?:[^']|'\\'')*'|\S+/g);
          assert.equal(tokens.shift(), "ssh");
          const args = tokens.map(token => token.startsWith("'")
            ? token.slice(1, -1).replaceAll("'\\''", "'") : token);
          const config = args[args.indexOf("-F") + 1];
          assert.equal(fs.readFileSync(config, "utf8"), "");
          const stdout = execFileSync(command, [...args, "-G", "git@ssh-config.example.invalid"], {
            encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
          });
          assert.match(stdout, /^hostname ssh-config\.example\.invalid\r?$/m);
          assert.match(stdout, /^batchmode yes\r?$/m);
          assert.match(stdout, /^identitiesonly yes\r?$/m);
          assert.match(stdout, /^identityagent none\r?$/m);
        },
      );
    });
  }
});
