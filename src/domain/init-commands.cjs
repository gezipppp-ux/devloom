function validateInitCommands(value = []) {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (command) =>
        typeof command !== 'string' ||
        !command.trim() ||
        command.length > 4000 ||
        /[\r\n\0]/.test(command),
    )
  )
    throw new Error('初始化命令最多 20 条，每条为 1–4000 字符且不能包含换行。');
  return value.map((command) => command.trim());
}

module.exports = { validateInitCommands };
