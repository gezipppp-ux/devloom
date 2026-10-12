const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { dataRoot } = require("../config/runtime.cjs");
const {
  initializeAccountServices,
} = require("../application/account-services.cjs");

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
      output.write("管理员密码（至少 6 字符，输入不回显）：");
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
  { input = process.stdin, output = process.stdout, directory = dataRoot, databaseUrl } = {},
) {
  if (argv.length) throw new Error("init:admin 不接受命令行参数。");
  const password = await readPassword(input, output);
  const accounts = await initializeAccountServices(directory, { url: databaseUrl });
  try {
    const user = await accounts.create({ username: "admin", password }, null, true);
    (await accounts.audit(null, "account.local.init", null, {
      actorType: "local_operator",
      targetUserId: user.id,
    }));
    output.write(`管理员 ${user.username} 已创建。\n`);
  } finally {
    await accounts.close();
    (await accounts.closeDatabase());
  }
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

module.exports = { main };
