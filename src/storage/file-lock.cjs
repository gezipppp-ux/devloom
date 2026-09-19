const fs = require("node:fs");
const path = require("node:path");

const pause = new Int32Array(new SharedArrayBuffer(4));

// Synchronous read-modify-write sections only: never hold this lock across I/O
// that awaits another process. Abandoned locks deliberately fail closed.
function withFileLock(file, operation, label = "JSON configuration") {
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
        throw new Error(
          `${label} is locked: ${lock}. Check that all writers have stopped before removing an abandoned lock.`,
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

module.exports = { withFileLock };
