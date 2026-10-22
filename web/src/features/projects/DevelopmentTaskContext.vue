<script setup>
import { computed, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import AppSelect from "../../shared/components/AppSelect.vue";
import IssueAssignment from "./IssueAssignment.vue";
import IssueInformation from "./IssueInformation.vue";
const props = defineProps({ projectId: { type: String, required: true }, projectName: { type: String, default: "" }, task: { type: Object, required: true }, refreshing: Boolean });
const sources = computed(() => {
  const snapshots = [...(props.task.issues || []), ...(props.task.additions || []).flatMap(batch => batch.issues || [])];
  return [...new Set(props.task.issueIds || [])].map(id => snapshots.find(issue => issue.id === id) || { id, title: id });
});
const selected = ref("");
const { data, loading, error, reload } = useResource(() => selected.value ? appApi(`/projects/${props.projectId}/issues/${encodeURIComponent(selected.value)}`) : null, { immediate: false });
watch(sources, values => { if (!values.some(issue => issue.id === selected.value)) selected.value = values[0]?.id || ""; }, { immediate: true });
watch(() => [props.projectId, selected.value, props.task.revision], () => { data.value = null; void reload(); }, { immediate: true });
watch(() => props.refreshing, (value, previous) => { if (previous && !value) { data.value = null; void reload(); } });
</script>
<template>
  <div class="development-context">
    <section v-if="sources.length" class="source-context" :aria-label="$t('来源事项资料')">
      <label v-if="sources.length > 1" class="source-picker">{{ $t('来源事项') }}<AppSelect v-model="selected" :aria-label="$t('查看来源事项资料')" :options="sources.map(issue => ({ value: issue.id, label: `${issue.number ? '#' + issue.number + ' · ' : ''}${issue.title}` }))" /></label>
      <p v-else class="source-title"><span>{{ $t('来源事项') }}</span>{{ sources[0].number ? '#' + sources[0].number + ' · ' : '' }}{{ sources[0].title }}</p>
      <p v-if="loading" class="field-hint" role="status">{{ $t('正在读取协作资料…') }}</p>
      <div v-else-if="error" class="context-error" role="alert"><p>{{ error }}</p><button @click="reload">{{ $t('重新读取协作资料') }}</button></div>
      <IssueAssignment v-else-if="data" :issue="data" />
    </section>
    <slot />
    <div v-if="data && !error && !loading" class="source-information"><IssueInformation :issue="data" :project-name="projectName" /><p class="field-hint">{{ $t('显示来源事项的当前资料；开发范围保留纳入任务时的内容。') }}</p></div>
    <p v-else-if="!sources.length" class="field-hint">{{ $t('此任务为独立开发，暂无来源事项资料。') }}</p>
  </div>
</template>
<style scoped>
.development-context { display: grid; gap: 24px; min-width: 0; }
.source-context { min-width: 0; }
.source-picker { display: grid; gap: 10px; font-size: 12px; color: var(--muted); margin-bottom: 16px; }
.source-title { font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; margin: 0 0 16px; }
.source-title span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.source-information { border-top: 1px solid var(--line); padding-top: 24px; }
.source-information>.field-hint { margin-top: 16px; }
.context-error { color: var(--danger); font-size: 13px; overflow-wrap: anywhere; }
.context-error p { margin-bottom: 10px; }
</style>
