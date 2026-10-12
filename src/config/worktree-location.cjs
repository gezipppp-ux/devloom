const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { samePath } = require("../shared/paths.cjs");

function defaultWorktreeRoot() {
  return path.join(os.homedir(), ".web-coding-workspaces");
}

function inside(base, target) {
  const relative = path.relative(base, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function existingLocation(directory) {
  try {
    fs.lstatSync(directory);
    return fs.realpathSync.native(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A dangling symlink is not a missing directory that we may create through.
    try {
      if (fs.lstatSync(directory).isSymbolicLink())
        throw new Error("Worktree 目录包含无法访问的符号链接。");
    } catch (linkError) {
      if (linkError.code !== "ENOENT") throw linkError;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(existingLocation(parent), path.basename(directory));
  }
}

function assertWorktreeLocation(base, target) {
  const root = path.resolve(base);
  const destination = path.resolve(target);
  if (samePath(root, destination) || !inside(root, destination))
    throw new Error("工作区 Worktree 目录必须位于系统基础目录内。");
  const realRoot = existingLocation(root);
  let current = root;
  for (const segment of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, segment);
    const realCurrent = existingLocation(current);
    if (!inside(realRoot, realCurrent) || samePath(realRoot, realCurrent))
      throw new Error("Worktree 目录的符号链接超出了系统基础目录，请选择基础目录内的目录。");
  }
}

function assertMemberWorktreeLocation(base, memberRoot, target) {
  assertWorktreeLocation(base, memberRoot);
  try {
    if (fs.lstatSync(memberRoot).isSymbolicLink())
      throw new Error("成员 Worktree 目录不能是符号链接，请选择独立目录。");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assertWorktreeLocation(memberRoot, target);
}

module.exports = { assertWorktreeLocation, assertMemberWorktreeLocation, defaultWorktreeRoot };
