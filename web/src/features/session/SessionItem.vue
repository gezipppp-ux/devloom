<script setup>
import { computed } from "vue";
import { UserOutlined, RobotOutlined, CodeOutlined, FileTextOutlined, BulbOutlined, RightOutlined, ExclamationCircleOutlined } from "@antdv-next/icons";
import { renderMessage } from "./message-content.js";
import { activityFailed, activityLabels, activityPreview } from "./session-activity.js";
import SessionPreviewGroup from "./SessionPreviewGroup.vue";
import { previewParts } from "./session-preview-parts.js";
const props = defineProps({ item: { type: Object, required: true }, agentLabel: { type: String, default: "Agent" }, runKey: { type: String, default: "" }, latestPreviewVersions: { type: Object, default: () => ({}) }, readonly: Boolean, canFeedback: Boolean, compact: Boolean, toolOpen: Boolean });
const emit = defineEmits(["open-file", "tool-toggle", "preview-feedback"]);
const failed = computed(() => activityFailed(props.item));
const preview = computed(() => activityPreview(props.item));
function openFile(event) {
  const target = event.target.closest("button[data-file-path]");
  if (!target || !event.currentTarget.contains(target)) return;
  emit("open-file", { path: target.dataset.filePath, line: Number(target.dataset.fileLine) || null });
}
const messageParts = computed(() => previewParts(props.item.contentParts || [{ type: "text", text: props.item.text || "…" }])
  .map(part => part.type === "text" ? { ...part, html: renderMessage(part.text) } : part));
const images = computed(() =>
  props.item.type === "userMessage"
    ? (props.item.images || []).filter((image) =>
        /^\/api\/(?:workspaces\/[a-f\d-]{36}\/)?runs\/[a-z\d-]+\/(?:message-images\/[a-z\d-]+|images\/\d+)$/.test(
          image.url || "",
        ),
      )
    : [],
);
const pretty = (value) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
// User messages and tool output retain their literal text representation.
</script>
<template>
  <article
    v-if="['userMessage', 'agentMessage'].includes(item.type)"
    class="message"
    :class="{ 'from-user': item.type === 'userMessage' }"
  >
    <span class="message-mark" aria-hidden="true"><UserOutlined v-if="item.type === 'userMessage'" /><RobotOutlined v-else /></span>
    <div class="message-role">
      {{ item.type === "userMessage" ? $t("你") : agentLabel
      }}<span
        v-if="item.type === 'agentMessage' && item.status === 'inProgress'"
        class="writing"
        >{{ $t("正在回复") }}</span
      >
    </div>
    <div v-if="item.type === 'agentMessage'" class="message-text message-markdown" @click="openFile">
      <template v-for="(part, index) in messageParts" :key="part.id || index">
        <!-- Only sanitized Markdown output is rendered as HTML. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="part.type === 'text' && part.text" v-html="part.html" />
        <SessionPreviewGroup v-else-if="part.type === 'preview-group' && runKey" :previews="part.previews" :run-key="runKey" :readonly="readonly" :latest-versions="latestPreviewVersions" :can-feedback="canFeedback" @feedback="emit('preview-feedback', $event)" />
        <p v-else-if="part.type === 'preview-error'" class="error">{{ part.title }} · {{ $t(part.error) }}</p>
      </template>
    </div>
    <div v-else-if="item.text || !images.length" class="message-text">
      {{ item.text || "…" }}
    </div>
    <div v-if="images.length" class="message-images" :aria-label="$t('消息图片')">
      <a
        v-for="(image, index) in images"
        :key="`${image.url}-${index}`"
        :href="image.url"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="$t('查看消息图片 {p0}', { p0: index + 1 })"
        ><img
          :src="image.url"
          :alt="image.name || `消息图片 ${index + 1}`"
          loading="lazy"
      /></a>
    </div>
  </article>
  <div v-else class="session-tool" :class="{ compact, failed }">
  <details class="tool-item" :open="toolOpen" @toggle="emit('tool-toggle', $event.currentTarget.open)">
    <summary>
      <span class="tool-symbol" aria-hidden="true"><ExclamationCircleOutlined v-if="failed" /><CodeOutlined v-else-if="item.command" /><BulbOutlined v-else-if="item.type === 'reasoning'" /><FileTextOutlined v-else /></span>
      <span class="tool-label" :class="{ 'sr-only': compact && preview }">{{ $t(activityLabels[item.type] || item.name || item.type) }}</span>
      <span v-if="preview" class="tool-preview" :title="preview">{{ preview }}</span>
      <small>{{
        failed ? $t('失败') : item.status === "inProgress"
          ? $t("执行中")
          : ["pending", "skipped", "interrupted", "failed"].includes(
                item.status,
              )
            ? {
                pending: $t("等待执行"),
                skipped: $t("已跳过"),
                interrupted: $t("已停止"),
                failed: $t("失败"),
              }[item.status]
              : item.status === 'completed' ? $t('已完成') : ''
      }}</small>
      <RightOutlined class="tool-chevron" aria-hidden="true" />
    </summary>
    <template v-if="toolOpen">
    <pre v-if="item.command">{{ item.command }}</pre>
    <pre v-if="item.output || item.text">{{ item.output || item.text }}</pre>
    <pre v-if="item.arguments">{{ item.arguments }}</pre>
    <pre v-if="item.result">{{ item.result }}</pre>
    <pre v-if="item.changes">{{ pretty(item.changes) }}</pre>
    <p v-if="item.error" class="error">{{ item.error }}</p>
    <p v-if="item.exitCode != null" class="tool-exit">{{ $t('退出码 {p0}', { p0: item.exitCode }) }}</p>
    </template>
  </details>
  <p v-if="failed && !toolOpen" class="tool-failure">{{ item.error || (item.exitCode != null ? $t('退出码 {p0}', { p0: item.exitCode }) : $t('执行失败，展开查看详情。')) }}</p>
  </div>
