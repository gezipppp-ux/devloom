const fs = require("node:fs");
const path = require("node:path");

// Development fixtures must never overlay an existing data directory.
async function withFixtureDirectory(directory, operation) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(directory).length)
      throw new Error("开发种子只允许写入全新空目录，不能修改现有数据。");
  } else fs.mkdirSync(directory, { recursive: true });
  const marker = path.join(directory, ".seed-fixtures.lock");
  fs.writeFileSync(marker, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    return await operation();
  } finally {
    fs.unlinkSync(marker);
  }
}

module.exports = { withFixtureDirectory };
