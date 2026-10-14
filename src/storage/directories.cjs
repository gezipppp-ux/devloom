const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { absolutePath } = require("../shared/paths.cjs");

async function directoryRoots() {
  if (process.platform === "darwin")
    return [
      { name: "/", path: "/" },
      { name: os.homedir(), path: os.homedir() },
      { name: "/Volumes", path: "/Volumes" },
      { name: "/usr/local", path: "/usr/local" },
    ];
  if (process.platform !== "win32") return [{ name: "/", path: "/" }];
  const roots = await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const drive = `${String.fromCharCode(65 + index)}:\\`;
      try {
        if ((await fs.stat(drive)).isDirectory())
          return { name: drive, path: drive };
      } catch {
        /* Unavailable drives are omitted. */
      }
      return null;
    }),
  );
  return roots.filter(Boolean);
}

function pageNumber(value, fallback, max) {
  if (value === undefined || value === null) return fallback;
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  )
    throw new Error("目录分页参数无效。");
  return Number(value);
}

async function listDirectories(input, defaultDirectory) {
  const offset = pageNumber(input.offset, 0, Number.MAX_SAFE_INTEGER);
  const limit = pageNumber(input.limit, 100, 200);
  if (!limit) throw new Error("目录分页大小必须大于 0。");
  let selected = input.path;
  if (selected === undefined || selected === null || selected === "") {
    try {
      selected = (await fs.stat(defaultDirectory)).isDirectory()
        ? defaultDirectory
        : os.homedir();
    } catch {
      selected = os.homedir();
    }
  }
  if (typeof selected !== "string" || /[\x00-\x1f\x7f]/.test(selected))
    throw new Error("请选择有效的服务端目录。");
  selected = absolutePath(selected, "浏览目录");
  try {
    const canonical = await fs.realpath(selected);
    const entries = await fs.readdir(canonical, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    const parent = path.dirname(canonical);
    const roots = await directoryRoots();
    const currentRoot = path.parse(canonical).root;
    if (
      !roots.some(
        (root) => root.path.toLowerCase() === currentRoot.toLowerCase(),
      )
    )
      roots.push({ name: currentRoot, path: currentRoot });
    return {
      path: canonical,
      parentPath: parent === canonical ? null : parent,
      roots,
      directories: directories.slice(offset, offset + limit).map((entry) => ({
        name: entry.name,
        path: path.join(canonical, entry.name),
      })),
      offset,
      hasMore: offset + limit < directories.length,
    };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      throw new Error("目录不存在，请输入已有的服务端目录。");
    if (error.code === "EACCES" || error.code === "EPERM")
      throw new Error("无法读取此目录，请选择服务端有读取权限的目录。");
    throw error;
  }
}

module.exports = { listDirectories };
