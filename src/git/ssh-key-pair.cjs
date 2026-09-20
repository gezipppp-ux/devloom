const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const { withSshKeyDirectory } = require("./ssh-key-files.cjs");

async function generateSshKeyPair() {
  try {
    return await withSshKeyDirectory(async (directory) => {
      const file = path.join(directory, "identity");
      await execute(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-C", "web-coding", "-f", file],
        { windowsHide: true, timeout: 15000 },
      );
      return {
        sshPrivateKey: fs.readFileSync(file, "utf8"),
        publicKey: fs.readFileSync(`${file}.pub`, "utf8").trim(),
      };
    });
  } catch {
    throw new Error(
      "无法生成 SSH 密钥，请检查服务器是否安装 OpenSSH（ssh-keygen）。",
    );
  }
}
module.exports = { generateSshKeyPair };
