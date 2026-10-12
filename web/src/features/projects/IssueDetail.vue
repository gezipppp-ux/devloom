<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { priorityLabels } from "./project-labels.js";
import WorkflowGraph from "../../shared/components/WorkflowGraph.vue";
import EditConflict from "./EditConflict.vue";
import ProjectFiles from "./ProjectFiles.vue";
import IssueDiscussion from "./IssueDiscussion.vue";
import ProjectTasks from "./ProjectTasks.vue";
import IssueFields from "./IssueFields.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import { issueFieldsInput, removeAttachmentLinks } from "./issue-fields.js";
import { useProjectAttachments } from "./use-project-attachments.js";
const props = defineProps({ projectId: { type: String, required: true }, issueId: { type: String, required: true }, permissions: { type: Array, required: true }, spaceReady: Boolean, developmentBusy: Boolean });
const emit = defineEmits(["back", "changed", "open-task", "start-development", "assign-development", "prepare-development"]);
const endpoint = `/projects/${props.projectId}/issues/${props.issueId}`;
const { data, loading, saving, error, notice, reload, save, perform } = useResource(async () => {
  const [issue, members, project] = await Promise.all([appApi(endpoint), appApi(`/projects/${props.projectId}/members`), appApi(`/projects/${props.projectId}`)]);
  return { ...issue, projectBaseBranch: project.project.baseBranch || "", members: members.members.filter(m => m.status === "active" && m.userStatus === "active"), people: [...issue.people, ...members.members.map(m => ({ id: m.userId, username: m.username, displayName: m.displayName }))] };
});
const baseline = ref(null), latest = ref(null);
const editing = ref(false), form = reactive({}), nextStatus = ref(""), reason = ref("");
const draftVersion = ref(0), filesVersion = ref(0);
const { pending, images: draftImages, busy: attachmentBusy, error: attachmentError, add, serialize, reset, remove } = useProjectAttachments(() => props.projectId);
const images = computed(() => [...(data.value?.images || []), ...draftImages.value]);
const can = id => props.permissions.includes(id) && (data.value?.release?.status !== "archived" || id.endsWith(".view"));
const releases = useResource(() => appApi(`/projects/${props.projectId}/releases?includeArchived=true`));
const transitions = computed(() => (data.value?.availableTransitions || []).filter(t => can(t.permission)));
function edit() { reset(); draftVersion.value++; baseline.value = JSON.parse(JSON.stringify(data.value)); latest.value = null; Object.assign(form, data.value); form.participantIds = [...data.value.participantIds]; editing.value = true; }
function cancelEdit() { reset(); draftVersion.value++; editing.value = false; latest.value = null; }
async function attach({ files, insert }) { const markdown = await add(files); if (markdown) insert(markdown); }
function removeFile(id) { removeAttachmentLinks(form, `/api/projects/${props.projectId}/files/${id}`); remove(id); }
function loadLatest() { return perform(() => appApi(endpoint), value => { latest.value = value; }, ""); }
function resolve(values) { Object.assign(form, values, { revision: latest.value.revision }); baseline.value = latest.value; data.value = { ...data.value, ...latest.value }; latest.value = null; error.value = ""; }
function discardDraft() { reset(); draftVersion.value++; resolve(latest.value); }
function submit() {
  if (latest.value || attachmentBusy.value || saving.value) return;
  const input = { revision: form.revision, ...issueFieldsInput(form, { edit: can("issue.edit"), assign: can("issue.assign") }), ...(can("issue.edit") ? { attachments: serialize() } : {}) };
  return save(endpoint, input, value => { data.value = { ...data.value, ...value }; cancelEdit(); filesVersion.value++; emit("changed"); });
}
function transition() { return save(`${endpoint}/transition`, { transitionId: nextStatus.value, reason: reason.value, revision: data.value.revision }, value => { data.value = { ...data.value, ...value }; nextStatus.value = ""; reason.value = ""; emit("changed"); }); }
function person(id) { return data.value?.people?.find(p => p.id === id)?.displayName || (id ? "历史成员" : "未分派"); }
</script>
<template>
  <article class="project-detail"><div class="actions"><button @click="emit('back')">返回事项列表</button><button :disabled="loading || saving || attachmentBusy" @click="editing ? loadLatest() : reload()">{{ editing ? '保留草稿，加载最新内容' : '刷新详情' }}</button></div><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p v-if="loading && !data" role="status">正在读取事项…</p>
    <template v-if="data"><header class="project-heading"><div><p class="eyebrow">{{ data.type === 'bug' ? 'BUG' : '需求' }} #{{ data.number }}</p><h2>{{ data.title }}</h2><p class="muted">{{ data.statusName }} · {{ data.release?.name || '未排期' }} · {{ priorityLabels[data.priority] }}优先级 · {{ person(data.assigneeId) }}</p></div><div class="actions"><button v-if="can('session.start')" :disabled="saving || developmentBusy || editing" @click="emit('start-development', data)">认领到开发任务</button><button v-if="can('issue.assign')" :disabled="saving || developmentBusy || editing" @click="emit('assign-development', data)">指派开发任务</button><button v-if="!editing && (can('issue.edit') || can('issue.assign'))" @click="edit">编辑事项</button></div></header><p v-if="editing && can('session.start')" class="field-hint">请先保存事项，再启动开发。</p>
      <FeedbackMessage :message="releases.error.value" type="error" /><button v-if="releases.error.value" :disabled="releases.loading.value" @click="releases.reload">重新读取版本</button>
      <EditConflict v-if="editing && latest" :key="latest.revision" :base="baseline" :draft="form" :latest="latest" :people="data.people" @resolve="resolve" @discard="discardDraft" />
      <form v-if="editing" class="project-form" @submit.prevent="submit">
        <IssueFields :model-value="form" :type="data.type" :can-edit="can('issue.edit')" :can-assign="can('issue.assign')" :disabled="saving" :context-key="`${projectId}/${issueId}/${draftVersion}`" :members="data.members" :releases="releases.data.value?.items || []" :images="images" :attachments="pending" :attachment-error="attachmentError" :attachment-busy="attachmentBusy" @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile" />
        <div class="actions"><button type="submit" class="primary" :disabled="saving || attachmentBusy || Boolean(latest)">{{ saving ? '正在保存…' : '保存事项' }}</button><button type="button" :disabled="saving" @click="cancelEdit">取消编辑</button></div>
      </form>
      <template v-else><p v-if="data.release?.status === 'archived'" class="warning">版本已归档，内容只读。</p><section v-if="data.workflow" class="project-section"><h3>事项流程 · 版本 {{ data.workflow.version }}</h3><WorkflowGraph :definition="data.workflow.definition" :current="data.status" /></section><section class="project-section"><p class="project-text">开发基线：{{ data.baseBranch || data.projectBaseBranch || '尚未配置，启动时选择' }}{{ data.baseBranch ? '' : '（继承项目默认）' }}</p><h3>描述</h3><MarkdownContent v-if="data.description" :content="data.description" :images="data.images || []" /><p v-else class="muted">暂无描述。</p>
        <template v-if="data.type === 'requirement'"><h3>验收标准</h3><MarkdownContent v-if="data.acceptanceCriteria" :content="data.acceptanceCriteria" :images="data.images || []" /><p v-else class="muted">尚未填写。</p></template>
        <template v-else><template v-for="[key, label] in [['reproductionSteps', '复现步骤'], ['expectedResult', '预期结果'], ['actualResult', '实际结果']]" :key="key"><h3>{{ label }}</h3><MarkdownContent v-if="data[key]" :content="data[key]" :images="data.images || []" /><p v-else class="muted">尚未填写。</p></template><p class="muted">严重程度：{{ { minor: '轻微', normal: '普通', major: '严重', critical: '致命' }[data.severity] }}</p></template>
        <p class="muted">参与人：{{ data.participantIds.map(person).join('、') || '无' }}</p><p v-if="data.source" class="muted">来源：{{ data.source.channel }} · {{ data.source.externalId }}</p></section>
        <form v-if="transitions.length" class="project-form project-section" @submit.prevent="transition"><h3>状态流转</h3><label>目标状态<select aria-label="目标状态" v-model="nextStatus" required><option value="" disabled>选择状态</option><option v-for="t in transitions" :key="t.id" :value="t.id">{{ t.name }}</option></select></label><label>原因<textarea v-model="reason" rows="2" :required="Boolean(transitions.find(t => t.id === nextStatus)?.requiresReason)" /></label><button class="primary" type="submit" :disabled="saving || !nextStatus">更新状态</button><p class="field-hint">状态操作不会启动开发任务；开发结束也不会自动验收。</p></form>
      </template>
      <ProjectFiles :key="filesVersion" :endpoint="endpoint" :can-edit="can('issue.edit') && !editing" @uploaded="reload" />
      <IssueDiscussion :endpoint="endpoint" :status-names="Object.fromEntries((data.workflow?.definition.nodes || []).map(node => [node.id, node.name]))" :permissions="data.release?.status === 'archived' ? permissions.filter(p => p.endsWith('.view')) : permissions" />
      <ProjectTasks v-if="can('issue.view')" :project-id="projectId" :issue-id="issueId" :can-continue="can('session.continue')" @open-workspace="(workspaceId, runKey) => emit('open-task', { workspaceId, runKey })" />
    </template>
  </article>
</template>
