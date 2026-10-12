const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { setImmediate } = require("node:timers/promises");
const { test } = require("node:test");
const { runClone } = require("../../src/git/clone-process.cjs");
const { temporary } = require("../support/helpers.cjs");

test("Git clone rejects failed asynchronous progress persistence before reporting success", async (t) => {
  const root = temporary(t);
  const repository = path.join(root, "repository");
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { windowsHide: true, stdio: "ignore" });
  git("init", "-b", "main");
  fs.writeFileSync(path.join(repository, "fixture.txt"), "fixture content\n".repeat(4096));
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
  let writes = 0;
  await assert.rejects(runClone(["clone", "--no-local", "--progress", repository, path.join(root, "clone")], process.env, {
    async onProgress() {
      writes++;
      await setImmediate();
      throw new Error("fixture asynchronous storage failure");
    },
  }), /无法记录克隆进度/);
  assert.ok(writes > 0);
});
