<script setup>
import { computed } from "vue";
import { FileTextOutlined, CheckSquareOutlined, CodeOutlined, MessageOutlined } from "@antdv-next/icons";
import { accountSession } from "../../shared/api/account-session.js";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { formatDate } from "../../shared/i18n/index.js";
defineProps({ items: { type: Array, default: () => [] } });
const handlerName = computed(() => accountSession.user?.displayName || "");
function symbol(item) {
  if (item.kind === "session") return MessageOutlined;
  if (item.kind === "task") return CodeOutlined;
  return item.bucket === "verify" || item.kind === "delivery" ? CheckSquareOutlined : FileTextOutlined;
}
function location(item) {
  if (item.kind === "session" || item.blocking && item.runKey) return { name: "workspace", query: { workspace: item.workspaceId, task: item.runKey } };
  if (item.kind === "delivery") return { name: "deliveries", query: { projectId: item.projectId, delivery: item.deliveryId } };
  return { name: "project", params: { projectId: item.projectId }, query: item.kind === "task" ? { tab: "tasks", task: item.taskId } : { tab: "issues", issue: item.issueId } };
}
</script>
<template>
  <ul class="ui-work-list work-actions">
    <li v-for="item in items" :key="`${item.kind}:${item.id}`">
      <RouterLink :to="location(item)" class="ui-work-row work-action" :title="$t(item.reason)">
        <span class="ui-work-symbol" :class="{ 'work-action-verification': item.bucket === 'verify' }"><component :is="symbol(item)" aria-hidden="true" /></span>
        <span class="ui-work-description work-action-main">
          <strong>{{ item.title }}</strong>
          <span class="work-action-meta muted"><span>{{ item.projectName }}</span><span>{{ item.kind === 'issue' ? item.phase : $t(item.phase) }}</span><span v-if="item.number">#{{ item.number }}</span></span>
        </span>
        <span class="ui-work-person" :title="`${$t('当前处理人')}：${handlerName}`"><PersonAvatar :name="handlerName" /><span>{{ handlerName || '—' }}</span></span>
        <time v-if="item.dueDate || item.createdAt" class="ui-work-date" :datetime="item.dueDate || item.createdAt" :title="`${$t(item.dueDate ? '截止日期' : '创建时间')}：${formatDate(item.dueDate || item.createdAt)}`">{{ formatDate(item.dueDate || item.createdAt, { year: undefined, month: 'short', day: 'numeric' }) }}</time>
        <span v-else class="ui-work-date">—</span>
        <span class="ui-row-action work-action-next">{{ item.workflowLabel || $t(item.label) }}</span>
      </RouterLink>
    </li>
  </ul>
</template>
<style scoped>
.work-action { align-items: center; min-width: 0; text-decoration: none; }
.work-action:focus-visible { outline: 2px solid var(--focus); outline-offset: -3px; }
.work-action-verification { color: var(--danger); background: var(--danger-soft); }
.work-action-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.work-action-meta > span { overflow-wrap: anywhere; }
.work-action-meta > span + span::before { content: '·'; margin-right: 8px; }
.work-action .ui-work-person { width: 106px; flex-basis: 106px; min-width: 0; }
.work-action .ui-work-person > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.work-action .ui-work-date { width: 66px; flex-basis: 66px; }
.work-action-next { max-width: 160px; text-align: center; overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .work-action { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 12px; }
  .work-action .ui-work-symbol { align-self: start; }
  .work-action-main { grid-column: 2 / -1; }
  .work-action .ui-work-person { grid-column: 2; width: auto; margin: 0; }
  .work-action .ui-work-date { display: block; grid-column: 2; grid-row: 3; width: auto; }
  .work-action-next { grid-column: 3; grid-row: 2 / 4; min-height: 44px; max-width: 120px; }
}
</style>
