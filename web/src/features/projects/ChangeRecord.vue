<script setup>
import { computed } from "vue";
import { fieldLabels, sameValue, readableValue } from "./project-records.js";
const props = defineProps({ entry: Object, statusNames: { type: Object, default: () => ({}) }, people: { type: Array, default: () => [] } });
const rows = computed(() => { const after = props.entry.data?.after || props.entry.data || {}, before = props.entry.data?.before; return Object.keys(fieldLabels).filter(key => key in after && (!before || !sameValue(before[key], after[key]))).map(key => ({ key, before: before ? readableValue(key, before[key], props.people, props.statusNames) : null, after: readableValue(key, after[key], props.people, props.statusNames) })); });
</script>
<template><div><p>{{ ({ created: $t("创建事项"), updated: $t("更新事项"), transition: $t("变更状态"), assigned: $t("指派开发"), "step.started": $t("开始处理"), "delivery.reviewed": $t("验收记录"), "delivery.reassigned": $t("重新指定验证人") })[entry.action] || (entry.revision ? $t("资产修订 {p0}", { p0: entry.revision }) : $t("变更记录")) }}</p><p v-for="row in rows" :key="row.key" class="project-text"><strong>{{ $t(fieldLabels[row.key]) }}：</strong><template v-if="row.before !== null">{{ row.before }} → </template>{{ row.after }}</p><p v-if="entry.data?.reviewNote" class="project-text">{{ entry.data.reviewNote }}</p><p v-if="entry.data?.reason">{{ $t("原因：") }}{{ entry.data.reason }}</p></div></template>
