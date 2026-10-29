<script setup>
import { computed } from "vue";
import { RouterLink } from "vue-router";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import IssueStatusBadge from "./IssueStatusBadge.vue";
import StatusColorBadge from "./StatusColorBadge.vue";
import RelativeTime from "../../shared/components/RelativeTime.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { priorityLabels } from "./project-labels.js";
import { developmentTaskStatusLabel, developmentTaskStatuses, developmentExecutionStatuses, developmentExecutionView } from "./development-task-view.js";
import { translate } from "../../shared/i18n/index.js";
const emit = defineEmits(["open", "open-session", "update:selected"]);
const props = defineProps({ items: { type: Array, default: () => [] }, people: { type: Array, default: () => [] }, kind: { type: String, default: "issues" }, personal: Boolean, selectable: Boolean, selected: { type: Array, default: () => [] }, disabled: Boolean });
const names = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.displayName])));
const person = item => names.value[item.developerId || item.executorId || item.authorId] || item.executor?.displayName || (item.developerId || item.executorId || item.authorId ? translate("历史成员") : "");
const personLabel = item => person(item) || translate(item.unassignedLabel || "待分派");
const reporterIds = item => item.reporterIds || (item.reporterId ? [item.reporterId] : []);
const reporterName = id => names.value[id] || translate("历史成员");
const ownerLabel = computed(() => props.kind === "deliveries" ? "提交人" : "负责人");
const deliveryLabels = { pending: "待验证", accepted: "已通过", returned: "已退回" };
const selectableItems = computed(() => props.items.filter(item => !item.selectionDisabled));
const allSelected = computed(() => selectableItems.value.length > 0 && selectableItems.value.every(item => props.selected.includes(item.id)));
const someSelected = computed(() => selectableItems.value.some(item => props.selected.includes(item.id)));
function selectPage(checked) {
  const ids = selectableItems.value.map(item => item.id);
  emit("update:selected", checked ? [...new Set([...props.selected, ...ids])] : props.selected.filter(id => !ids.includes(id)));
}
function select(item, checked) {
  emit("update:selected", checked ? [...new Set([...props.selected, item.id])] : props.selected.filter(id => id !== item.id));
}
</script>
<template>
  <label v-if="selectable" class="ui-mobile-select-page"><input type="checkbox" :checked="allSelected" :indeterminate="someSelected && !allSelected" :disabled="disabled || !selectableItems.length" :aria-label="$t(kind === 'tasks' ? '选择当前页全部任务' : '选择当前页全部事项')" @change="selectPage($event.target.checked)" />{{ $t(kind === 'tasks' ? '选择当前页全部任务' : '选择当前页全部事项') }}</label>
  <div class="ui-table-wrap"><table class="ui-data-table" :class="{ 'ui-selectable-table': selectable, 'development-data-table': kind === 'tasks' }">
    <thead><tr>
      <th v-if="selectable" class="ui-table-check"><input type="checkbox" :checked="allSelected" :indeterminate="someSelected && !allSelected" :disabled="disabled || !selectableItems.length" :aria-label="$t(kind === 'tasks' ? '选择当前页全部任务' : '选择当前页全部事项')" @change="selectPage($event.target.checked)" /></th>
      <th class="ui-table-title-column">{{ $t(kind === 'tasks' ? '开发任务' : kind === 'deliveries' ? '交付' : '事项') }}</th><th>{{ kind === 'tasks' ? $t('任务状态') : $t('状态') }}</th>
      <th v-if="kind === 'tasks'" class="work-execution-column">{{ $t('Agent 状态') }}</th>
      <th v-if="kind === 'issues'" class="work-priority-column">{{ $t('优先级') }}</th><th class="work-version-column">{{ $t('版本') }}</th><th class="work-owner-column">{{ $t(ownerLabel) }}</th><th class="work-reporter-column">{{ $t('提报人') }}</th><th><span class="sr-only">{{ $t('操作') }}</span></th>
    </tr></thead>
    <tbody><tr v-for="item in items" :key="item.id">
      <td v-if="selectable" class="ui-table-check"><input type="checkbox" :checked="selected.includes(item.id)" :disabled="disabled || item.selectionDisabled" :aria-label="kind === 'tasks' ? $t('选择开发任务 {p0}', { p0: item.title }) : $t('选择事项 {number}', { number: item.number })" @change="select(item, $event.target.checked)" /></td>
      <td class="ui-table-title"><button class="ui-title-link" @click="$emit('open', item)">{{ item.title }}</button>
        <p v-if="kind === 'tasks'"><span :title="item.id">#{{ item.id.slice(0, 8) }}</span><span v-if="item.projectName"> · {{ item.projectName }}</span><span v-if="item.kind === 'manual'"> · {{ $t('独立开发') }}</span><span v-else-if="item.issueIds"> · {{ $t('关联 {count} 个事项', { count: item.issueIds.length }) }}</span></p>
        <p v-else>{{ $t(kind === 'deliveries' ? '交付' : item.type === 'bug' ? '缺陷' : '需求') }}<span v-if="item.number"> · #{{ item.number }}</span><span v-if="item.projectName"> · {{ item.projectName }}</span></p>
        <template v-if="kind === 'tasks'"><p v-for="issue in item.scope" :key="issue.id"><RouterLink :to="{ name: 'project', params: { projectId: item.projectId }, query: { tab: issue.type === 'bug' ? 'bugs' : 'issues', issue: issue.id } }">#{{ issue.number }} {{ issue.title }}</RouterLink> · {{ issue.statusName }}</p></template>
        <p v-if="kind === 'tasks' && item.independentDelivery?.status === 'returned'"><RouterLink :to="{ name: 'deliveries', query: { projectId: item.projectId, delivery: item.independentDelivery.id } }">{{ $t('待返工') }} · {{ $t('查看交付与验收') }}</RouterLink></p>
        <p v-if="personal || kind === 'deliveries'">{{ $t('最后更新') }} · <RelativeTime :value="item.updatedAt || item.createdAt" /></p>
        <slot name="details" :item="item" /><span v-if="item.tags?.length" class="ui-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span>
      </td>
      <td :data-label="$t(kind === 'tasks' ? '任务状态' : '状态')"><IssueStatusBadge v-if="kind === 'issues'" :issue="item" /><StatusColorBadge v-else-if="kind === 'tasks'" :status="item.status" :statuses="developmentTaskStatuses">{{ $t(developmentTaskStatusLabel(item)) }}</StatusColorBadge><StatusBadge v-else :tone="item.completed || ['completed', 'accepted'].includes(item.status) ? 'success' : item.status === 'started' || item.status === 'planned' ? 'accent' : 'neutral'">{{ $t(deliveryLabels[item.status] || item.status) }}</StatusBadge></td>
      <td v-if="kind === 'tasks'" class="work-execution-status" :data-label="$t('Agent 状态')"><StatusColorBadge :status="developmentExecutionView(item).colorKey" :statuses="developmentExecutionStatuses">{{ $t(developmentExecutionView(item).label) }}</StatusColorBadge></td>
      <td v-if="kind === 'issues'" :data-label="$t('优先级')"><span class="ui-priority" :class="{ 'ui-priority-high': ['high', 'urgent'].includes(item.priority) }"><i />{{ $t(priorityLabels[item.priority] || '未提供') }}</span></td>
      <td :data-label="$t('版本')">{{ item.releaseName || item.release?.name || $t('未排期') }}</td>
      <td :data-label="$t(ownerLabel)"><span class="ui-person"><PersonAvatar :name="personLabel(item)" /><span class="work-person-name" :title="personLabel(item)">{{ personLabel(item) }}</span></span></td>
      <td :data-label="$t('提报人')"><span v-if="reporterIds(item).length" class="work-reporters"><span v-for="id in reporterIds(item)" :key="id" class="ui-person"><PersonAvatar :name="reporterName(id)" /><span class="work-person-name" :title="reporterName(id)">{{ reporterName(id) }}</span></span></span><span v-else class="muted">{{ $t(kind === 'issues' ? '未提供' : '无关联事项') }}</span></td>
      <td class="ui-table-action"><button v-if="kind === 'tasks' && item.status === 'started' && item.canOpenSession && item.runKey && item.workspaceId" :aria-label="$t('进入会话：{title}', { title: item.title })" @click="$emit('open-session', item)">{{ $t('进入会话') }}</button><button v-else :aria-label="$t('查看 {title}', { title: item.title })" @click="$emit('open', item)">{{ kind === 'tasks' ? $t('查看任务') : $t('查看') }}</button></td>
    </tr></tbody>
  </table></div>
