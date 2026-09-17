const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const dataRoot = process.env.RUNNER_DATA_DIR
  ? path.resolve(process.env.RUNNER_DATA_DIR)
  : root;

function runsPath(config, file) {
  return config.workspace
    ? path.join(path.dirname(file), "runs")
    : path.join(dataRoot, "runs");
}

function inputPath(value, env = process.env) {
  return path.resolve(env.INIT_CWD || process.cwd(), value);
}

function loadConfig(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new Error("An absolute configuration file path is required.");
  if (!fs.existsSync(file)) throw new Error(`Missing configuration: ${file}.`);
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

module.exports = {
  runsPath,
  inputPath,
  loadConfig,
  root,
  dataRoot,
};
