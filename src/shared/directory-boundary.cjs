const fs = require("node:fs");
const path = require("node:path");

function assertDirectoryBoundary(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("项目或任务目录必须位于成员存储目录内。");
  let current = path.resolve(root);
  try {
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error("成员存储目录不能被替换为符号链接。");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error("成员目录及项目目录不能包含符号链接。");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
module.exports = { assertDirectoryBoundary };
