<script setup>
import ListFilters from "../../shared/components/ListFilters.vue";
import { useWorkListFilters } from "./use-work-list-filters.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PlanDevelopmentDialog from "./PlanDevelopmentDialog.vue";
import IssueDetail from "./IssueDetail.vue";
import IssueCreateMenu from "./IssueCreateMenu.vue";
import { issueCreateLocation, workReturnLocation } from "./work-navigation.js";
import WorkItemTable from "./WorkItemTable.vue";
import { SearchOutlined } from "@antdv-next/icons";
import { translate } from "../../shared/i18n/index.js";
const props = defineProps({ projectId: { type: String, required: true }, projectName: { type: String, default: '' }, type: { type: String, required: true }, permissions: { type: Array, required: true } });
const emit = defineEmits(["open-task"]);
const route = useRoute(), router = useRouter();
const scalar = value => typeof value === "string" ? value : "";
const selected = computed(() => scalar(route.query.issue));
const pageOffset = () => Math.max(0, Number.parseInt(scalar(route.query.offset), 10) || 0);
const query = ref(scalar(route.query.q)), offset = ref(pageOffset());
const checked = ref([].concat(route.query.selection || []).filter(Boolean));
const detail = ref(null);
const startingIssues = ref([]), assigning = ref(false), includeArchived = ref(route.query.includeArchived === "true");
const endpoint = `/projects/${props.projectId}/issues`;
const can = p => props.permissions.includes(p);
const { data, loading, saving, error, notice, reload } = useResource(() => appApi(endpoint + '?' + new URLSearchParams({ type: props.type, query: query.value, offset: String(offset.value), includeArchived: String(includeArchived.value), ...filters.params.value, ...(route.query.view !== 'all' && !filters.params.value.status ? { active: 'true' } : {}) })));
const filters = useWorkListFilters('issues', () => data.value?.filterOptions);
const filterFields = computed(() => filters.fields.value.map(field => field.key === 'status' && route.query.view !== 'all' ? { ...field, placeholder: translate('未结束') } : field));
const issueRows = computed(() => (data.value?.items || []).map(issue => ({ ...issue, unassignedLabel: "待认领", selectionDisabled: Boolean(issue.development) || issue.release?.status === 'archived' })));
watch(() => route.fullPath, () => { startingIssues.value = []; });
async function search(nextOffset = 0) {
  offset.value = nextOffset; checked.value = [];
  await router.push({ query: { ...route.query, q: query.value || undefined, offset: nextOffset || undefined, selection: undefined, includeArchived: includeArchived.value ? "true" : undefined } });
  void reload();
}
function openIssue(id) {
  const target = !id && workReturnLocation(router, route, "issues");
  void router.push(target ? target.fullPath : { query: { ...route.query, issue: id || undefined, task: undefined, create: undefined, returnTo: undefined } });
}
async function deleted(id) {
  checked.value = checked.value.filter(value => value !== id);
  const target = workReturnLocation(router, route, "issues");
  if (target) { await router.replace(target.fullPath); return; }
  await router.replace({ query: { ...route.query, issue: undefined, offset: undefined, selection: checked.value.length ? checked.value : undefined } });
  offset.value = 0;
  await reload();
  notice.value = "事项已删除。";
}
async function planned(tasks) {
  startingIssues.value = []; checked.value = [];
  if (assigning.value) {
    notice.value = "已完成指派，开发负责人和任务已更新。";
    await Promise.all([reload(), detail.value?.reload()]);
  } else if (tasks.length === 1) emit("open-task", tasks[0]);
  else void router.push({ query: { ...route.query, tab: "tasks", taskScope: "mine" } });
}
function start(issue, assign = false) {
  const issueIds = issue?.id ? [issue.id] : [...checked.value];
  if (!issueIds.length || !can(assign ? "issue.assign" : "session.start")) return;
  assigning.value = assign; startingIssues.value = issueIds;
}
watch(() => [route.query.q, route.query.offset, route.query.includeArchived, route.query.view, JSON.stringify(filters.params.value)], () => {
  query.value = scalar(route.query.q); offset.value = pageOffset(); includeArchived.value = route.query.includeArchived === "true"; checked.value = []; void reload();
});
</script>
<template>
  <PlanDevelopmentDialog v-if="startingIssues.length" :project-id="projectId" :issue-ids="startingIssues" :assign="assigning" @closed="startingIssues = []" @planned="planned" />
  <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
  <p v-if="selected && saving" role="status">{{ $t("正在保存任务规划…") }}</p>
  <IssueDetail ref="detail" v-if="selected" :key="selected" :project-id="projectId" :project-name="projectName" :issue-id="selected" :permissions="permissions" :development-busy="saving" @back="openIssue('')" @changed="reload" @deleted="deleted" @start-development="start" @assign-development="issue => start(issue, true)" />
  <section v-else><header class="project-heading"><h2>{{ type === 'bug' ? 'Bug' : $t("需求") }}</h2><IssueCreateMenu v-if="can('issue.create')" @create="target => router.push(issueCreateLocation(projectId, target, route.fullPath))" /></header>
    <form class="project-filter ui-project-filter" @submit.prevent="search()"><label class="ui-compact-search"><SearchOutlined aria-hidden="true" /><input v-model="query" type="search" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" /></label><button type="submit" :disabled="loading">{{ $t('查询') }}</button></form>
    <ListFilters :fields="filterFields" :model-value="filters.model.value" @update:model-value="filters.update" @reset="filters.reset"><label class="permission-choice"><input v-model="includeArchived" type="checkbox" @change="search()" />{{ $t('包含归档事项') }}</label><button type="button" @click="router.push({ query: { ...route.query, view: route.query.view === 'all' ? undefined : 'all', status: undefined, offset: undefined } })">{{ $t(route.query.view === 'all' ? '仅看未结束事项' : '查看全部事项') }}</button></ListFilters>
    <div v-if="can('session.start') || can('issue.assign')" class="project-development-action ui-selection-bar"><button v-if="can('session.start')" class="primary" :disabled="saving || !checked.length" @click="start()">{{ $t("认领") }}</button><button v-if="can('issue.assign')" :disabled="saving || !checked.length" @click="start(null, true)">{{ $t("指派") }}</button><span class="field-hint">{{ $t("先认领或指派，每条事项分别进入负责人的待开发任务。") }}</span></div>
    <p v-if="loading && !data" role="status">{{ $t("正在读取事项…") }}</p><WorkItemTable v-if="issueRows.length" v-model:selected="checked" :items="issueRows" :people="data?.people || []" :selectable="can('session.start') || can('issue.assign')" :disabled="saving" @open="issue => openIssue(issue.id)"><template #details="{ item }"><p v-if="item.developerId && !item.development">{{ $t('· 无进行中的开发任务') }}</p></template></WorkItemTable><div v-if="data && !data.items.length" class="project-empty">{{ $t("暂无符合条件的事项。") }}</div><div class="actions"><button v-if="offset" @click="search(Math.max(0, offset - 30))">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="search(data.nextOffset)">{{ $t("下一页") }}</button></div>
  </section>
</template>
