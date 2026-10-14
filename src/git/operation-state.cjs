const fs = require("node:fs");
const path = require("node:path");
const { git } = require("./command.cjs");
const { samePath } = require("../shared/paths.cjs");

function sameWorktreePath(left, right) {
  if (samePath(left, right)) return true;
  try {
    // Git reports physical paths (e.g. /private/var on macOS), while saved
    // sessions can retain an OS alias. Resolve only for comparison.
    return samePath(fs.realpathSync.native(left), fs.realpathSync.native(right));
  } catch {
    // Missing/prunable registrations must not mask another valid worktree.
    return false;
  }
}

function operationReason(repository) {
  const directory = git(repository, [
    "rev-parse", "--path-format=absolute", "--git-dir",
  ]);
  const markers = [
    "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_START",
    "rebase-merge", "rebase-apply", "sequencer", "index.lock", "HEAD.lock",
  ];
  if (markers.some((name) => fs.existsSync(path.join(directory, name))))
    return "Git 正在合并、变基或执行其他操作，请先交由 Codex 或在本地处理。";
  return null;
}

function registeredWorktrees(repository) {
  return git(repository, ["worktree", "list", "--porcelain", "-z"])
    .split("\0\0")
    .filter(Boolean)
    .map((entry) => {
      const lines = entry.split("\0");
      return {
        path: lines.find((line) => line.startsWith("worktree "))?.slice(9),
        branch: lines.find((line) => line.startsWith("branch "))?.slice(7),
        locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
        prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
      };
    });
}

module.exports = { operationReason, registeredWorktrees, sameWorktreePath };
