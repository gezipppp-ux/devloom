const test = require("node:test");
const assert = require("node:assert/strict");
const { releaseName, releaseTargetDate } = require("../../src/domain/project-releases.cjs");
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

test("release target dates accept actual calendar dates and explicit clearing", () => {
  for (const value of ["2024-02-29", "2026-10-23", "0001-01-01", "9999-12-31"])
    assert.equal(releaseTargetDate(value).toISOString().slice(0, 10), value);
  for (const value of [null, ""]) assert.equal(releaseTargetDate(value), null);
  for (const value of [undefined, 1, {}, "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "0000-01-01", "2026-1-01", " 2026-10-23", "2026-10-23T00:00:00Z"])
    assert.throws(() => releaseTargetDate(value), { statusCode: 400 });
});

test("invalid target dates fail before authorization or storage", async () => {
  const services = new ProjectLifecycleServices({}, { authorize() { assert.fail("invalid target date must not reach storage"); } });
  for (const id of [null, "release-id"])
    await assert.rejects(services.saveRelease("project-id", id, { id: "actor" }, { name: "v1.0", targetDate: "2026-02-29", ...(id ? { revision: 1 } : {}) }), { statusCode: 400 });
});
