<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import { issueStates, priorityLabels } from "./project-labels.js";
import IssueDetail from "./IssueDetail.vue";
import IssueFields from "./IssueFields.vue";
import { emptyIssue, issueFieldsInput, removeAttachmentLinks } from "./issue-fields.js";
import { useProjectAttachments } from "./use-project-attachments.js";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ projectId: { type: String, required: true }, type: { type: String, required: true }, permissions: { type: Array, required: true }, spaceReady: Boolean });
const emit = defineEmits(["open-task", "prepare-development"]);
const route = useRoute(), router = useRouter();
const scalar = value => typeof value === "string" ? value : "";
const selected = computed(() => scalar(route.query.issue));
const pageOffset = () => Math.max(0, Number.parseInt(scalar(route.query.offset), 10) || 0);
const query = ref(scalar(route.query.q)), status = ref(scalar(route.query.status)), offset = ref(pageOffset());
const creating = ref(false), importing = ref(false), checked = ref([].concat(route.query.selection || []).filter(Boolean)), externalId = ref("");
const taskRequest = ref(createRequestId());
const creationRequest = ref(createRequestId());
const form = reactive(emptyIssue()), draftVersion = ref(0);
const { pending, images, busy: attachmentBusy, error: attachmentError, add, serialize, reset, remove } = useProjectAttachments(() => props.projectId);
const endpoint = `/projects/${props.projectId}/issues`;
const can = p => props.permissions.includes(p);
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(`${endpoint}?type=${props.type}&query=${encodeURIComponent(query.value)}&status=${encodeURIComponent(status.value)}&offset=${offset.value}`));
const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useResource(() => appApi(`/projects/${props.projectId}/members`), { immediate: false });
const activeMembers = computed(() => (members.value?.members || []).filter(m => m.status === "active" && m.userStatus === "active"));
watch(creating, value => { if (value && can("issue.assign")) void reloadMembers(); });
watch(selected, value => { if (value && creating.value) cancelCreate(); });
const statuses = computed(() => Object.entries(issueStates).filter(([id]) => props.type === "bug" ? !["review", "developing", "acceptance", "done"].includes(id) : !["confirmation", "fixing", "verification", "closed"].includes(id)));
async function search(nextOffset = 0) {
  offset.value = nextOffset; checked.value = [];
  await router.push({ query: { ...route.query, q: query.value || undefined, status: status.value || undefined, offset: nextOffset || undefined, selection: undefined } });
  void reload();
}
function openIssue(id) { void router.push({ query: { ...route.query, issue: id || undefined, task: undefined } }); }
async function attach({ files, insert }) { const markdown = await add(files); if (markdown) insert(markdown); }
function removeFile(id) { removeAttachmentLinks(form, `/api/projects/${props.projectId}/files/${id}`); remove(id); }
function cancelCreate() { creating.value = false; draftVersion.value++; creationRequest.value = createRequestId(); Object.assign(form, emptyIssue()); reset(); }
function toggleCreate() { if (creating.value) cancelCreate(); else { creating.value = true; importing.value = false; } }
function toggleImport() { cancelCreate(); importing.value = !importing.value; }
function create() {
  if (attachmentBusy.value || saving.value) return;
  const location = route.fullPath;
  return save(endpoint, { requestId: creationRequest.value, type: props.type, ...issueFieldsInput(form, { assign: can("issue.assign") }), attachments: serialize() }, issue => { cancelCreate(); if (route.fullPath === location) openIssue(issue.id); void reload(); });
}
function importIssue() {
  const location = route.fullPath;
  return save(`${endpoint}/import/tapd`, { items: [{ type: props.type === "bug" ? "bug" : "story", id: externalId.value }] }, result => { if (route.fullPath === location) { openIssue(result.items[0].id); importing.value = false; externalId.value = ""; } void reload(); }, "导入完成，重复来源复用已有事项。");
}
function start(issue) {
  if (!props.spaceReady) return prepare(issue);
  const issueIds = issue?.id ? [issue.id] : [...checked.value];
  if (!issueIds.length || !can("session.start")) return;
  const location = route.fullPath;
  return save(`/projects/${props.projectId}/tasks`, { requestId: taskRequest.value, issueIds }, result => { taskRequest.value = createRequestId(); if (route.fullPath === location) { checked.value = []; emit("open-task", result.task); } }, "开发请求已受理，业务状态保持不变。");
}
async function prepare(issue) {
  if (!issue?.id) await router.replace({ query: { ...route.query, selection: checked.value.length ? checked.value : undefined } });
  emit("prepare-development", issue?.id ? issue : null);
}
watch(() => [route.query.q, route.query.status, route.query.offset], () => {
  query.value = scalar(route.query.q); status.value = scalar(route.query.status); offset.value = pageOffset(); void reload();
});
</script>
<template>
  <p v-if="selected && error" class="error" role="alert">{{ error }}</p>
  <p v-if="selected && saving" role="status">正在提交开发请求，请勿重复启动…</p>
  <IssueDetail v-if="selected" :key="selected" :project-id="projectId" :issue-id="selected" :permissions="permissions" :space-ready="spaceReady" :development-busy="saving" @back="openIssue(''); reload()" @changed="reload" @start-development="start" @prepare-development="prepare" @open-task="task => emit('open-task', task)" />
  <section v-else><header class="project-heading"><h2>{{ type === 'bug' ? 'Bug' : '需求' }}</h2><div v-if="can('issue.create')" class="actions"><button :disabled="saving" @click="toggleImport">从 TAPD 导入</button><button class="primary" :disabled="saving" @click="toggleCreate">新建{{ type === 'bug' ? 'Bug' : '需求' }}</button></div></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <FormSection v-if="creating" :title="type === 'bug' ? '新建 Bug' : '新建需求'"><form class="project-form" @submit.prevent="create">
      <IssueFields :model-value="form" :type="type" can-edit :can-assign="can('issue.assign')" :disabled="saving" :context-key="`${projectId}/${type}/new/${draftVersion}`" :members="activeMembers" :images="images" :attachments="pending" :attachment-error="attachmentError" :attachment-busy="attachmentBusy" @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile" />
      <p v-if="membersLoading" role="status">正在读取可分派成员…</p><p v-if="membersError" class="error" role="alert">{{ membersError }} <button type="button" @click="reloadMembers">重试读取成员</button></p>
      <div class="actions"><button class="primary" type="submit" :disabled="saving || attachmentBusy">{{ saving ? '正在保存…' : '保存事项' }}</button><button type="button" :disabled="saving" @click="cancelCreate">取消</button></div>
    </form></FormSection>
    <FormSection v-if="importing" title="TAPD 只读导入"><form class="project-form" @submit.prevent="importIssue"><label>TAPD {{ type === 'bug' ? 'Bug' : '需求' }}编号<input v-model="externalId" required inputmode="numeric" /></label><p class="field-hint">来源项目和凭据使用项目设置。同一来源不重复创建，也不会覆盖本地修改或回写 TAPD。</p><button class="primary" type="submit" :disabled="saving">导入事项</button></form></FormSection>
    <form class="project-filter" @submit.prevent="search()"><input v-model="query" aria-label="搜索事项" placeholder="搜索标题与描述" /><select v-model="status" aria-label="事项状态"><option value="">全部状态</option><option v-for="[id, label] in statuses" :key="id" :value="id">{{ label }}</option></select><button type="submit" :disabled="loading">查询</button></form>
    <div v-if="can('session.start')" class="project-development-action"><button class="primary" :disabled="saving || !checked.length" @click="start()">{{ !spaceReady ? '准备环境后开发' : checked.length > 1 ? `融合 ${checked.length} 条事项启动开发` : '启动开发' }}</button><span class="field-hint">{{ spaceReady ? '选择事项后启动，每次启动保存内容快照。' : '首次开发需要准备个人 Git 和仓库，准备后会保留所选事项。' }}</span></div>
    <p v-if="loading" role="status">正在读取事项…</p><ul v-else class="project-issue-list"><li v-for="issue in data?.items" :key="issue.id"><input v-if="can('session.start')" v-model="checked" type="checkbox" :value="issue.id" :aria-label="`选择事项 ${issue.number}`" :disabled="saving" /><button class="project-issue-link" @click="openIssue(issue.id)"><span class="muted">#{{ issue.number }}</span><strong>{{ issue.title }}</strong><small>{{ issueStates[issue.status] }} · {{ priorityLabels[issue.priority] }}</small></button></li></ul><div v-if="data && !data.items.length" class="project-empty">暂无符合条件的事项。</div><div class="actions"><button v-if="offset" @click="search(Math.max(0, offset - 30))">上一页</button><button v-if="data?.nextOffset != null" @click="search(data.nextOffset)">下一页</button></div>
  </section>
</template>
