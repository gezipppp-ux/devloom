<script setup>
defineProps({ item: { type: Object, required: true } });
const labels = {
  worktreeInitialization: '工作区初始化',
  commandExecution: '命令执行',
  fileChange: '文件修改',
  mcpToolCall: '工具调用',
  webSearch: '网页检索',
  reasoning: '思考摘要',
  plan: '执行计划',
  contextCompaction: '上下文整理',
};
const pretty = (value) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
// Keep message bodies as escaped text, including content returned by tools.
</script>
<template>
  <article
    v-if="['userMessage', 'agentMessage'].includes(item.type)"
    class="message"
    :class="{ 'from-user': item.type === 'userMessage' }"
  >
    <div class="message-role">
      {{ item.type === 'userMessage' ? '你' : 'CODEX'
      }}<span
        v-if="item.type === 'agentMessage' && item.status === 'inProgress'"
        class="writing"
        >正在回复</span
      >
    </div>
    <div class="message-text">{{ item.text || '…' }}</div>
  </article>
  <details v-else class="tool-item" :open="item.status === 'inProgress'">
    <summary>
      <span class="tool-symbol">⌘</span
      ><span>{{ labels[item.type] || item.name || item.type }}</span
      ><code v-if="item.command">{{ item.command }}</code
      ><small>{{
        item.status === 'inProgress'
          ? '执行中'
          : ['pending', 'skipped', 'interrupted', 'failed'].includes(
                item.status,
              )
            ? {
                pending: '等待执行',
                skipped: '已跳过',
                interrupted: '已停止',
                failed: '失败',
              }[item.status]
            : item.exitCode != null
              ? `退出码 ${item.exitCode}`
              : '已记录'
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
