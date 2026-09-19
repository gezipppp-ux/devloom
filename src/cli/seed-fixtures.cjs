const { inputPath } = require("../config/runtime.cjs");
const { seedDevelopmentFixtures } = require("../application/development-fixtures.cjs");
const { argument } = require("./arguments.cjs");
const { execute } = require("./execute.cjs");

async function main(argv = process.argv.slice(2), output = process.stdout) {
  const selected = argument("--data-dir", null, argv);
  if (!selected) throw new Error("开发种子必须显式指定 --data-dir <全新空目录>。");
  const result = await seedDevelopmentFixtures(inputPath(selected));
  output.write(JSON.stringify(result, null, 2) + "\n");
}

if (require.main === module) execute(main);
module.exports = { main };
