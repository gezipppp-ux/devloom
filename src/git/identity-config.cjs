const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

// Preserve author defaults without importing credential helpers, HTTP headers
// or URL rewrites. A global fallback lets repository/worktree config still win.
async function createGitIdentityConfig() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "web-coding-git-identity-"));
  const dispose = () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^GIT_/i.test(name) || /^GIT_CONFIG_(?:GLOBAL|SYSTEM|NOSYSTEM)$/i.test(name),
  ));
  const options = { cwd: directory, env, encoding: "utf8", windowsHide: true, timeout: 5000 };
  try {
    let output = "";
    try {
      ({ stdout: output } = await execute("git", ["config", "--null", "--show-scope", "--get-regexp",
        "^(user\\.(name|email|useconfigonly)|(author|committer)\\.(name|email))$"], options));
    } catch (error) {
      if (error.code !== 1) throw new Error("无法读取服务用户的 Git 提交身份配置。");
    }
    const file = path.join(directory, "identity.gitconfig");
    fs.writeFileSync(file, "", { mode: 0o600, flag: "wx" });
    const fields = output.split("\0");
    for (let index = 0; index + 1 < fields.length; index += 2) {
      if (!["system", "global"].includes(fields[index])) continue;
      const entry = fields[index + 1], separator = entry.indexOf("\n");
      const key = separator < 0 ? entry : entry.slice(0, separator);
      const value = separator < 0 ? "true" : entry.slice(separator + 1);
      await execute("git", ["config", "--file", file, "--add", key, value], options);
    }
    return { file, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

module.exports = { createGitIdentityConfig };
