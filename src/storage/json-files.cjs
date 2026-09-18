const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const pause = new Int32Array(new SharedArrayBuffer(4));

function readOptional(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function writeConfig(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Serialize read-modify-write across service processes without holding a lock
// during network or Git operations. A crashed writer's lock fails closed.
function updateConfig(file, update) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(`JSON configuration is locked: ${lock}. Check that all writers have stopped before removing an abandoned lock.`);
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  try {
    const value = update(readOptional(file));
    writeConfig(file, value);
    return value;
  } finally {
    fs.rmdirSync(lock);
  }
}

module.exports = { readOptional, writeConfig, updateConfig };
