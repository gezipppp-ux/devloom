const { argument } = require('../arguments.cjs');

function selectionArguments(argv = process.argv.slice(2)) {
  return {
    id: argument('--id', null, argv),
    workspace: argument('--workspace', null, argv),
    type: argument('--type', null, argv),
    query: argument('--query', null, argv),
    status: argument('--status', null, argv),
  };
}

module.exports = { selectionArguments };
