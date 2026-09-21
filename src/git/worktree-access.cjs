const fs = require("node:fs");
const path = require("node:path");
const { git: gitCommand } = require("./command.cjs");
const { registeredWorktrees } = require("./operation-state.cjs");
const { repositoryCommonDirectory } = require("./repository.cjs");
const { samePath } = require("../shared/paths.cjs");

function worktreeReason(state) {
  const tree = state.worktree;
  if (!tree?.path || !tree.repository) return "尚未创建工作区";
  try {
    const git = (cwd, args) =>
      gitCommand(cwd, args, { timeout: 10000 });
    const match = registeredWorktrees(tree.repository)
      .find((entry) => entry.path && samePath(entry.path, tree.path));
    if (!match || !fs.existsSync(path.join(tree.path, ".git")))
      return "工作区已移除，此任务仅供查看";
    const expectedCommon = repositoryCommonDirectory(tree.repository);
    const common = repositoryCommonDirectory(tree.path);
    const [gitDirectory, topLevel] = [
      "--git-dir", "--show-toplevel",
    ].map((field) => git(tree.path, [
      "rev-parse", "--path-format=absolute", field,
    ]));
    const registeredMarker = fs
      .readFileSync(path.join(gitDirectory, "gitdir"), "utf8")
      .replace(/\r?\n$/, "");
    if (
      !samePath(fs.realpathSync.native(common), fs.realpathSync.native(expectedCommon)) ||
      !samePath(fs.realpathSync.native(topLevel), fs.realpathSync.native(tree.path)) ||
      !samePath(
        fs.realpathSync.native(path.resolve(gitDirectory, registeredMarker)),
        fs.realpathSync.native(path.join(tree.path, ".git")),
      )
    )
      return "工作区已不属于原仓库，此任务仅供查看";
    return null;
  } catch {
    return "无法验证原工作区，请检查仓库路径";
  }
}

module.exports = { worktreeReason };
