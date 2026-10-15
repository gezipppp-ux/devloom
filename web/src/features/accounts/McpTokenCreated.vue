<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { CheckOutlined, CopyOutlined, InfoCircleOutlined } from "@antdv-next/icons";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { copyText } from "../../shared/components/clipboard.js";
import { formatDate, formatNumber, translate } from "../../shared/i18n/index.js";
import { mcpSetupPrompt } from "./mcp-setup-prompt.js";

const props = defineProps({ token: { type: Object, required: true }, secret: { type: String, required: true }, origin: { type: String, required: true } });
defineEmits(["done"]);
const copyButton = ref(null), promptField = ref(null), expanded = ref(false), copying = ref(false), copiedPrompt = ref(""), error = ref("");
const prompt = computed(() => mcpSetupPrompt({ origin: props.origin, secret: props.secret, expiresAt: props.token.expiresAt }));
const copied = computed(() => copiedPrompt.value === prompt.value);
const expiresAt = computed(() => formatDate(props.token.expiresAt, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }));
const projects = computed(() => props.token.allProjects ? translate("全部可访问项目") : translate("{count} 个指定项目", { count: formatNumber(props.token.projectIds.length) }));
const steps = [
  { title: "复制配置内容", description: "已包含安装提示、完整 Token 和到期时间。" },
  { title: "发送给 Agent", description: "粘贴到你正在使用的 Agent 对话中。" },
  { title: "查看配置结果", description: "由 Agent 验证连接，并告知是否已设置到期提醒。" },
];
const contents = ["安装并自动更新 Skills", "自动配置 MCP 连接", "验证身份与可用权限", "检查有效期并提醒更新"];
let alive = true;
async function copyPrompt() {
  if (copying.value) return;
  const value = prompt.value;
  copying.value = true; error.value = "";
  try {
    await copyText(value);
    if (alive && prompt.value === value) copiedPrompt.value = value;
  } catch {
    if (alive && prompt.value === value) {
      error.value = "无法自动复制，请选中文本后手动复制。";
      expanded.value = true;
      await nextTick();
      if (alive && prompt.value === value) { promptField.value?.focus(); promptField.value?.select(); }
    }
  } finally { if (alive) copying.value = false; }
}
onMounted(() => copyButton.value?.focus());
onUnmounted(() => { alive = false; copiedPrompt.value = ""; });
</script>

<template>
  <div class="mcp-created">
    <div class="mcp-created-layout">
      <ol class="mcp-setup-steps" :aria-label="$t('Agent 配置步骤')">
        <li v-for="(step, index) in steps" :key="step.title" :class="{ current: index === (copied ? 1 : 0) }" :aria-current="index === (copied ? 1 : 0) ? 'step' : undefined">
          <span class="mcp-step-number" aria-hidden="true"><CheckOutlined v-if="index === 0 && copied" /><template v-else>{{ index + 1 }}</template></span>
          <div><h3>{{ $t(step.title) }}</h3><p>{{ $t(step.description) }}</p></div>
        </li>
      </ol>
      <section class="mcp-card mcp-setup-card" :aria-label="$t('Token 保存提示')">
        <header><p class="mcp-setup-eyebrow">{{ $t("准备连接 Agent") }}</p><h3>{{ token.name }}</h3><p class="field-hint">{{ $t("下面的凭证与安装说明会一起复制。") }}</p></header>
        <div class="mcp-setup-credential">
          <div class="mcp-row mcp-between"><span>{{ $t("个人 Token") }}</span><span class="field-hint">{{ $t("仅在本次显示") }}</span></div>
          <input :value="secret" :aria-label="$t('新建 Token')" readonly autocomplete="off" spellcheck="false" />
          <div class="mcp-setup-meta"><span>{{ projects }}</span><span>{{ $t("到期时间：{date}", { date: expiresAt }) }}</span></div>
        </div>
        <ul class="mcp-setup-contents" :aria-label="$t('复制内容包括')"><li v-for="item in contents" :key="item"><CheckOutlined aria-hidden="true" />{{ $t(item) }}</li></ul>
        <button ref="copyButton" type="button" class="primary mcp-copy-setup" :disabled="copying" @click="copyPrompt"><CheckOutlined v-if="copied" aria-hidden="true" /><CopyOutlined v-else aria-hidden="true" />{{ copying ? $t("正在复制…") : copied ? $t("已复制，粘贴给 Agent") : $t("复制全部，发送给 Agent") }}</button>
        <FeedbackMessage :message="error" type="error" />
        <details :open="expanded" @toggle="expanded = $event.target.open">
          <summary>{{ $t("查看完整配置提示词") }}</summary>
          <textarea ref="promptField" :value="prompt" :aria-label="$t('完整配置提示词')" readonly rows="12" autocomplete="off" spellcheck="false" />
        </details>
        <p class="mcp-setup-note"><InfoCircleOutlined aria-hidden="true" />{{ $t("完整 Token 仅在本次显示，请在离开前复制。") }}</p>
        <p class="field-hint">{{ $t("到期提醒由 Agent 配置；不支持定时提醒时，会在使用时提醒。") }}</p>
      </section>
    </div>
    <button type="button" class="text-button mcp-setup-done" @click="$emit('done')">{{ $t("已保存，返回列表") }}</button>
  </div>
