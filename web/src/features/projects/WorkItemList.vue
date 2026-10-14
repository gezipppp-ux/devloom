<script setup>
import { formatDate } from "../../shared/i18n/index.js";
import { computed } from "vue";
import StatusBadge from "../../shared/components/StatusBadge.vue";
import { developmentTaskLabels } from "./development-task-view.js";
import { priorityLabels } from "./project-labels.js";
const props = defineProps({ items: { type: Array, default: () => [] }, people: { type: Array, default: () => [] }, kind: { type: String, default: "issues" } });
const emit = defineEmits(["open"]);
const names = computed(() => Object.fromEntries(props.people.map(person => [person.id, person.displayName])));
const deliveryLabels = { pending: "待验证", accepted: "已通过", returned: "已退回" };
</script>
<template><ul class="ui-work-list"><li v-for="item in items" :key="item.id"><button class="ui-work-row" @click="emit('open', item)"><span class="ui-work-symbol" aria-hidden="true">{{ kind === 'deliveries' ? '↗' : kind === 'tasks' ? '⌘' : item.type === 'bug' ? '◈' : '◇' }}</span><span class="ui-work-description"><strong>{{ item.title }}</strong><span class="muted">{{ item.projectName }}<template v-if="item.number"> · #{{ item.number }}</template> · {{ names[item.assigneeId || item.authorId || item.executorId] || (kind === 'issues' ? $t("待分派") : '') }}<template v-if="item.releaseName"> · {{ item.releaseName }}</template><template v-if="item.dueDate"> · {{ formatDate(item.dueDate) }}</template></span><span v-if="item.tags?.length" class="ui-tags"><span v-for="tag in item.tags" :key="tag">{{ tag }}</span></span></span><span class="ui-work-meta"><StatusBadge :tone="item.status === 'accepted' || item.completed ? 'success' : 'neutral'">{{ kind === 'issues' ? item.statusName : kind === 'tasks' ? $t(developmentTaskLabels[item.status] || item.status) : $t(deliveryLabels[item.status]) }}</StatusBadge><small v-if="item.priority" class="muted">{{ $t(priorityLabels[item.priority]) }}</small></span><span class="ui-row-arrow" aria-hidden="true">↗</span></button></li></ul></template>
