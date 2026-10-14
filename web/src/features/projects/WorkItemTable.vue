<script setup>
import { computed } from "vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { priorityLabels } from "./project-labels.js";
import { developmentTaskLabels } from "./development-task-view.js";
defineEmits(["open"]);
const props = defineProps({ items: { type: Array, default: () => [] }, people: { type: Array, default: () => [] }, kind: { type: String, default: "issues" } });
const names = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.displayName])));
const person = item => names.value[item.assigneeId || item.executorId];
</script>
<template>
  <div class="ui-table-wrap"><table class="ui-data-table"><thead><tr><th>{{ kind === 'tasks' ? $t('开发任务') : $t('事项') }}</th><th>{{ kind === 'tasks' ? $t('任务状态') : $t('状态') }}</th><th v-if="kind === 'issues'">{{ $t('优先级') }}</th><th>{{ $t('负责人') }}</th><th>{{ $t('版本') }}</th><th><span class="sr-only">{{ $t('操作') }}</span></th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td class="ui-table-title"><button class="ui-title-link" @click="$emit('open', item)">{{ item.title }}</button><p>{{ kind === 'issues' ? (item.type === 'bug' ? $t('缺陷') : $t('需求')) : $t('开发任务') }}<span v-if="item.number"> · #{{ item.number }}</span> · {{ item.projectName }}</p><span v-if="item.tags?.length" class="ui-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span></td><td :data-label="$t('状态')"><StatusBadge :tone="item.completed || item.status === 'completed' ? 'success' : item.status === 'started' ? 'accent' : 'neutral'">{{ kind === 'issues' ? item.statusName : $t(developmentTaskLabels[item.status] || item.status) }}</StatusBadge></td><td v-if="kind === 'issues'" :data-label="$t('优先级')"><span class="ui-priority" :class="{ 'ui-priority-high': ['high', 'urgent'].includes(item.priority) }"><i />{{ $t(priorityLabels[item.priority] || '未提供') }}</span></td><td :data-label="$t('负责人')"><span class="ui-person"><PersonAvatar :name="person(item) || $t('待分派')" />{{ person(item) || $t('待分派') }}</span></td><td :data-label="$t('版本')">{{ item.releaseName || $t('未排期') }}</td><td class="ui-table-action"><button :aria-label="$t('查看 {title}', { title: item.title })" @click="$emit('open', item)">{{ kind === 'tasks' ? $t('查看任务') : $t('查看') }}</button></td></tr></tbody></table></div>
</template>
