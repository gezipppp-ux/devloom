<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import PagePagination from "../../shared/components/PagePagination.vue";
import WorkItemTable from "./WorkItemTable.vue";
const props = defineProps({ projectId: { type: String, required: true }, projectName: String, release: { type: Object, required: true } });
const router = useRouter(), offset = ref(0);
const { data, loading, error, reload } = useResource(() => appApi(`/projects/${props.projectId}/issues?releaseId=${props.release.id}&includeArchived=${props.release.status === 'archived'}&offset=${offset.value}`));
function page(value) { offset.value = value; void reload(); }
const issues = computed(() => (data.value?.items || []).map(item => ({ ...item, projectName: props.projectName, releaseName: props.release.name })));
const total = computed(() => props.release.progress?.total ?? data.value?.total ?? (data.value && data.value.nextOffset == null ? data.value.items.length : null));
const people = computed(() => data.value?.people || [...new Map(issues.value.flatMap(issue => issue.people || []).map(person => [person.id, person])).values()]);
</script>
<template>
  <section class="release-issue-scope" :aria-label="$t('版本范围')">
    <header class="release-scope-heading"><h2>{{ $t('版本范围') }}</h2><span v-if="total != null" class="release-count">{{ total }}</span></header><FeedbackMessage :message="error" type="error" /><button v-if="error" :disabled="loading" @click="reload">{{ $t('重试') }}</button><p v-if="loading" role="status">{{ $t('正在读取事项…') }}</p>
    <WorkItemTable v-if="issues.length" :items="issues" :people="people" @open="issue => router.push({ name: 'project', params: { projectId }, query: { tab: issue.type === 'bug' ? 'bugs' : 'issues', issue: issue.id } })" />
    <p v-else-if="data && !loading" class="muted">{{ $t('暂无事项') }}</p>
    <PagePagination :offset="offset" :next-offset="data?.nextOffset" :disabled="loading" @change="page" />
    <p v-if="total != null" class="field-hint">{{ $t('共 {count} 项', { count: total }) }}</p>
  </section>
</template>
