const path = require("node:path");

// Git for Windows may still use traditional Win32 limits. Budget for both
// checkout files and their parent directories without changing Git settings.
function worktreePathIssue(root, entries, platform = process.platform) {
  if (platform !== "win32") return null;
  const normalizedRoot = path.win32.resolve(root);
  let issue = null;
  function inspect(relativePath, kind, limit) {
    const fullPath = path.win32.join(normalizedRoot, relativePath);
    if (fullPath.length <= limit) return;
    const candidate = {
      relativePath: relativePath || ".",
      kind,
      pathLength: fullPath.length,
      limit,
      maximumRootLength: normalizedRoot.length - (fullPath.length - limit),
    };
    if (!issue || candidate.maximumRootLength < issue.maximumRootLength)
      issue = candidate;
  }
  inspect("", "directory", 247);
  for (const { path: relativePath, kind } of entries) {
    inspect(relativePath, kind, kind === "directory" ? 247 : 259);
    const separator = relativePath.lastIndexOf("/");
    if (separator !== -1)
      inspect(relativePath.slice(0, separator), "directory", 247);
  }
  return issue;
}

module.exports = { worktreePathIssue };
