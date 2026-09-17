const path = require("node:path");

function absolutePath(value, label, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    !api.isAbsolute(value) ||
    (platform !== "win32" && (/^[A-Za-z]:/.test(value) || value.includes("\\")))
  )
    throw new Error(`${label}必须是服务端的绝对路径。`);
  return api.normalize(value.trim());
}

function samePath(a, b, platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? api.resolve(a).toLowerCase() === api.resolve(b).toLowerCase()
    : api.resolve(a) === api.resolve(b);
}

module.exports = { absolutePath, samePath };
