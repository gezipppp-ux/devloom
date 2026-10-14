<script setup>
import { formatDate } from "../../shared/i18n/index.js";
defineProps({ items: { type: Array, default: () => [] } });
function location(item) {
  if (item.kind === "session" || item.blocking && item.runKey) return { name: "workspace", query: { workspace: item.workspaceId, task: item.runKey } };
  if (item.kind === "delivery") return { name: "deliveries", query: { projectId: item.projectId, delivery: item.deliveryId } };
  return { name: "project", params: { projectId: item.projectId }, query: item.kind === "task" ? { tab: "tasks", task: item.taskId } : { tab: "issues", issue: item.issueId } };
}
</script>
<template><ul class="work-actions"><li v-for="item in items" :key="`${item.kind}:${item.id}`"><RouterLink :to="location(item)" class="work-action"><div class="work-action-main"><strong>{{ item.title }}</strong><span class="muted">{{ item.projectName }} · {{ item.kind === 'issue' ? item.phase : $t(item.phase) }}</span><span class="field-hint">{{ $t(item.reason) }}</span></div><div class="work-action-next"><time v-if="item.dueDate">{{ $t('截止日期') }} {{ formatDate(item.dueDate) }}</time><span>{{ $t(item.label) }} →</span></div></RouterLink></li></ul></template>
<style scoped>
.work-actions { list-style: none; padding: 0; margin: 0; }
.work-actions li + li { border-top: 1px solid var(--line); }
.work-action { display: flex; gap: 20px; justify-content: space-between; padding: 18px 0; color: var(--ink); text-decoration: none; min-width: 0; }
.work-action-main, .work-action-next { display: grid; gap: 6px; min-width: 0; }
.work-action strong, .work-action span { overflow-wrap: anywhere; }
.work-action-next { text-align: right; align-content: center; flex-shrink: 0; font-size: 13px; }
.work-action-next time { color: var(--muted); }
@media(max-width: 600px) { .work-action { flex-direction: column; gap: 10px; } .work-action-next { text-align: left; } }
</style>
