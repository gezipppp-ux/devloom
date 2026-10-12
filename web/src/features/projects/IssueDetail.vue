<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import { EditOutlined, FileTextOutlined, InfoCircleOutlined, SwapOutlined, UserAddOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { priorityLabels } from "./project-labels.js";
import EditConflict from "./EditConflict.vue";
import ProjectFiles from "./ProjectFiles.vue";
import IssueDiscussion from "./IssueDiscussion.vue";
import IssueFields from "./IssueFields.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import { issueFieldsInput, removeAttachmentLinks } from "./issue-fields.js";
import { useProjectAttachments } from "./use-project-attachments.js";
const props = defineProps({ projectId: { type: String, required: true }, issueId: { type: String, required: true }, permissions: { type: Array, required: true }, developmentBusy: Boolean });
const emit = defineEmits(["changed", "start-development", "assign-development"]);
const endpoint = `/projects/${props.projectId}/issues/${props.issueId}`;
const { data, loading, saving, error, notice, reload, save, perform } = useResource(async () => {
  const [issue, members] = await Promise.all([appApi(endpoint), appApi(`/projects/${props.projectId}/members`)]);
  return { ...issue, members: members.members.filter(m => m.status === "active" && m.userStatus === "active"), people: [...issue.people, ...members.members.map(m => ({ id: m.userId, username: m.username, displayName: m.displayName }))] };
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
  <article class="issue-detail">
    <FeedbackMessage :message="error" type="error" />
    <FeedbackMessage :message="notice" type="success" />
    <p v-if="loading && !data" role="status">正在读取事项…</p>
    <button v-if="error && !data" :disabled="loading" @click="reload">重试读取事项</button>
    <template v-if="data">
      <header class="project-heading issue-detail-heading">
        <div class="issue-title">
          <p class="issue-identity"><span class="issue-type" :class="{ 'issue-type-bug': data.type === 'bug' }">{{ data.type === 'bug' ? 'BUG' : '需求' }}</span><span>#{{ data.number }}</span></p>
          <h2>{{ data.title }}</h2>
          <p class="issue-summary"><span class="issue-status-badge">{{ data.statusName }}</span><span>{{ data.release?.name || '未排期' }}</span><span>{{ priorityLabels[data.priority] }}优先级</span></p>
        </div>
        <div class="actions issue-heading-actions">
          <button v-if="can('session.start')" class="issue-secondary-action" :disabled="saving || developmentBusy || editing || Boolean(data.development)" @click="emit('start-development', data)">认领</button>
          <button v-if="can('issue.assign')" class="issue-secondary-action" :disabled="saving || developmentBusy || editing || Boolean(data.development)" @click="emit('assign-development', data)"><UserAddOutlined aria-hidden="true" />指派</button>
          <button v-if="!editing && (can('issue.edit') || can('issue.assign'))" class="primary" @click="edit"><EditOutlined aria-hidden="true" />编辑事项</button>
        </div>
      </header>
      <p v-if="data.release?.status === 'archived'" class="warning">版本已归档，内容只读。</p>
      <FeedbackMessage :message="releases.error.value" type="error" />
      <button v-if="releases.error.value" :disabled="releases.loading.value" @click="releases.reload">重新读取版本</button>
      <div class="issue-detail-grid" :class="{ 'issue-detail-editing': editing }">
        <div class="issue-detail-main">
          <section v-if="editing" class="issue-panel issue-content" aria-label="编辑事项">
            <h3 class="issue-panel-heading"><EditOutlined aria-hidden="true" />编辑事项</h3>
            <EditConflict v-if="latest" :key="latest.revision" :base="baseline" :draft="form" :latest="latest" :people="data.people" @resolve="resolve" @discard="discardDraft" />
            <form class="project-form" @submit.prevent="submit">
              <IssueFields :model-value="form" :type="data.type" :can-edit="can('issue.edit')" :can-assign="can('issue.assign')" :disabled="saving" :context-key="`${projectId}/${issueId}/${draftVersion}`" :members="data.members" :releases="releases.data.value?.items || []" :images="images" :attachments="pending" :attachment-error="attachmentError" :attachment-busy="attachmentBusy" @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile" />
              <div class="actions"><button type="submit" class="primary" :disabled="saving || attachmentBusy || Boolean(latest)">{{ saving ? '正在保存…' : '保存事项' }}</button><button type="button" :disabled="saving" @click="cancelEdit">取消编辑</button><button type="button" :disabled="loading || saving || attachmentBusy" @click="loadLatest">保留草稿，加载最新内容</button></div>
            </form>
          </section>
          <section v-else class="issue-panel issue-content" :aria-label="data.type === 'bug' ? 'Bug 信息' : '需求内容'">
            <h3 class="issue-panel-heading"><FileTextOutlined aria-hidden="true" />{{ data.type === 'bug' ? 'Bug 信息' : '需求内容' }}</h3>
            <div class="issue-content-body">
              <section class="issue-content-block"><h4>描述</h4><MarkdownContent v-if="data.description" :content="data.description" :images="data.images || []" /><p v-else class="muted">暂无描述。</p></section>
              <section v-if="data.type === 'requirement'" class="issue-content-block"><h4>验收标准</h4><MarkdownContent v-if="data.acceptanceCriteria" :content="data.acceptanceCriteria" :images="data.images || []" /><p v-else class="muted">尚未填写。</p></section>
              <template v-else>
                <section class="issue-content-block"><h4>复现步骤</h4><MarkdownContent v-if="data.reproductionSteps" :content="data.reproductionSteps" :images="data.images || []" /><p v-else class="muted">尚未填写。</p></section>
                <div class="issue-result-grid"><section v-for="[key, label] in [['expectedResult', '预期结果'], ['actualResult', '实际结果']]" :key="key" class="issue-content-block"><h4>{{ label }}</h4><MarkdownContent v-if="data[key]" :content="data[key]" :images="data.images || []" /><p v-else class="muted">尚未填写。</p></section></div>
              </template>
            </div>
          </section>
          <IssueDiscussion class="issue-panel issue-discussion" :endpoint="endpoint" :status-names="Object.fromEntries((data.workflow?.definition.nodes || []).map(node => [node.id, node.name]))" :permissions="data.release?.status === 'archived' ? permissions.filter(p => p.endsWith('.view')) : permissions" />
        </div>
        <aside class="issue-detail-sidebar" aria-label="事项操作与资料">
          <section v-if="!editing" class="issue-panel issue-status" aria-label="状态流转">
            <h3 class="issue-panel-heading"><SwapOutlined aria-hidden="true" />状态流转</h3>
            <p class="issue-current-status"><span class="muted">当前状态</span><span class="issue-status-badge">{{ data.statusName }}</span></p>
            <form v-if="transitions.length" class="project-form" @submit.prevent="transition">
              <label>目标状态<select v-model="nextStatus" aria-label="目标状态" :disabled="saving" required><option value="" disabled>选择目标状态</option><option v-for="t in transitions" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
              <label v-if="nextStatus">原因<textarea v-model="reason" rows="2" :disabled="saving" :required="Boolean(transitions.find(t => t.id === nextStatus)?.requiresReason)" /></label>
              <button class="primary" type="submit" :disabled="saving || !nextStatus">{{ saving ? '正在更新…' : '更新状态' }}</button>
            </form>
            <p v-else class="muted">当前没有可用的状态操作。</p>
          </section>
          <section v-if="!editing" class="issue-panel issue-information" aria-label="事项信息">
            <h3 class="issue-panel-heading"><InfoCircleOutlined aria-hidden="true" />事项信息</h3>
            <dl class="issue-facts"><dt>处理人</dt><dd>{{ person(data.assigneeId) }}</dd><dt>参与人</dt><dd>{{ data.participantIds.map(person).join('、') || '无' }}</dd><dt>发布版本</dt><dd>{{ data.release?.name || '未排期' }}</dd><dt>优先级</dt><dd>{{ priorityLabels[data.priority] }}</dd><template v-if="data.type === 'bug'"><dt>严重程度</dt><dd>{{ { minor: '轻微', normal: '普通', major: '严重', critical: '致命' }[data.severity] }}</dd></template><template v-if="data.source"><dt>来源</dt><dd>{{ data.source.channel }} · {{ data.source.externalId }}</dd></template></dl>
            <p v-if="data.development" class="field-hint">已加入 {{ data.development.executorName }} 的开发任务。<RouterLink :to="{ path: `/projects/${projectId}`, query: { tab: 'tasks', task: data.development.taskId } }">查看开发任务</RouterLink></p>
          </section>
          <ProjectFiles :key="filesVersion" class="issue-panel issue-files" :endpoint="endpoint" :can-edit="can('issue.edit') && !editing" @uploaded="reload" />
        </aside>
      </div>
    </template>
  </article>
</template>
