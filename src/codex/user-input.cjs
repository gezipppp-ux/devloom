const USER_INPUT_METHOD = 'item/tool/requestUserInput';

function isBlockingRequest(request) {
  return request.method !== USER_INPUT_METHOD || request.params?.isBlocking !== false;
}

function validateUserInput(params) {
  const questions = params?.questions;
  const invalid = () => new Error('Codex 问题格式无效，无法提交回答。');
  if (!Array.isArray(questions) || !questions.length) throw invalid();
  const ids = new Set();
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || !question.id.trim() ||
      ids.has(question.id) || typeof question.question !== 'string' || !question.question.trim())
      throw invalid();
    ids.add(question.id);
    if (question.options == null) continue;
    if (!Array.isArray(question.options) || question.options.some((option) =>
      !option || typeof option.label !== 'string' || !option.label.trim() ||
      typeof option.description !== 'string')) throw invalid();
  }
}

function userInputResponse(params, response) {
  validateUserInput(params);
  if (!response?.answers || typeof response.answers !== 'object' || Array.isArray(response.answers))
    throw new Error('请回答每个问题。');
  const answers = Object.fromEntries(params.questions.map((question) => {
    const answer = Object.hasOwn(response.answers, question.id)
      ? response.answers[question.id] : undefined;
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 20000)
      throw new Error('请回答每个问题（每题最多 20000 个字符）。');
    return [question.id, { answers: [answer.trim()] }];
  }));
  return { answers };
}

module.exports = { USER_INPUT_METHOD, isBlockingRequest, validateUserInput, userInputResponse };
