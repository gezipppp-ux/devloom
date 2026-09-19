const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { dataRoot } = require("../config/runtime.cjs");
const {
  initializeAccountServices,
} = require("../application/account-services.cjs");
const { argument } = require("./arguments.cjs");
const { execute } = require("./execute.cjs");

async function readPassword(input, output) {
  let values;
  if (input.isTTY) {
    const silent = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const prompt = readline.createInterface({
      input,
      output: silent,
      terminal: true,
    });
    try {
      output.write("新密码（至少 12 字符，输入不回显）：");
      const first = await prompt.question("");
      output.write("\n再次输入密码：");
      const second = await prompt.question("");
      output.write("\n");
      values = [first, second];
    } finally {
      prompt.close();
    }
  } else {
    let text = "";
    input.setEncoding("utf8");
    for await (const chunk of input) {
      text += chunk;
      if (text.length > 2048) throw new Error("密码输入过长。");
    }
    values = text.replace(/\r/g, "").split("\n");
    if (
      values.length > 3 ||
      values.length < 2 ||
      (values.length === 3 && values[2] !== "")
    )
      throw new Error("标准输入需提供两行相同密码。");
  }
  if (values[0] !== values[1]) throw new Error("两次密码不一致。");
  return values[0];
}

async function main(
  argv = process.argv.slice(2),
  { input = process.stdin, output = process.stdout, directory = dataRoot } = {},
) {
  const action = argv[0];
  if (
    !["init", "reset"].includes(action) ||
    argv.length !== 3 ||
    argv[1] !== "--username"
  )
    throw new Error(
      "用法：accounts init|reset --username <账号>；密码通过交互或两行标准输入提供。",
    );
  const username = argument("--username", null, argv);
  if (!username) throw new Error("请提供 --username。");
  const password = await readPassword(input, output);
  const accounts = await initializeAccountServices(directory);
  try {
    const user =
      action === "init"
        ? await accounts.create({ username, password }, null, true)
        : await accounts.resetLocal(username, password);
    accounts.audit(null, `account.local.${action}`, null, {
      actorType: "local_operator",
      targetUserId: user.id,
    });
    output.write(
      action === "init"
        ? `管理员 ${user.username} 已创建。\n`
        : `账号 ${user.username} 的密码已重置，旧会话已撤销。\n`,
    );
  } finally {
    await accounts.close();
    accounts.closeDatabase();
  }
}

if (require.main === module) execute(main);
module.exports = { main };