</template>

<style scoped>
.ui-mobile-select-page { display: none; }
.ui-data-table th.ui-table-title-column, .ui-data-table.ui-selectable-table th.ui-table-title-column { width: 28%; }
.ui-data-table th.work-owner-column { width: 14%; }
.ui-data-table th.work-reporter-column { width: 16%; }
.ui-data-table th.work-version-column { width: 10%; }
.ui-data-table th.work-priority-column { width: 8%; }
.ui-data-table th:last-child { width: 104px; }
.development-data-table th.work-owner-column { width: 12%; }
.development-data-table th.work-reporter-column { width: 12%; }
.development-data-table th.work-version-column { width: 8%; }
.development-data-table th.work-execution-column { width: 13%; }
.development-data-table th:last-child { width: 128px; }
.work-reporters { display: grid; gap: 6px; }
.ui-person { white-space: normal; overflow-wrap: anywhere; width: 100%; }
.work-person-name { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.ui-table-action button { white-space: nowrap; }
.ui-data-table :deep(.ui-badge) { max-width: 100%; white-space: normal; }
@media (min-width: 1200px) and (max-width: 1399px) {
  .development-data-table th.ui-table-title-column, .development-data-table.ui-selectable-table th.ui-table-title-column { width: 24%; }
}
@media (min-width: 768px) and (max-width: 1199px) {
  .ui-person :deep(.ui-person-avatar) { display: none; }
  .ui-data-table :is(th, td) { padding-inline: 10px; }
  .ui-data-table th.ui-table-title-column, .ui-data-table.ui-selectable-table th.ui-table-title-column { width: 24%; }
  .ui-data-table th.work-owner-column { width: 12%; }
  .ui-data-table th.work-reporter-column { width: 15%; }
  .ui-data-table th.work-priority-column { width: 10%; }
  .ui-data-table th:last-child { width: 88px; }
  .development-data-table, .development-data-table tbody { display: block; width: 100%; }
  .development-data-table thead { display: none; }
  .development-data-table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 28px; position: relative; padding: 20px; border-bottom: 1px solid var(--line); }
  .development-data-table tr:last-child { border: 0; }
  .development-data-table td { display: block; min-width: 0; padding: 8px 0; border: 0; }
  .development-data-table td.ui-table-check { position: absolute; top: 18px; right: 20px; width: auto; padding: 0; }
  .development-data-table .ui-table-title, .development-data-table .ui-table-action { grid-column: 1 / -1; }
  .development-data-table.ui-selectable-table .ui-table-title { padding-right: 32px; }
  .development-data-table td[data-label] { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .development-data-table td[data-label]::before { content: attr(data-label); color: var(--muted); flex-shrink: 0; }
  .development-data-table .ui-person { width: auto; }
  .development-data-table .ui-table-action button { min-height: 44px; }
  .ui-mobile-select-page:has(+ .ui-table-wrap .development-data-table) { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-block: 8px; }
  .ui-mobile-select-page input { width: 20px; height: 20px; accent-color: var(--highlight); }
}
@media (max-width: 767px) {
  .work-person-name { display: block; }
  .ui-mobile-select-page { display: flex; align-items: center; gap: 10px; min-height: 44px; margin-block: 8px; }
  .ui-mobile-select-page input { width: 20px; height: 20px; accent-color: var(--highlight); }
}
</style>
