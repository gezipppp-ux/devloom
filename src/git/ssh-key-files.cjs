const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

async function withSshKeyDirectory(operation) {
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
    return await operation(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}

function withSshPrivateKey(privateKey, operation) {
  return withSshKeyDirectory(async (directory) => {
    const file = path.join(directory, "identity");
    fs.writeFileSync(file, privateKey, { mode: 0o600, flag: "wx" });
    return operation(file);
  });
}
module.exports = { withSshKeyDirectory, withSshPrivateKey };
