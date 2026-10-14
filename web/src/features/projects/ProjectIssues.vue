<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import PlanDevelopmentDialog from "./PlanDevelopmentDialog.vue";
import IssueDetail from "./IssueDetail.vue";
import IssueFields from "./IssueFields.vue";
import { emptyIssue, issueFieldsInput, removeAttachmentLinks } from "./issue-fields.js";
import { useProjectAttachments } from "./use-project-attachments.js";
import FormSection from "../../shared/components/FormSection.vue";
import WorkItemTable from "./WorkItemTable.vue";
import { SearchOutlined } from "@antdv-next/icons";
const props = defineProps({ projectId: { type: String, required: true }, projectName: { type: String, default: '' }, type: { type: String, required: true }, permissions: { type: Array, required: true } });
const emit = defineEmits(["open-task"]);
const route = useRoute(), router = useRouter();
const scalar = value => typeof value === "string" ? value : "";
const selected = computed(() => scalar(route.query.issue));
const pageOffset = () => Math.max(0, Number.parseInt(scalar(route.query.offset), 10) || 0);
const query = ref(scalar(route.query.q)), status = ref(scalar(route.query.status)), offset = ref(pageOffset());
const creating = ref(route.query.create === "1"), checked = ref([].concat(route.query.selection || []).filter(Boolean));
const startingIssues = ref([]), assigning = ref(false), releaseId = ref(scalar(route.query.releaseId)), includeArchived = ref(route.query.includeArchived === "true");
const creationRequest = ref(createRequestId());
const form = reactive(emptyIssue()), draftVersion = ref(0);
const { pending, images, busy: attachmentBusy, error: attachmentError, add, serialize, reset, remove } = useProjectAttachments(() => props.projectId);
const endpoint = `/projects/${props.projectId}/issues`;
const can = p => props.permissions.includes(p);
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`${endpoint}?type=${props.type}&query=${encodeURIComponent(query.value)}&status=${encodeURIComponent(status.value)}&offset=${offset.value}${releaseId.value ? `&releaseId=${encodeURIComponent(releaseId.value)}` : ""}&includeArchived=${includeArchived.value}`));
const issueRows = computed(() => (data.value?.items || []).map(issue => ({ ...issue, unassignedLabel: "待认领", selectionDisabled: Boolean(issue.development) || issue.release?.status === 'archived' })));
const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useResource(() => appApi(`/projects/${props.projectId}/members`), { immediate: false });
const activeMembers = computed(() => (members.value?.members || []).filter(m => m.status === "active" && m.userStatus === "active"));
watch(creating, value => { if (value && can("issue.assign")) void reloadMembers(); }, { immediate: true });
watch(() => route.fullPath, () => { startingIssues.value = []; });
watch(() => route.query.create, value => { if (value === "1") creating.value = true; });
watch(selected, value => { if (value && creating.value) cancelCreate(); });
const releases = useResource(() => appApi(`/projects/${props.projectId}/releases?includeArchived=true`));
const workflow = useResource(() => appApi(`/projects/${props.projectId}/issue-workflows/${props.type}`));
const statuses = computed(() => [...new Map([...(workflow.data.value?.workflow?.versions || [])].sort((a, b) => a.version - b.version).flatMap(version => version.definition.nodes).map(node => [node.id, node])).values()]);
async function search(nextOffset = 0) {
  offset.value = nextOffset; checked.value = [];
  await router.push({ query: { ...route.query, q: query.value || undefined, status: status.value || undefined, offset: nextOffset || undefined, selection: undefined, releaseId: releaseId.value || undefined, includeArchived: includeArchived.value ? "true" : undefined } });
  void reload();
}
function openIssue(id) { void router.push({ query: { ...route.query, issue: id || undefined, task: undefined, create: undefined } }); }
async function attach({ files, insert }) { const markdown = await add(files); if (markdown) insert(markdown); }
function removeFile(id) { removeAttachmentLinks(form, `/api/projects/${props.projectId}/files/${id}`); remove(id); }
function cancelCreate() { if (route.query.create) void router.replace({ query: { ...route.query, create: undefined } }); creating.value = false; draftVersion.value++; creationRequest.value = createRequestId(); Object.assign(form, emptyIssue()); reset(); }
function toggleCreate() { if (creating.value) cancelCreate(); else creating.value = true; }
function create() {
  if (attachmentBusy.value || saving.value) return;
  const location = route.fullPath;
  return save(endpoint, { requestId: creationRequest.value, type: props.type, ...issueFieldsInput(form, { assign: can("issue.assign") }), attachments: serialize() }, issue => { cancelCreate(); if (route.fullPath === location) openIssue(issue.id); void reload(); });
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
  <PlanDevelopmentDialog v-if="startingIssues.length" :project-id="projectId" :issue-ids="startingIssues" :assign="assigning" @closed="startingIssues = []" @planned="tasks => { startingIssues = []; checked = []; tasks.length === 1 ? emit('open-task', tasks[0]) : router.push({ query: { tab: 'tasks', taskScope: assigning ? 'all' : 'mine' } }); }" />
  <FeedbackMessage :message="releases.error.value" type="error" /><button v-if="releases.error.value" :disabled="releases.loading.value" @click="releases.reload">{{ $t("重新读取版本") }}</button>
  <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
  <p v-if="selected && saving" role="status">{{ $t("正在保存任务规划…") }}</p>
  <IssueDetail v-if="selected" :key="selected" :project-id="projectId" :project-name="projectName" :issue-id="selected" :permissions="permissions" :development-busy="saving" @back="openIssue('')" @changed="reload" @start-development="start" @assign-development="issue => start(issue, true)" />
  <section v-else><header class="project-heading"><h2>{{ type === 'bug' ? 'Bug' : $t("需求") }}</h2><div v-if="can('issue.create')" class="actions"><button class="primary" :disabled="saving" @click="toggleCreate">{{ type === 'bug' ? $t("新建Bug") : $t("新建需求") }}</button></div></header>
    <FormSection v-if="creating" :title="type === 'bug' ? $t('新建 Bug') : $t('新建需求')"><form class="project-form" @submit.prevent="create">
      <IssueFields :model-value="form" :type="type" can-edit :can-assign="can('issue.assign')" :disabled="saving" :context-key="`${projectId}/${type}/new/${draftVersion}`" :members="activeMembers" :releases="releases.data.value?.items || []" :images="images" :attachments="pending" :attachment-error="attachmentError" :attachment-busy="attachmentBusy" @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile" />
      <p v-if="membersLoading" role="status">{{ $t("正在读取可分派成员…") }}</p><FeedbackMessage :message="membersError" type="error" /><button v-if="membersError" type="button" @click="reloadMembers">{{ $t("重试读取成员") }}</button>
      <div class="actions"><button class="primary" type="submit" :disabled="saving || attachmentBusy">{{ saving ? $t("正在保存…") : $t("保存事项") }}</button><button type="button" :disabled="saving" @click="cancelCreate">{{ $t("取消") }}</button></div>
    </form></FormSection>
    <form class="project-filter ui-project-filter" @submit.prevent="search()"><label class="ui-compact-search"><SearchOutlined aria-hidden="true" /><input v-model="query" type="search" :aria-label="$t('搜索事项')" :placeholder="$t('搜索标题与描述')" /></label><AppSelect native-events v-model="status" :aria-label="$t('事项状态')"><option value="">{{ $t("全部状态") }}</option><option v-for="node in statuses" :key="node.id" :value="node.id">{{ node.name }}</option></AppSelect><AppSelect native-events v-model="releaseId" :aria-label="$t('版本筛选')"><option value="">{{ $t("全部版本") }}</option><option value="unassigned">{{ $t("未排期") }}</option><option v-for="release in releases.data.value?.items" :key="release.id" :value="release.id">{{ release.name }}{{ release.status === 'archived' ? $t("（已归档）") : '' }}</option></AppSelect><label class="permission-choice"><input v-model="includeArchived" type="checkbox" />{{ $t("包含归档事项") }}</label><button type="submit" :disabled="loading">{{ $t("查询") }}</button></form>
    <div v-if="can('session.start') || can('issue.assign')" class="project-development-action ui-selection-bar"><button v-if="can('session.start')" class="primary" :disabled="saving || !checked.length" @click="start()">{{ $t("认领") }}</button><button v-if="can('issue.assign')" :disabled="saving || !checked.length" @click="start(null, true)">{{ $t("指派") }}</button><span class="field-hint">{{ $t("先认领或指派，每条事项分别进入负责人的待开发任务。") }}</span></div>
    <p v-if="loading" role="status">{{ $t("正在读取事项…") }}</p><WorkItemTable v-else-if="issueRows.length" v-model:selected="checked" :items="issueRows" :people="data?.people || []" :selectable="can('session.start') || can('issue.assign')" :disabled="saving" @open="issue => openIssue(issue.id)"><template #details="{ item }"><p v-if="item.developerId && !item.development">{{ $t('· 无进行中的开发任务') }}</p></template></WorkItemTable><div v-if="data && !data.items.length" class="project-empty">{{ $t("暂无符合条件的事项。") }}</div><div class="actions"><button v-if="offset" @click="search(Math.max(0, offset - 30))">{{ $t("上一页") }}</button><button v-if="data?.nextOffset != null" @click="search(data.nextOffset)">{{ $t("下一页") }}</button></div>
  </section>
</template>
