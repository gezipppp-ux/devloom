const { execFile } = require("node:child_process");
const { remoteUrl, remoteAuthType } = require("../domain/git-account.cjs");
const {
  withSshPrivateKey,
  createSshPrivateKeyFile,
} = require("./ssh-key-files.cjs");
const { runClone } = require("./clone-process.cjs");
const { createGitIdentityConfig } = require("./identity-config.cjs");

function execute(args, env, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        encoding: "utf8",
        windowsHide: true,
        timeout,
        maxBuffer: 8 * 1024 * 1024,
        env,
      },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              error.killed
                ? "Git 连接超时，请检查网络后重试。"
                : "Git 连接失败，请检查远程仓库地址、账号密码或 SSH 公钥授权。",
            ),
          );
        else resolve(stdout.replace(/\r?\n$/, ""));
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}
function shellPath(file) {
  return "'" + file.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
}

function gitAccountEnvironment(account, remote) {
  remoteUrl(remote);
  if (account.authType !== remoteAuthType(remote))
    throw new Error("Git 认证方式与远程地址不匹配。");
  const env = {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const config = {
    "credential.helper": "",
    "credential.interactive": "false",
    "http.followRedirects": "false",
  };
  if (account.authType === "http") {
    const url = new URL(remote);
    config["http.extraHeader"] = "";
    config[`http.${url.origin}/.extraHeader`] =
      "Authorization: Basic " +
      Buffer.from(account.username + ":" + account.password).toString("base64");
  }
  env.GIT_CONFIG_COUNT = String(Object.keys(config).length);
  Object.entries(config).forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function isolatedGitEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:GIT_|GCM_|TAPD_|DSC_TOKEN$|SSH_AUTH_SOCK$|RUNNER_ENCRYPTION_KEY$)/i.test(
          key,
        ),
    ),
  );
}

async function createGitCredentialEnvironment(account, remote) {
  const env = gitAccountEnvironment(account, remote);
  const identity = await createGitIdentityConfig();
  let key;
  try {
    env.GIT_CONFIG_GLOBAL = identity.file;
    if (account.authType === "ssh") {
      key = await createSshPrivateKeyFile(account.sshPrivateKey);
      env.GIT_SSH_COMMAND = `ssh -F ${process.platform === "win32" ? "NUL" : "/dev/null"} -i ${shellPath(key.file)} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
      env.GIT_SSH_VARIANT = "ssh";
    }
    return { env, revision: account.revision, dispose: () => {
      try { key?.dispose(); } finally { identity.dispose(); }
    } };
  } catch (error) {
    identity.dispose();
    throw error;
  }
}

async function withGitAccount(account, remote, operation, executeCommand = execute) {
  const env = {
    ...isolatedGitEnvironment(),
    ...gitAccountEnvironment(account, remote),
  };
  const run = () =>
    operation((args, options = {}) => executeCommand(args, env, options.timeout));
  if (account.authType !== "ssh") return run();
  return withSshPrivateKey(account.sshPrivateKey, (key) => {
    env.GIT_SSH_COMMAND = `ssh -F ${process.platform === "win32" ? "NUL" : "/dev/null"} -i ${shellPath(key)} -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
    env.GIT_SSH_VARIANT = "ssh";
    return run();
  });
}
async function testGitConnection(account, remote) {
  // An accessible empty repository has no refs but is still a valid connection.
  await withGitAccount(account, remote, (run) =>
    run(["ls-remote", "--", remote], { timeout: 30000 }),
  );
  return { ok: true };
}
async function cloneGitRepository(account, remote, target, options = {}) {
  await withGitAccount(account, remote, (run) =>
    run(["clone", "--progress", "--", remote, target]),
    (args, env) => runClone(args, env, options),
  );
  return target;
}
function gitInstallation() {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["--version"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
      (error, stdout) =>
        resolve(
          error
            ? { installed: false, version: null }
            : { installed: true, version: stdout.trim() },
        ),
    );
  });
}
module.exports = {
  withGitAccount,
  gitAccountEnvironment,
  createGitCredentialEnvironment,
  testGitConnection,
  cloneGitRepository,
  gitInstallation,
};
