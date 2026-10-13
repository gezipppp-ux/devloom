const { initializeAccountServices } = require("../application/account-services.cjs");
const { SetupServices } = require("../application/setup-services.cjs");
const { dataRoot } = require("../config/runtime.cjs");

async function printSetupLink(application, origin, output = process.stdout) {
  const credential = await application.initializationToken();
  if (credential) output.write(`首次初始化：${origin}/setup#token=${credential.token}\n此链接 30 分钟内有效，仅用于创建第一个管理员，请妥善保管。\n`);
}
async function main(argv = process.argv.slice(2)) {
  if (argv.length) throw new Error("setup:link 不接受命令行参数。");
  const accounts = await initializeAccountServices(dataRoot);
  try {
    const credential = await new SetupServices(accounts.database).issueToken();
    if (!credential) throw new Error("管理员已经创建，请直接登录继续初始化。");
    process.stdout.write(`初始化凭证：${credential.token}\n30 分钟内有效，请打开服务的 /setup 页面粘贴此凭证。\n`);
  } finally { await accounts.close(); await accounts.closeDatabase(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main, printSetupLink };
