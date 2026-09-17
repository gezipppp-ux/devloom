const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { samePath } = require("../shared/paths.cjs");

function worktreeReason(state) {
  const tree = state.worktree;
  if (!tree?.path || !tree.repository || !tree.branch) return "尚未创建工作区";
  try {
    const git = (cwd, args) =>
      execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    const entries = git(tree.repository, [
      "worktree",
      "list",
      "--porcelain",
      "-z",
    ]);
    const match = entries.split("\0\0").find((entry) => {
      const location = entry
        .split("\0")
        .find((line) => line.startsWith("worktree "))
        ?.slice(9);
      return location && samePath(location, tree.path);
    });
    if (
      !match ||
      !match.split("\0").includes(`branch refs/heads/${tree.branch}`) ||
      !fs.existsSync(path.join(tree.path, ".git"))
    )
      return "工作区或分支已移除，此任务仅供查看";
    const expectedCommon = git(tree.repository, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).trim();
    const [common, gitDirectory, topLevel] = git(tree.path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--git-dir",
      "--show-toplevel",
    ])
      .trim()
      .split(/\r?\n/);
    const branch = git(tree.path, ["symbolic-ref", "--quiet", "HEAD"]).trim();
    const registeredMarker = fs
      .readFileSync(path.join(gitDirectory, "gitdir"), "utf8")
      .trim();
    if (
      !samePath(fs.realpathSync(common), fs.realpathSync(expectedCommon)) ||
      !samePath(fs.realpathSync(topLevel), fs.realpathSync(tree.path)) ||
      branch !== `refs/heads/${tree.branch}` ||
      !samePath(
        fs.realpathSync(path.resolve(gitDirectory, registeredMarker)),
        fs.realpathSync(path.join(tree.path, ".git")),
      )
    )
      return "工作区已不属于原仓库或分支，此任务仅供查看";
    return null;
  } catch {
    return "无法验证原工作区，请检查仓库路径";
  }
}

module.exports = { worktreeReason };