</template>

<style scoped>
.message { display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 13px; padding: 0; margin-bottom: 30px; }
.message-mark { grid-column: 1; grid-row: 1 / 4; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--selected); color: var(--highlight); }
.message-role, .message-text, .message-images { grid-column: 2; min-width: 0; }
.message-role { margin: 0 0 9px; line-height: 30px; color: var(--ink); font-size: 12px; letter-spacing: 0; }
.message-text { font-size: 14px; line-height: 1.9; }
.from-user { margin-top: 0; padding: 0; background: transparent; border: 0; border-radius: 0; }
.from-user .message-text { padding: 14px 16px; border-radius: 8px; background: var(--soft); }
.session-tool { margin: 0 0 20px 43px; min-width: 0; }
.tool-item { margin: 0; border: 0; border-radius: 0; background: transparent; font-size: 12px; }
.tool-item > summary { padding: 4px 0; min-height: 32px; min-width: 0; gap: 8px; list-style: none; color: var(--muted); }
.tool-item > summary::-webkit-details-marker { display: none; }
.tool-item > summary:hover { color: var(--ink); }
.tool-symbol { display: inline-flex; font-size: 13px; flex-shrink: 0; }
.tool-label { flex-shrink: 0; }
.tool-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-item small { font-size: 12px; }
.tool-chevron { font-size: 10px; flex-shrink: 0; transition: transform .15s; }
.tool-item[open] > summary .tool-chevron { transform: rotate(90deg); }
.tool-item pre { margin: 6px 0 10px 21px; padding: 12px 14px; border-radius: 5px; background: var(--soft); max-height: 320px; overflow: auto; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-exit { margin: 8px 0 12px 21px; color: var(--muted); font-size: 12px; }
.compact { margin: 0; }
.failed { border-left: 2px solid var(--danger); padding-left: 12px; }
.failed > .tool-item > summary, .failed .tool-item small, .tool-failure { color: var(--danger); }
.tool-failure { margin: 4px 0 0 21px; font-size: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 767px) {
  .message { column-gap: 10px; margin-bottom: 24px; }
  .from-user .message-text { padding: 12px; }
  .session-tool { margin-left: 0; }
  .tool-item > summary { min-height: 44px; flex-wrap: nowrap; }
  .tool-preview { white-space: normal; overflow-wrap: anywhere; }
  .tool-item pre { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { .tool-chevron { transition: none; } }
</style>
