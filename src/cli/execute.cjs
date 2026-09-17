function execute(main, errorPrefix = '') {
  return Promise.resolve()
    .then(() => main())
    .then((code) => {
      if (Number.isInteger(code)) process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${errorPrefix}${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { execute };
