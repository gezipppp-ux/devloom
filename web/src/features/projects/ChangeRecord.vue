<script setup>
import { computed } from "vue";
import { fieldLabels, sameValue, readableValue } from "./project-records.js";
const props = defineProps({ entry: Object, people: { type: Array, default: () => [] } });
const rows = computed(() => { const after = props.entry.data?.after || props.entry.data || {}, before = props.entry.data?.before; return Object.keys(fieldLabels).filter(key => key in after && (!before || !sameValue(before[key], after[key]))).map(key => ({ key, before: before ? readableValue(key, before[key], props.people) : null, after: readableValue(key, after[key], props.people) })); });
</script>
<template><div><p>{{ ({ created: '创建事项', updated: '更新事项', transition: '变更状态' })[entry.action] || (entry.revision ? `资产修订 ${entry.revision}` : '变更记录') }}</p><p v-for="row in rows" :key="row.key" class="project-text"><strong>{{ fieldLabels[row.key] }}：</strong><template v-if="row.before !== null">{{ row.before }} → </template>{{ row.after }}</p><p v-if="entry.data?.reason">原因：{{ entry.data.reason }}</p></div></template>
