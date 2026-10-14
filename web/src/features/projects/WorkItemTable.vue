<script setup>
import { computed } from "vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { priorityLabels } from "./project-labels.js";
import { developmentTaskLabels } from "./development-task-view.js";
import { translate } from "../../shared/i18n/index.js";
const emit = defineEmits(["open", "open-session", "update:selected"]);
const props = defineProps({ items: { type: Array, default: () => [] }, people: { type: Array, default: () => [] }, kind: { type: String, default: "issues" }, selectable: Boolean, selected: { type: Array, default: () => [] }, disabled: Boolean });
const names = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.displayName])));
const person = item => names.value[item.assigneeId || item.executorId] || item.executor?.displayName || (item.assigneeId || item.executorId ? translate("历史成员") : "");
const personLabel = item => person(item) || translate(item.unassignedLabel || "待分派");
function select(item, checked) {
  emit("update:selected", checked ? [...new Set([...props.selected, item.id])] : props.selected.filter(id => id !== item.id));
}
</script>
<template>
  <div class="ui-table-wrap"><table class="ui-data-table" :class="{ 'ui-selectable-table': selectable, 'development-data-table': kind === 'tasks' }">
    <thead><tr>
      <th v-if="selectable" class="ui-table-check"><span class="sr-only">{{ $t('操作') }}</span></th>
      <th class="ui-table-title-column">{{ kind === 'tasks' ? $t('开发任务') : $t('事项') }}</th><th>{{ kind === 'tasks' ? $t('任务状态') : $t('状态') }}</th>
      <th v-if="kind === 'issues'">{{ $t('优先级') }}</th><th v-if="kind === 'tasks'">{{ $t('版本') }}</th><th>{{ kind === 'tasks' ? $t('执行者') : $t('负责人') }}</th><th v-if="kind !== 'tasks'">{{ $t('版本') }}</th><th><span class="sr-only">{{ $t('操作') }}</span></th>
    </tr></thead>
    <tbody><tr v-for="item in items" :key="item.id">
      <td v-if="selectable" class="ui-table-check"><input type="checkbox" :checked="selected.includes(item.id)" :disabled="disabled || item.selectionDisabled" :aria-label="kind === 'tasks' ? $t('选择开发任务 {p0}', { p0: item.title }) : $t('选择事项 {number}', { number: item.number })" @change="select(item, $event.target.checked)" /></td>
      <td class="ui-table-title"><button class="ui-title-link" @click="$emit('open', item)">{{ item.title }}</button>
        <p v-if="kind === 'tasks'"><span :title="item.id">#{{ item.id.slice(0, 8) }}</span><span v-if="item.projectName"> · {{ item.projectName }}</span><span v-if="item.kind === 'manual'"> · {{ $t('独立开发') }}</span><span v-else-if="item.issueIds"> · {{ $t('关联 {count} 个事项', { count: item.issueIds.length }) }}</span></p>
        <p v-else>{{ item.type === 'bug' ? $t('缺陷') : $t('需求') }}<span v-if="item.number"> · #{{ item.number }}</span><span v-if="item.projectName"> · {{ item.projectName }}</span></p>
        <slot name="details" :item="item" /><span v-if="item.tags?.length" class="ui-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span>
      </td>
      <td :data-label="$t(kind === 'tasks' ? '任务状态' : '状态')"><StatusBadge :tone="item.completed || item.status === 'completed' ? 'success' : item.status === 'started' || item.status === 'planned' ? 'accent' : 'neutral'">{{ kind === 'issues' ? item.statusName : $t(developmentTaskLabels[item.status] || item.status) }}</StatusBadge></td>
      <td v-if="kind === 'issues'" :data-label="$t('优先级')"><span class="ui-priority" :class="{ 'ui-priority-high': ['high', 'urgent'].includes(item.priority) }"><i />{{ $t(priorityLabels[item.priority] || '未提供') }}</span></td>
      <td v-if="kind === 'tasks'" :data-label="$t('版本')">{{ item.releaseName || item.release?.name || $t('未排期') }}</td>
      <td :data-label="$t(kind === 'tasks' ? '执行者' : '负责人')"><span class="ui-person"><PersonAvatar :name="personLabel(item)" />{{ personLabel(item) }}</span></td>
      <td v-if="kind !== 'tasks'" :data-label="$t('版本')">{{ item.releaseName || item.release?.name || $t('未排期') }}</td>
      <td class="ui-table-action"><button v-if="kind === 'tasks' && item.status === 'started' && item.canOpenSession && item.runKey && item.workspaceId" :aria-label="$t('进入会话：{title}', { title: item.title })" @click="$emit('open-session', item)">{{ $t('进入会话') }}</button><button v-else :aria-label="$t('查看 {title}', { title: item.title })" @click="$emit('open', item)">{{ kind === 'tasks' ? $t('查看任务') : $t('查看') }}</button></td>
    </tr></tbody>
  </table></div>
</template>