</template>

<style scoped>
.mcp-created { min-width: 0; }
.mcp-created-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 40px; align-items: start; }
.mcp-setup-steps { list-style: none; margin: 0; padding: 0; }
.mcp-setup-steps li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 13px; padding-bottom: 34px; position: relative; }
.mcp-setup-steps li:not(:last-child)::after { content: ''; position: absolute; left: 15px; top: 38px; bottom: 6px; border-left: 1px solid var(--line); }
.mcp-step-number { width: 32px; height: 32px; border: 1px solid var(--line); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 12px; background: var(--surface); }
.current .mcp-step-number { background: var(--selected); color: var(--highlight); border-color: var(--selected-border, var(--line)); }
.mcp-setup-steps li h3 { font-size: 14px; margin: 3px 0 7px; }
.mcp-setup-steps p { color: var(--muted); font-size: 12px; margin: 0; line-height: 1.85; }
.mcp-setup-card { padding: 28px; }
.mcp-setup-card header h3 { font-size: 20px; margin: 0 0 8px; overflow-wrap: anywhere; }
.mcp-setup-eyebrow { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
.mcp-setup-credential { padding-top: 22px; margin-top: 26px; border-top: 1px solid var(--line); }
.mcp-setup-credential > .mcp-row { font-size: 13px; margin-bottom: 10px; }
.mcp-setup-credential input { width: 100%; min-width: 0; font: 12px/1.75 var(--font-code); background: var(--soft); border-color: transparent; }
.mcp-setup-meta { display: flex; justify-content: space-between; gap: 8px 20px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin-top: 14px; }
.mcp-setup-contents { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; list-style: none; margin: 22px 0; padding: 22px 0 0; border-top: 1px solid var(--line); }
.mcp-setup-contents li { display: flex; align-items: baseline; gap: 9px; font-size: 13px; }
.mcp-setup-contents .anticon { color: var(--muted); }
.mcp-copy-setup { min-height: 44px; max-width: 100%; white-space: normal; }
.mcp-setup-card details { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--line); }
.mcp-setup-card summary { min-height: 44px; color: var(--muted); }
.mcp-setup-card textarea { width: 100%; max-width: 100%; min-height: 250px; resize: vertical; padding: 16px; margin-top: 8px; font: 12px/1.8 var(--font-code); background: var(--soft); }
.mcp-setup-note { display: flex; align-items: baseline; gap: 7px; color: var(--muted); font-size: 12px; margin: 20px 0 8px; }
.mcp-setup-done { margin-top: 22px; }
@media (max-width: 1199px) { .mcp-created-layout { grid-template-columns: 185px minmax(0, 1fr); gap: 24px; } .mcp-setup-contents { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) {
  .mcp-created-layout { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .mcp-setup-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .mcp-setup-steps li { display: block; padding: 0; }
  .mcp-setup-steps li::after, .mcp-setup-steps p { display: none; }
  .mcp-setup-steps li h3 { font-size: 12px; margin: 9px 0 0; }
  .mcp-setup-card { padding: 20px; }
  .mcp-setup-meta { display: grid; gap: 6px; }
  .mcp-copy-setup { width: 100%; }
}
</style>
