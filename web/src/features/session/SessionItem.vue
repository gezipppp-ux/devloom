<script setup>
import { computed } from "vue";
import { renderMessage } from "./message-content.js";
const props = defineProps({ item: { type: Object, required: true }, agentLabel: { type: String, default: "Agent" } });
const emit = defineEmits(["open-file"]);
function openFile(event) {
  const target = event.target.closest("button[data-file-path]");
  if (!target || !event.currentTarget.contains(target)) return;
  emit("open-file", { path: target.dataset.filePath, line: Number(target.dataset.fileLine) || null });
}
const messageHtml = computed(() =>
  props.item.type === "agentMessage"
    ? renderMessage(props.item.text || "…")
    : "",
);
const images = computed(() =>
  props.item.type === "userMessage"
    ? (props.item.images || []).filter((image) =>
        /^\/api\/(?:workspaces\/[a-f\d-]{36}\/)?runs\/[a-z\d-]+\/(?:message-images\/[a-z\d-]+|images\/\d+)$/.test(
          image.url || "",
        ),
      )
    : [],
);
const labels = {
  worktreeInitialization: "工作区初始化",
  commandExecution: "命令执行",
  fileChange: "文件修改",
  mcpToolCall: "工具调用",
  webSearch: "网页检索",
  reasoning: "思考摘要",
  plan: "执行计划",
  contextCompaction: "上下文整理",
};
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
    <div class="message-role">
      {{ item.type === "userMessage" ? "你" : agentLabel
      }}<span
        v-if="item.type === 'agentMessage' && item.status === 'inProgress'"
        class="writing"
        >正在回复</span
      >
    </div>
    <!-- Only sanitized Markdown output is rendered as HTML. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div
      v-if="item.type === 'agentMessage'"
      class="message-text message-markdown"
      @click="openFile"
      v-html="messageHtml"
    />
    <div v-else-if="item.text || !images.length" class="message-text">
      {{ item.text || "…" }}
    </div>
    <div v-if="images.length" class="message-images" aria-label="消息图片">
      <a
        v-for="(image, index) in images"
        :key="`${image.url}-${index}`"
        :href="image.url"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="`查看消息图片 ${index + 1}`"
        ><img
          :src="image.url"
          :alt="image.name || `消息图片 ${index + 1}`"
          loading="lazy"
      /></a>
    </div>
  </article>
  <details v-else class="tool-item" :open="item.status === 'inProgress'">
    <summary>
      <span class="tool-symbol">⌘</span
      ><span>{{ labels[item.type] || item.name || item.type }}</span
      ><code v-if="item.command">{{ item.command }}</code
      ><small>{{
        item.status === "inProgress"
          ? "执行中"
          : ["pending", "skipped", "interrupted", "failed"].includes(
                item.status,
              )
            ? {
                pending: "等待执行",
                skipped: "已跳过",
                interrupted: "已停止",
                failed: "失败",
              }[item.status]
            : item.exitCode != null
              ? `退出码 ${item.exitCode}`
              : "已记录"
      }}</small>
    </summary>
    <pre v-if="item.command">{{ item.command }}</pre>
    <pre v-if="item.output || item.text">{{ item.output || item.text }}</pre>
    <pre v-if="item.arguments">{{ item.arguments }}</pre>
    <pre v-if="item.result">{{ item.result }}</pre>
    <pre v-if="item.changes">{{ pretty(item.changes) }}</pre>
    <p v-if="item.error" class="error">{{ item.error }}</p>
  </details>
</template>
