const assert = require("node:assert/strict");
const { test } = require("node:test");
const { portArgument } = require("../../src/cli/arguments.cjs");

test("startup port uses CLI, environment, then the mode's default", () => {
  for (const defaultPort of [4317, 5173]) {
    const resolve = (argv, env) => portArgument(argv, { defaultPort, env });
    for (const PORT of [undefined, "", "   "])
      assert.equal(resolve([], { PORT }), defaultPort);
    assert.equal(resolve([], { PORT: " 8080 " }), 8080);
    assert.equal(resolve(["--port", "8081"], { PORT: "8080" }), 8081);
    assert.equal(resolve(["--port", "8081"], { PORT: "invalid" }), 8081);
    for (const PORT of ["invalid", "65536", "-1", "1.5", "1e3", "0x10"])
      assert.throws(() => resolve([], { PORT }), /端口需/);
    for (const value of ["invalid", "65536", "-1", "1.5", " "])
      assert.throws(() => resolve(["--port", value], { PORT: "8080" }), /端口需/);
    assert.throws(() => resolve(["--port"], { PORT: "8080" }), /requires a value/);
  }
});

test("automatic allocation remains available only in development", () => {
  for (const argv of [[], ["--port", "0"]]) {
    const options = { env: { PORT: "0" }, defaultPort: 5173 };
    assert.equal(portArgument(argv, { ...options, allowAuto: true }), 0);
    assert.throws(() => portArgument(argv, options), /端口需为 1–65535/);
  }
  for (const PORT of ["1", "65535"])
    assert.equal(portArgument([], { env: { PORT }, defaultPort: 4317 }), Number(PORT));
});
