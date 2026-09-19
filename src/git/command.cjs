const { execFile, execFileSync } = require("node:child_process");

function git(repository, args, { timeout = 60000, maxBuffer = 2 * 1024 * 1024 } = {}) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer,
  }).replace(/\r?\n$/, "");
}

function gitAsync(repository, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "credential.interactive=false", "-C", repository, ...args],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "never",
        },
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.replace(/\r?\n$/, ""));
      },
    ).stdin.end();
  });
}

module.exports = { git, gitAsync };
