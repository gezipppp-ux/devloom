const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { findExecutable, npmCommand, runTool } = require("../../src/shared/tool-process.cjs");

function filesystem(files) {
  const entry = file => {
    if (!Object.hasOwn(files, file)) throw new Error("ENOENT");
    return files[file];
  };
  return {
    statSync: file => ({ isFile: () => !entry(file).directory }),
    realpathSync: file => entry(file).target || file,
    accessSync(file, mode) {
      const item = entry(file);
      if (mode === fs.constants.X_OK && item.executable === false || mode === fs.constants.R_OK && item.readable === false)
        throw new Error("EACCES");
    },
    lstatSync: file => ({ isSymbolicLink: () => Boolean(entry(file).alias) }),
  };
}

for (const [name, prefix] of [
  ["Apple Silicon Homebrew", "/opt/homebrew/Cellar/node@22/22.13.0"],
  ["Intel Homebrew", "/usr/local/Cellar/node@22/22.13.0"],
  ["nvm with spaces", "/Users/Runner Name/.nvm/versions/node/v22.13.0"],
]) {
  test(`${name} npm resolves beside Node when launchd omits its directory`, () => {
    const script = `${prefix}/lib/node_modules/npm/bin/npm-cli.js`;
    const options = { platform: "darwin", env: { PATH: "/usr/bin:/bin" }, node: `${prefix}/bin/node`,
      fs: filesystem({ [`${prefix}/bin/npm`]: { target: script }, [script]: {} }) };
    assert.deepEqual(npmCommand(options), { command: options.node, args: [script], script });
    // The package remains usable even if its bin symlink is missing.
    assert.deepEqual(npmCommand({ ...options, fs: filesystem({ [script]: {} }) }), { command: options.node, args: [script], script });
  });
}

test("npm preserves a selected PATH installation and refuses unknown launchers", () => {
  const script = "/custom/lib/node_modules/npm/bin/npm-cli.js";
  const options = { platform: "darwin", node: "/opt/node/bin/node", env: { PATH: "/custom/bin" },
    fs: filesystem({ "/custom/bin/npm": { target: script }, [script]: {}, "/opt/node/bin/npm": {} }) };
  assert.deepEqual(npmCommand(options), { command: options.node, args: [script], script });
  assert.throws(() => npmCommand({ ...options, fs: filesystem({ "/custom/bin/npm": {} }) }), /未识别/);
});

test("missing, unreadable and directory npm entries fail before launching", () => {
  const script = "/opt/node/lib/node_modules/npm/bin/npm-cli.js";
  const options = { platform: "darwin", node: "/opt/node/bin/node", env: {} };
  for (const files of [{}, { [script]: { readable: false } }, { [script]: { directory: true } }])
    assert.throws(() => npmCommand({ ...options, fs: filesystem(files) }), { code: "TOOL_NOT_FOUND" });
});

test("Windows npm shims and nvm proxy layouts keep using the active Node without a shell", () => {
  const script = "C:\\node\\node_modules\\npm\\bin\\npm-cli.js";
  const options = { platform: "win32", node: "C:\\node\\node.exe", env: { Path: '"C:\\node"' },
    fs: filesystem({ "C:\\node\\npm.cmd": {}, [script]: {} }) };
  assert.deepEqual(npmCommand(options), { command: options.node, args: [script], script });
  assert.deepEqual(npmCommand({ ...options, env: {}, fs: filesystem({ [script]: {} }) }), { command: options.node, args: [script], script });
});

test("POSIX executable search respects PATH case, spaces and executable permissions", () => {
  const options = { platform: "darwin", env: { Path: "/ignored", PATH: ':relative:/bad:/tools bin ' },
    fs: filesystem({ "/ignored/git": {}, "/bad/git": { executable: false }, "/tools bin /git": {} }) };
  assert.equal(findExecutable("git", options), "/tools bin /git");
  assert.equal(findExecutable("git", { ...options, env: { Path: "/ignored" } }), null);
});

test("Windows winget app execution aliases are not dereferenced", () => {
  const command = "C:\\Local\\Microsoft\\WindowsApps\\winget.exe";
  assert.equal(findExecutable("winget.exe", { platform: "win32",
    env: { Path: "C:\\Local\\Microsoft\\WindowsApps", LOCALAPPDATA: "C:\\Local" },
    fs: filesystem({ [command]: { alias: true } }),
  }), command);
});

test("installed npm actually runs with an empty service PATH", async () => {
  const env = { ...process.env, PATH: "" };
  for (const key of Object.keys(env)) if (key !== "PATH" && key.toUpperCase() === "PATH") delete env[key];
  const launch = npmCommand({ env });
  assert.equal(launch.command, process.execPath);
  assert.match(await runTool(launch.command, [...launch.args, "--version"], { env }), /^\d+\.\d+\.\d+$/);
});
