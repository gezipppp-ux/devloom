const MAX_SESSION_TITLE_LENGTH = 200;

function validateSessionTitle(input) {
  if (typeof input !== "string")
    throw new Error("会话标题必须是文本。");
  const title = input.trim();
  if (!title) throw new Error("请输入会话标题。");
  if (title.length > MAX_SESSION_TITLE_LENGTH)
    throw new Error(`会话标题不能超过 ${MAX_SESSION_TITLE_LENGTH} 个字符。`);
  return title;
}

module.exports = { MAX_SESSION_TITLE_LENGTH, validateSessionTitle };
