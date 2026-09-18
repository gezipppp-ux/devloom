function validateWorktreeName(value) {
  if (typeof value !== 'string')
    throw new Error('Worktree 目录前缀必须是字符串。');
  const name = value.trim();
  if (!name) return undefined;
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)
  )
    throw new Error(
      'Worktree 目录前缀限 1–16 位英文字母、数字、短横线或下划线，以字母或数字开头，不能使用系统保留名称或路径；系统会自动追加任务短标识。',
    );
  return name;
}
module.exports = { validateWorktreeName };
