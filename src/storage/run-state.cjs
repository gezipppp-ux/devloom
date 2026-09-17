const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const pause = new Int32Array(new SharedArrayBuffer(4));

function withStateLock(file, operation) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Run state is locked: ${lock}. Check that no service is writing before removing an abandoned lock.`,
        );
      Atomics.wait(pause, 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    fs.rmdirSync(lock);
  }
}

function writeState(file, state) {
  state.updated_at = new Date().toISOString();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return state;
}

function saveState(file, state) {
  return withStateLock(file, () => writeState(file, state));
}

function updateState(file, patch) {
  return withStateLock(file, () => {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    return writeState(file, { ...current, ...patch });
  });
}

module.exports = { saveState, updateState };
