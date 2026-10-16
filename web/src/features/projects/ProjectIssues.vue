<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import PlanDevelopmentDialog from "./PlanDevelopmentDialog.vue";
import IssueDetail from "./IssueDetail.vue";
import IssueCreateMenu from "./IssueCreateMenu.vue";
import { issueCreateLocation } from "./work-navigation.js";
import WorkItemTable from "./WorkItemTable.vue";
import { SearchOutlined } from "@antdv-next/icons";
const props = defineProps({ projectId: { type: String, required: true }, projectName: { type: String, default: '' }, type: { type: String, required: true }, permissions: { type: Array, required: true } });
const emit = defineEmits(["open-task"]);
const route = useRoute(), router = useRouter();
const scalar = value => typeof value === "string" ? value : "";
const selected = computed(() => scalar(route.query.issue));
const pageOffset = () => Math.max(0, Number.parseInt(scalar(route.query.offset), 10) || 0);
const query = ref(scalar(route.query.q)), status = ref(scalar(route.query.status)), offset = ref(pageOffset());
const checked = ref([].concat(route.query.selection || []).filter(Boolean));
const detail = ref(null);
const startingIssues = ref([]), assigning = ref(false), releaseId = ref(scalar(route.query.releaseId)), includeArchived = ref(route.query.includeArchived === "true");
const endpoint = `/projects/${props.projectId}/issues`;
const can = p => props.permissions.includes(p);
const { data, loading, saving, error, notice, reload } = useResource(() => appApi(`${endpoint}?type=${props.type}&query=${encodeURIComponent(query.value)}&status=${encodeURIComponent(status.value)}&offset=${offset.value}${releaseId.value ? `&releaseId=${encodeURIComponent(releaseId.value)}` : ""}&includeArchived=${includeArchived.value}`));
const issueRows = computed(() => (data.value?.items || []).map(issue => ({ ...issue, unassignedLabel: "待认领", selectionDisabled: Boolean(issue.development) || issue.release?.status === 'archived' })));
watch(() => route.fullPath, () => { startingIssues.value = []; });
const releases = useResource(() => appApi(`/projects/${props.projectId}/releases?includeArchived=true`));
const workflow = useResource(() => appApi(`/projects/${props.projectId}/issue-workflows/${props.type}`));
const statuses = computed(() => [...new Map([...(workflow.data.value?.workflow?.versions || [])].sort((a, b) => a.version - b.version).flatMap(version => version.definition.nodes).map(node => [node.id, node])).values()]);
async function search(nextOffset = 0) {
  offset.value = nextOffset; checked.value = [];
  await router.push({ query: { ...route.query, q: query.value || undefined, status: status.value || undefined, offset: nextOffset || undefined, selection: undefined, releaseId: releaseId.value || undefined, includeArchived: includeArchived.value ? "true" : undefined } });
  void reload();
}
function openIssue(id) { void router.push({ query: { ...route.query, issue: id || undefined, task: undefined, create: undefined } }); }
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
watch(() => [route.query.q, route.query.status, route.query.offset, route.query.releaseId, route.query.includeArchived], () => {
  query.value = scalar(route.query.q); status.value = scalar(route.query.status); offset.value = pageOffset(); releaseId.value = scalar(route.query.releaseId); includeArchived.value = route.query.includeArchived === "true"; void reload();
});
</script>
<template>
  <PlanDevelopmentDialog v-if="startingIssues.length" :project-id="projectId" :issue-ids="startingIssues" :assign="assigning" @closed="startingIssues = []" @planned="planned" />
  <FeedbackMessage :message="releases.error.value" type="error" /><button v-if="releases.error.value" :disabled="releases.loading.value" @click="releases.reload">{{ $t("重新读取版本") }}</button>
  <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
  <p v-if="selected && saving" role="status">{{ $t("正在保存任务规划…") }}</p>
  <IssueDetail ref="detail" v-if="selected" :key="selected" :project-id="projectId" :project-name="projectName" :issue-id="selected" :permissions="permissions" :development-busy="saving" @back="openIssue('')" @changed="reload" @start-development="start" @assign-development="issue => start(issue, true)" />
  <section v-else><header class="project-heading"><h2>{{ type === 'bug' ? 'Bug' : $t("需求") }}</h2><IssueCreateMenu v-if="can('issue.create')" @create="target => router.push(issueCreateLocation(projectId, target, route.fullPath))" /></header>
    <form class="project-filter ui-project-filter" @submit.prevent="search()"><label class="ui-compact-search"><SearchOutlined aria-hidden="true" /><input v-model="query" type="search" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" /></label><AppSelect native-events v-model="status" :aria-label="$t('事项状态')"><option value="">{{ $t("全部状态") }}</option><option v-for="node in statuses" :key="node.id" :value="node.id">{{ node.name }}</option></AppSelect><AppSelect native-events v-model="releaseId" :aria-label="$t('版本筛选')"><option value="">{{ $t("全部版本") }}</option><option value="unassigned">{{ $t("未排期") }}</option><option v-for="release in releases.data.value?.items" :key="release.id" :value="release.id">{{ release.name }}{{ release.status === 'archived' ? $t("（已归档）") : '' }}</option></AppSelect><label class="permission-choice"><input v-model="includeArchived" type="checkbox" />{{ $t("包含归档事项") }}</label><button type="submit" :disabled="loading">{{ $t("查询") }}</button></form>
    <div v-if="can('session.start') || can('issue.assign')" class="project-development-action ui-selection-bar"><button v-if="can('session.start')" class="primary" :disabled="saving || !checked.length" @click="start()">{{ $t("认领") }}</button><button v-if="can('issue.assign')" :disabled="saving || !checked.length" @click="start(null, true)">{{ $t("指派") }}</button><span class="field-hint">{{ $t("先认领或指派，每条事项分别进入负责人的待开发任务。") }}</span></div>
    <p v-if="loading && !data" role="status">{{ $t("正在读取事项…") }}</p><WorkItemTable v-if="issueRows.length" v-model:selected="checked" :items="issueRows" :people="data?.people || []" :selectable="can('session.start') || can('issue.assign')" :disabled="saving" @open="issue => openIssue(issue.id)"><template #details="{ item }"><p v-if="item.developerId && !item.development">{{ $t('· 无进行中的开发任务') }}</p></template></WorkItemTable><div v-if="data && !data.items.length" class="project-empty">{{ $t("暂无符合条件的事项。") }}</div><div class="actions"><button v-if="offset" @click="search(Math.max(0, offset - 30))">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="search(data.nextOffset)">{{ $t("下一页") }}</button></div>
  </section>
</template>
