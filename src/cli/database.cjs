const { dataRoot, inputPath } = require("../config/runtime.cjs");
const { initializeDatabase, databaseStatus } = require("../storage/database-lifecycle.cjs");
const { argument } = require("./arguments.cjs");
const { execute } = require("./execute.cjs");

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "status";
  if (!["status", "migrate", "seed"].includes(command))
    throw new Error("用法：database.cjs status|migrate|seed [--data-dir <目录>]");
  const selected = argument("--data-dir", null, argv);
  const directory = selected ? inputPath(selected) : dataRoot;
  if (command === "status") {
    process.stdout.write(JSON.stringify(await databaseStatus(directory), null, 2) + "\n");
    return;
  }
  const database = await initializeDatabase(directory);
  try {
    process.stdout.write(command === "seed" ? "生产默认数据已补齐，现有设置已保留。\n" : "数据库已升级到最新版本。\n");
  } finally { database.close(); }
}

if (require.main === module) execute(main);
module.exports = { main };
