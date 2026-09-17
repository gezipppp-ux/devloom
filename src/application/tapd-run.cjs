const fs = require('node:fs');
const path = require('node:path');
const { runExecution } = require('../execution/runner.cjs');
const { createTapdChannel } = require('../channels/tapd/adapter.cjs');

function runRequirement(input, dependencies = {}) {
  return runExecution(
    { ...input, channel: createTapdChannel(input.configFile, dependencies) },
    dependencies,
  );
}

function readRunStatus(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
}

module.exports = { runRequirement, readRunStatus };
