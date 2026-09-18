const { execFileSync } = require("node:child_process");

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
  }).replace(/\r?\n$/, "");
}

module.exports = { git };
