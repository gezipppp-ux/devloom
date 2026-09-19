const { runExecution } = require('../execution/runner.cjs');
const { createTapdChannel } = require('../channels/tapd/adapter.cjs');

function runRequirement(input, dependencies = {}) {
  return runExecution(
    { ...input, channel: createTapdChannel(input.configFile, dependencies) },
    dependencies,
  );
}

module.exports = { runRequirement };
