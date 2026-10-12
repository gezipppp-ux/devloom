const path = require("node:path");
const { execFileSync } = require("node:child_process");

function attachOrigin(repository) {
  const remote = path.join(path.dirname(repository), `${path.basename(repository)}-origin.git`);
  const options = { windowsHide: true, stdio: "pipe" };
  execFileSync("git", ["clone", "--bare", repository, remote], options);
  execFileSync("git", ["-C", repository, "remote", "add", "origin", remote], options);
  return remote;
}
module.exports = { attachOrigin };
