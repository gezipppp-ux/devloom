const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function writableDirectory(directory) {
  // An uncreated member root is valid if its nearest existing parent is writable.
  let target = directory;
  while (!fs.existsSync(target) && path.dirname(target) !== target) target = path.dirname(target);
  const probe = path.join(target, `.environment-probe-${randomUUID()}`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

module.exports = { writableDirectory };
