const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

async function createSshKeyDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-ssh-"));
  try {
    if (process.platform === "win32") {
      // POSIX modes do not restrict Windows ACLs. Protect the directory before
      // writing private material, and let files inherit only the service SID.
      const { stdout } = await execute(
        "whoami",
        ["/user", "/fo", "csv", "/nh"],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
      if (!sid) throw new Error("无法确认服务端 SSH 密钥所有者。");
      await execute(
        "icacls",
        [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`],
        { windowsHide: true, timeout: 5000 },
      );
    } else fs.chmodSync(directory, 0o700);
    return directory;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}

function removeSshKeyDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

async function withSshKeyDirectory(operation) {
  const directory = await createSshKeyDirectory();
  try {
    return await operation(directory);
  } finally {
    removeSshKeyDirectory(directory);
  }
}

async function createSshPrivateKeyFile(privateKey) {
  const directory = await createSshKeyDirectory();
  try {
    const file = path.join(directory, "identity");
    fs.writeFileSync(file, privateKey, { mode: 0o600, flag: "wx" });
    // An actual empty file works with both Windows OpenSSH and Git's bundled SSH.
    // NUL and /dev/null are not interpreted consistently across those programs.
    const configFile = path.join(directory, "config");
    fs.writeFileSync(configFile, "", { mode: 0o600, flag: "wx" });
    return {
      file,
      configFile,
      dispose: () => removeSshKeyDirectory(directory),
    };
  } catch (error) {
    removeSshKeyDirectory(directory);
    throw error;
  }
}

async function withSshPrivateKey(privateKey, operation) {
  const key = await createSshPrivateKeyFile(privateKey);
  try {
    return await operation(key.file, key.configFile);
  } finally {
    key.dispose();
  }
}
module.exports = {
  withSshKeyDirectory,
  withSshPrivateKey,
  createSshPrivateKeyFile,
};
