const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { zipSync } = require("fflate");

const digest = data => createHash("sha256").update(data).digest("hex");

class SkillPackageStore {
  constructor(directory) { this.directory = directory; }

  async read() {
    const files = [];
    const visit = async (directory, prefix = "") => {
      const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        const relative = prefix + entry.name;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9./-]*$/.test(relative) || entry.isSymbolicLink())
          throw new Error("技能包包含不支持的文件路径：" + relative);
        if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative + "/");
        else if (entry.isFile()) {
          const data = await fs.readFile(path.join(directory, entry.name));
          if (data.length > 2 * 1024 * 1024) throw new Error("技能文件超过大小限制。");
          files.push({ path: relative, data, size: data.length, sha256: digest(data) });
        } else throw new Error("技能包只能包含普通文件。");
      }
    };
    await visit(this.directory);
    if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024)
      throw new Error("技能包超过大小限制。");
    const entry = files.find(file => file.path === "SKILL.md")?.data.toString("utf8") || "";
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entry)?.[1] || "";
    const name = /^name: ([a-z0-9-]+)$/m.exec(header)?.[1];
    const version = /^  version: "((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))"$/m.exec(header)?.[1];
    if (name !== "web-coding-issue-authoring" || !version || !/^description: .+/m.test(header))
      throw new Error("技能入口的名称、版本或说明无效。");
    for (const file of files.filter(file => file.path.endsWith(".md"))) {
      for (const match of file.data.toString("utf8").matchAll(/\]\(([^\s)]+)\)/g)) {
        const href = match[1].split("#")[0];
        if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), href));
        if (!files.some(candidate => candidate.path === target)) throw new Error("技能引用文件不存在：" + target);
      }
    }
    // Fixed metadata makes the same released files produce identical ZIP bytes.
    const archive = Buffer.from(zipSync(Object.fromEntries(files.map(file => [name + "/" + file.path,
      [file.data, { mtime: new Date(2020, 0, 1), level: 6 }]]))));
    return { name, version, files, archive, sha256: digest(archive) };
  }
}

module.exports = { SkillPackageStore };
