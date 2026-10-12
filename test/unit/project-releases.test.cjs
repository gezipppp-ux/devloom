const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseName } = require("../../src/domain/project-releases.cjs");
const { ProjectLifecycleServices } = require("../../src/application/project-lifecycle-services.cjs");

test("release names require a lowercase v and two or three canonical numeric segments", () => {
  for (const name of ["v0.5.9", "v0.1", "v1.0", "v0.0.0", "v12.34.567", `v${"1".repeat(97)}.0`])
    assert.equal(releaseName(name), name);
  for (const name of [undefined, null, 1, {}, ["v1.0"], "", "版本一", "1.0", "V1.0", "v1", "v1.0.0.0", "v01.0", "v1.01", "v1.0.01", "v-1.0", "v1..0", "v1.0-beta", "v1.0.0+build", " v1.0", "v1.0 ", "v1. 0", "v1.0\n", "v1.0\r\n", "v１.０", `v${"1".repeat(98)}.0`])
    assert.throws(() => releaseName(name), { statusCode: 400 }, JSON.stringify(name));
});

test("release service rejects invalid create and update requests before storage", async () => {
  const services = new ProjectLifecycleServices({}, { authorize() { assert.fail("invalid input must not reach the transaction"); } });
  for (const id of [null, "release-id"]) {
    for (const name of [undefined, "随意名称", "V1.0", "v1.0-beta", "v1.0.0.0"]) {
      await assert.rejects(services.saveRelease("project-id", id, { id: "actor" }, { name, ...(id ? { revision: 1 } : {}) }), { statusCode: 400 });
    }
  }
});
