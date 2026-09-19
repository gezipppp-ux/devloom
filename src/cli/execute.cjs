const { prepareCliDatabase } = require('./database-context.cjs');

function execute(main, errorPrefix = '', options = {}) {
  let database;
  return Promise.resolve()
    .then(async () => {
      if (options.database) database = await prepareCliDatabase();
      return main();
    })
    .then((code) => {
      if (Number.isInteger(code)) process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${errorPrefix}${error.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => database?.close());
}

module.exports = { execute };
