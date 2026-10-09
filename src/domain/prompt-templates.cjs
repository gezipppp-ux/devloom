const promptTemplateCatalog = require("../../shared/prompt-templates.json");

const MAX_PROMPT_TEMPLATE_LENGTH = 20000;
const PLACEHOLDER = /\{\{([\s\S]*?)\}\}/g;

function validatePromptTemplate(channel, template) {
  if (!Object.hasOwn(promptTemplateCatalog, channel))
    throw new Error("不支持的提示词渠道。");
  const definition = promptTemplateCatalog[channel];
  if (
    typeof template !== "string" ||
    !template.trim() ||
    template.length > MAX_PROMPT_TEMPLATE_LENGTH
  )
    throw new Error(`${definition.label}提示词必须是非空文本，最多 20000 字。`);
  const placeholders = new Set(
    definition.placeholders.map(({ name }) => name),
  );
  const present = new Set();
  const remainder = template.replace(PLACEHOLDER, (_, name) => {
    if (!placeholders.has(name))
      throw new Error(`${definition.label}提示词包含未知占位符：{{${name}}}。`);
    present.add(name);
    return "";
  });
  if (remainder.includes("{{") || remainder.includes("}}"))
    throw new Error(`${definition.label}提示词包含未闭合或格式错误的占位符。`);
  const missing = definition.placeholders.filter(
    ({ name, required }) => required && !present.has(name),
  );
  if (missing.length)
    throw new Error(
      `${definition.label}提示词缺少必填占位符：${missing.map(({ name }) => `{{${name}}}`).join("、")}。`,
    );
  return template;
}

function getPromptTemplates(config = {}) {
  const overrides = Object.hasOwn(config, "prompt_templates")
    ? config.prompt_templates
    : {};
  if (
    !overrides ||
    typeof overrides !== "object" ||
    Array.isArray(overrides) ||
    Object.keys(overrides).some(
      (channel) => !Object.hasOwn(promptTemplateCatalog, channel),
    )
  )
    throw new Error("提示词配置仅支持手动需求、TAPD 需求和 TAPD 需求融合模板。");
  return Object.fromEntries(
    Object.entries(promptTemplateCatalog).map(([channel, definition]) => [
      channel,
      validatePromptTemplate(
        channel,
        Object.hasOwn(overrides, channel)
          ? overrides[channel]
          : definition.defaultTemplate,
      ),
    ]),
  );
}

function renderPromptTemplate(channel, template, values) {
  validatePromptTemplate(channel, template);
  // A replacement callback preserves literal $ sequences and never re-parses
  // user content or evaluates expressions embedded in a requirement.
  return template.replace(PLACEHOLDER, (_, name) => {
    if (!Object.hasOwn(values, name))
      throw new Error(`提示词占位符缺少填充值：{{${name}}}。`);
    return String(values[name] ?? "");
  });
}

module.exports = {
  promptTemplateCatalog,
  MAX_PROMPT_TEMPLATE_LENGTH,
  validatePromptTemplate,
  getPromptTemplates,
  renderPromptTemplate,
};
