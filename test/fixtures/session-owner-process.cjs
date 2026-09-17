const fs = require("node:fs");
const path = require("node:path");
const { RunStore } = require("../../src/storage/run-store.cjs");

const [directory, role, mode] = process.argv.slice(2);
const store = new RunStore(directory);
const file = path.join(store.dir("1-2"), "web-owner.json");
const marker = (name) => path.join(directory, name);
const signal = (name) => fs.writeFileSync(marker(name), "");
const waitFor = (...names) => {
  const until = Date.now() + 5000;
  while (!names.some((name) => fs.existsSync(marker(name)))) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${names}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
};

if (mode === "stale") {
  const read = fs.readFileSync;
  let observed = false;
  fs.readFileSync = function (target, ...args) {
    const data = read.call(this, target, ...args);
    if (target === file && !observed) {
      observed = true;
      if (role === "first") {
        process.send({ stage: "paused" });
        waitFor("second-read", "second-finished");
      } else {
        signal("second-read");
        waitFor("first-finished");
      }
    }
    return data;
  };
} else if (role === "first") {
  const unlink = fs.unlinkSync;
  fs.unlinkSync = function (target) {
    const result = unlink.call(this, target);
    if (target === file) {
      process.send({ stage: "paused" });
      waitFor("second-finished");
    }
    return result;
  };
}

try {
  store.claim("1-2");
  process.send({ claimed: true, pid: process.pid });
} catch (error) {
  process.send({ claimed: false, error: error.message, pid: process.pid });
} finally {
  signal(`${role}-finished`);
}
// The winning process must remain alive until the other claimant has finished.
process.on("message", () => process.exit(0));
