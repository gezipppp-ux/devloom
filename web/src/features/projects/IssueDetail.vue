<script setup>
import PublishDelivery from "./PublishDelivery.vue";
import IssueWorkflowUpgrade from "./IssueWorkflowUpgrade.vue";
import IssueDeleteAction from "./IssueDeleteAction.vue";
import AppSelect from "../../shared/components/AppSelect.vue";
import {formatDate, translate} from "../../shared/i18n/index.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import {usePageTitle} from "../../shared/components/page-title.js";
import {computed, reactive, ref} from "vue";
import {RouterLink} from "vue-router";
import {EditOutlined, FileTextOutlined, SwapOutlined, UserAddOutlined, ArrowLeftOutlined} from "@antdv-next/icons";
import {appApi} from "../../shared/api/api.js";
import {useResource} from "../../shared/api/use-resource.js";
import IssueAssignment from "./IssueAssignment.vue";
import EditConflict from "./EditConflict.vue";
import ProjectFiles from "./ProjectFiles.vue";
import IssueDiscussion from "./IssueDiscussion.vue";
import IssueFields from "./IssueFields.vue";
import AcceptanceCriteriaList from "./AcceptanceCriteriaList.vue";
import MarkdownContent from "../../shared/components/MarkdownContent.vue";
import IssueInformation from "./IssueInformation.vue";
import IssueStatusBadge from "./IssueStatusBadge.vue";
import {issueDetailFields, issueFieldsInput, missingIssueResponsibilities, removeAttachmentLinks} from "./issue-fields.js";
import {useProjectAttachments} from "./use-project-attachments.js";

const props = defineProps({
  projectId: {type: String, required: true},
  projectName: {type: String, default: ''},
  issueId: {type: String, required: true},
  permissions: {type: Array, required: true},
  developmentBusy: Boolean
});
const emit = defineEmits(["back", "changed", "deleted", "start-development", "assign-development"]);
const endpoint = `/projects/${props.projectId}/issues/${props.issueId}`;
const {data, loading, saving, error, notice, reload, save, perform} = useResource(async () => {
  const [issue, members] = await Promise.all([appApi(endpoint), appApi(`/projects/${props.projectId}/members`)]);
  return {
    ...issue,
    members: members.members.filter(m => m.status === "active" && m.userStatus === "active"),
    people: [...issue.people, ...members.members.map(m => ({
      id: m.userId,
      username: m.username,
      displayName: m.displayName
    }))]
  };
});
defineExpose({ reload });
usePageTitle(() => [error.value ? "" : data.value?.title, translate("事项")]);
const publishing = ref(false), nextHandler = ref(""), assigningHandler = ref(false), handlerId = ref("");
const upgrading = ref(false);
const baseline = ref(null), latest = ref(null);
const editing = ref(false), form = reactive({}), nextStatus = ref(""), reason = ref("");
const draftVersion = ref(0), filesVersion = ref(0);
const {
  pending,
  images: draftImages,
  busy: attachmentBusy,
  error: attachmentError,
  add,
  serialize,
  reset,
  remove
} = useProjectAttachments(() => props.projectId);
const images = computed(() => [...(data.value?.images || []), ...draftImages.value]);
const can = id => props.permissions.includes(id) && (data.value?.release?.status !== "archived" || id.endsWith(".view"));
const releases = useResource(() => appApi(`/projects/${props.projectId}/releases?includeArchived=true`));
const transitions = computed(() => (data.value?.availableTransitions || []).filter(t => can(t.permission)));
const selectedTransition = computed(() => transitions.value.find(item => item.id === nextStatus.value));
const extraDetails = computed(() => issueDetailFields(data.value?.type, data.value?.workflow?.definition, data.value || {})
    .filter(([key]) => data.value?.type === "bug" ? key === "acceptanceCriteria" : key !== "acceptanceCriteria"));

function edit() {
  reset();
  draftVersion.value++;
  baseline.value = JSON.parse(JSON.stringify(data.value));
  latest.value = null;
  Object.assign(form, data.value);
  form.watcherIds = [...data.value.watcherIds];
  form.acceptanceCriteria = [...data.value.acceptanceCriteria];
  editing.value = true;
}

function cancelEdit() {
  reset();
  draftVersion.value++;
  editing.value = false;
  latest.value = null;
}

async function attach({files, insert}) {
  const markdown = await add(files);
  if (markdown) insert(markdown);
}

function removeFile(id) {
  removeAttachmentLinks(form, `/api/projects/${props.projectId}/files/${id}`);
  remove(id);
}

function loadLatest() {
  return perform(() => appApi(endpoint), value => {
    latest.value = value;
  }, "");
}

function resolve(values) {
  Object.assign(form, values, {revision: latest.value.revision});
  baseline.value = latest.value;
  data.value = {...data.value, ...latest.value};
  latest.value = null;
  error.value = "";
}

function discardDraft() {
  reset();
  draftVersion.value++;
  resolve(latest.value);
}

function submit() {
  if (latest.value || attachmentBusy.value || saving.value) return;
  const input = {
    revision: form.revision, ...issueFieldsInput(form, {
      edit: can("issue.edit"),
      assign: can("issue.assign")
    }), ...(can("issue.edit") ? {attachments: serialize()} : {})
  };
  return save(endpoint, input, value => {
    data.value = {...data.value, ...value};
    cancelEdit();
    filesVersion.value++;
    emit("changed");
  });
}

function transition() {
  return save(`${endpoint}/transition`, {
    transitionId: nextStatus.value,
    reason: reason.value,
    revision: data.value.revision, ...(selectedTransition.value?.assignment === "selection" && nextHandler.value ? {handlerId: nextHandler.value} : {})
  }, value => {
    data.value = {...data.value, ...value};
    nextStatus.value = "";
    reason.value = "";
    emit("changed");
  });
}

function assignHandler() { return save(endpoint + '/step/assign', { revision: data.value.revision, handlerId: handlerId.value }, () => { assigningHandler.value = false; handlerId.value = ''; void reload(); emit('changed'); }); }
function person(id) {
  return data.value?.people?.find(p => p.id === id)?.displayName || translate(id ? "历史成员" : "未分派");
}
</script>
<template>
  <article class="issue-detail">
    <FeedbackMessage :message="error" type="error"/>
    <FeedbackMessage :message="notice" type="success"/>
    <p v-if="loading && !data" role="status">{{ $t("正在读取事项…") }}</p>
    <button v-if="error && !data" :disabled="loading" @click="reload">{{ $t("重试读取事项") }}</button>
    <template v-if="data">
      <button class="ui-back issue-back" :disabled="saving || developmentBusy" @click="emit('back')">
        <ArrowLeftOutlined aria-hidden="true"/>
        {{ $t('返回事项') }}
      </button>
      <header class="project-heading issue-detail-heading">
        <div class="issue-title">
          <h1>{{ data.title }}</h1>
          <p class="issue-identity"><span class="issue-type" :class="{ 'issue-type-bug': data.type === 'bug' }">{{
              data.type === 'bug' ? $t('缺陷') : $t("需求")
            }}</span><IssueStatusBadge :issue="data" /><span>#{{ data.number }}</span>
            <template v-if="projectName"><span aria-hidden="true">·</span><span>{{ projectName }}</span></template>
            <template v-if="data.updatedAt"><span
                aria-hidden="true">·</span><span>{{ $t('更新于 {date}', {date: formatDate(data.updatedAt)}) }}</span>
            </template>
          </p>
        </div>
        <div class="actions issue-heading-actions">
          <button v-if="editing && can('session.start')" disabled>{{ $t('认领') }}</button>
          <button v-if="!editing && (can('issue.edit') || can('issue.assign'))" @click="edit">
            <EditOutlined aria-hidden="true"/>
            {{ $t("编辑事项") }}
          </button>
          <IssueDeleteAction v-if="!editing && can('issue.delete')" :project-id="projectId" :issue="data" :disabled="saving || developmentBusy" @deleted="emit('deleted', $event)" @refresh="reload" />
        </div>
      </header>
      <p v-if="data.release?.status === 'archived'" class="warning">{{ $t("版本已归档，内容只读。") }}</p>
      <FeedbackMessage :message="releases.error.value" type="error"/>
      <button v-if="releases.error.value" :disabled="releases.loading.value" @click="releases.reload">
        {{ $t("重新读取版本") }}
      </button>
      <div class="issue-detail-grid" :class="{ 'issue-detail-editing': editing }">
        <div class="issue-detail-main">
          <section v-if="editing" class="issue-panel issue-content" :aria-label="$t('编辑事项')">
            <h3 class="issue-panel-heading">
              <EditOutlined aria-hidden="true"/>
              {{ $t("编辑事项") }}
            </h3>
            <EditConflict v-if="latest" :key="latest.revision" :base="baseline" :draft="form" :latest="latest"
                          :people="data.people" @resolve="resolve" @discard="discardDraft"/>
            <form class="project-form" @submit.prevent="submit">
              <IssueFields :model-value="form" :type="data.type" :workflow="data.workflow?.definition"
                           :can-edit="can('issue.edit')" :can-assign="can('issue.assign')" :disabled="saving"
                           :context-key="`${projectId}/${issueId}/${draftVersion}`" :members="data.members"
                           :releases="releases.data.value?.items || []" :images="images" :attachments="pending"
                           :attachment-error="attachmentError" :attachment-busy="attachmentBusy"
                           @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile"/>
              <p v-if="!can('issue.assign') && missingIssueResponsibilities(form)" class="warning" role="status">{{ $t('此事项缺少必填负责人，请联系有事项分派权限的成员补齐。') }}</p>
              <div class="actions">
                <button type="submit" class="primary" :disabled="saving || attachmentBusy || Boolean(latest) || (!can('issue.assign') && missingIssueResponsibilities(form))">
                  {{ saving ? $t("正在保存…") : $t("保存事项") }}
                </button>
                <button type="button" :disabled="saving" @click="cancelEdit">{{ $t("取消编辑") }}</button>
                <button type="button" :disabled="loading || saving || attachmentBusy" @click="loadLatest">
                  {{ $t("保留草稿，加载最新内容") }}
                </button>
              </div>
            </form>
          </section>
          <section v-else class="issue-panel issue-content issue-prose"
                   :aria-label="data.type === 'bug' ? $t('Bug 信息') : $t('需求内容')">
            <h3 class="issue-panel-heading">
              <FileTextOutlined aria-hidden="true"/>
              {{ data.type === 'bug' ? $t("Bug 信息") : $t("需求内容") }}
            </h3>
            <div class="issue-content-body">
              <section class="issue-content-block"><h4>{{
                  data.type === 'bug' ? $t('问题描述') : $t('目标与背景')
                }}</h4>
                <MarkdownContent v-if="data.description" :content="data.description" :images="data.images || []"/>
                <p v-else class="muted">{{ $t("暂无描述。") }}</p></section>
              <section v-if="data.type === 'requirement'" class="issue-content-block"><h4>{{ $t("验收标准") }}</h4>
                <AcceptanceCriteriaList :items="data.acceptanceCriteria" :images="data.images || []" /></section>
              <template v-else>
                <section class="issue-content-block"><h4>{{ $t("复现步骤") }}</h4>
                  <MarkdownContent v-if="data.reproductionSteps" :content="data.reproductionSteps"
                                   :images="data.images || []"/>
                  <p v-else class="muted">{{ $t("尚未填写。") }}</p></section>
                <div class="issue-result-grid">
                  <section v-for="[key, label] in [['expectedResult', '预期结果'], ['actualResult', '实际结果']]"
                           :key="key" class="issue-content-block"><h4>{{ $t(label) }}</h4>
                    <MarkdownContent v-if="data[key]" :content="data[key]" :images="data.images || []"/>
                    <p v-else class="muted">{{ $t("尚未填写。") }}</p></section>
                </div>
              </template>
              <section v-for="[key, label] in extraDetails" :key="key" class="issue-content-block"><h4>{{
                  $t(label)
                }}</h4>
                <AcceptanceCriteriaList v-if="key === 'acceptanceCriteria'" :items="data[key]" :images="data.images || []" />
                <MarkdownContent v-else-if="data[key]" :content="data[key]" :images="data.images || []"/>
                <p v-else class="muted">{{ $t("尚未填写。") }}</p></section>
            </div>
          </section>
          <ProjectFiles :key="filesVersion" class="issue-panel issue-files" :endpoint="endpoint"
                        :can-edit="can('issue.edit') && !editing" :title="editing ? '附件' : '参考资料'"
                        @uploaded="reload"/>
          <IssueDiscussion @changed="reload(); emit('changed')" prototype-layout class="issue-panel issue-discussion" :endpoint="endpoint"
                           :delivery-submission="data.deliverySubmission"
                           :status-names="Object.fromEntries((data.workflow?.definition.nodes || []).map(node => [node.id, node.name]))"
                           :permissions="data.release?.status === 'archived' ? permissions.filter(p => p.endsWith('.view')) : permissions"/>
        </div>
        <aside class="issue-detail-sidebar" :aria-label="$t('事项操作与资料')">
          <section v-if="!editing" class="issue-panel issue-status" :aria-label="$t('当前操作')">
            <h3 class="issue-panel-heading">
              <SwapOutlined aria-hidden="true"/>
              {{ $t("当前操作") }}
            </h3>
            <p class="issue-current-status"><span class="muted">{{ $t("当前状态") }}</span><IssueStatusBadge :issue="data" /></p>
            <p v-if="data.processing" class="field-hint">{{ $t('当前处理人') }}：{{ person(data.processing.handlerId) }}
              · {{
                $t(data.processing.needsAssignment ? '等待分派处理人' : data.processing.status === 'active' ? '处理中' : '待开始')
              }}</p>
            <div class="issue-current-actions">
              <button v-if="can('deliverable.create') && data.deliverySubmission?.allowed" class="primary" :disabled="saving || developmentBusy" @click="publishing = true">{{ data.deliverySubmission.label }}</button>
          <button v-if="can('issue.assign')"
                  :disabled="saving || developmentBusy || editing || Boolean(data.development) || !data.assignmentAllowed"
                  @click="emit('assign-development', data)">
            <UserAddOutlined aria-hidden="true"/>
            {{ $t("指派") }}
          </button>
              <button v-if="!data.development && can('session.start')" :disabled="saving || developmentBusy || !data.assignmentAllowed" @click="emit('start-development', data)">{{ $t('认领') }}</button>
              <RouterLink v-if="data.development" :to="{ path: `/projects/${projectId}`, query: { tab: 'tasks', task: data.development.taskId } }">{{ $t('查看开发任务') }}</RouterLink>
            </div>
            <button v-if="can('issue.assign') && data.processing && data.processing.category !== 'development' && !data.workflowActions?.some(edge => edge.trigger.startsWith('verification.'))" :disabled="saving" @click="assigningHandler = !assigningHandler">{{ $t('重新分派处理人') }}</button>
            <form v-if="assigningHandler" class="project-form" @submit.prevent="assignHandler"><label>{{ $t('当前处理人') }}<AppSelect search-pinyin v-model="handlerId" :aria-label="$t('重新分派处理人')" required :disabled="saving"><option value="" disabled>{{ $t('选择处理人') }}</option><option v-for="person in data.members" :key="person.userId" :value="person.userId">{{ person.displayName }}（{{ person.username }}）</option></AppSelect></label><button :disabled="saving || !handlerId" type="submit">{{ $t('确认分派') }}</button></form>
            <form v-if="transitions.length" class="project-form" @submit.prevent="transition">
              <label>{{ $t("目标状态") }}
                <AppSelect native-events v-model="nextStatus" :aria-label="$t('目标状态')" :disabled="saving" required>
                  <option value="" disabled>{{ $t("选择目标状态") }}</option>
                  <option v-for="t in transitions" :key="t.id" :value="t.id">{{ t.statusName }} · {{ t.name }}</option>
                </AppSelect>
              </label>
              <label v-if="selectedTransition?.assignment === 'selection' && !selectedTransition.terminal">{{
                  $t('下一处理人')
                }}
                <AppSelect search-pinyin v-model="nextHandler" :aria-label="$t('下一处理人')" :disabled="saving">
                  <option value="">{{ $t('采用目标节点职责') }}</option>
                  <option v-for="person in data.members" :key="person.userId" :value="person.userId">
                    {{ person.displayName }}（{{ person.username }}）
                  </option>
                </AppSelect>
              </label>
              <p v-else-if="selectedTransition && !selectedTransition.terminal" class="field-hint">{{
                  $t('下一处理人')
                }}：{{ person(selectedTransition.nextHandlerId) }}</p>
              <label v-if="nextStatus">{{ $t("原因") }}<textarea v-model="reason" rows="2" :disabled="saving"
                                                                 :required="Boolean(transitions.find(t => t.id === nextStatus)?.requiresReason)"/></label>
              <button class="primary" type="submit" :disabled="saving || !nextStatus">
                {{ saving ? $t("正在更新…") : selectedTransition?.name || $t("更新状态并交接") }}
              </button>
            </form>
            <p v-if="data.workflowActions?.some(edge => edge.trigger.startsWith('verification.'))" class="field-hint">
              {{ $t('在交付详情中验证，结论会同步更新事项。') }}</p>
            <RouterLink v-if="data.workflowActions?.some(edge => edge.trigger.startsWith('verification.'))"
                        :to="{ name: 'deliveries', query: { projectId } }">{{ $t('查看交付与验收') }}
            </RouterLink>
          </section>
          <IssueAssignment v-if="!editing" :issue="data" />
          <IssueInformation v-if="!editing" :issue="data" :project-name="projectName" />
          <section v-if="!editing && data.workflow" class="issue-panel issue-workflow" :aria-label="$t('流程版本')">
            <h3 class="issue-panel-heading">{{ $t('流程版本') }}</h3>
            <p class="field-hint">v{{ data.workflow.version }}</p>
            <button v-if="data.workflow.latestPublishedVersion > data.workflow.version && can('issue.assign') && can('issue.transition') && data.processing?.status === 'ready'" :disabled="saving" @click="upgrading = true">{{ $t('采用新流程版本') }} · v{{ data.workflow.latestPublishedVersion }}</button>
          </section>
          <p v-if="!editing" class="issue-sharing-hint field-hint">
            {{ $t('事项与交付在项目内共享。个人会话与代码保留在执行者自己的空间。') }}</p>
        </aside>
      </div>
    </template>
    <IssueWorkflowUpgrade v-if="upgrading" :project-id="projectId" :issue-id="issueId" @close="upgrading = false" @upgraded="upgrading = false; reload(); emit('changed')" />
    <PublishDelivery v-if="publishing && data" :project-id="projectId" :issue-id="issueId"
                     :task-id="data.development?.taskId" @close="publishing = false"
                     @published="publishing = false; reload(); emit('changed')"/>
  </article>
</template>

<style scoped>
.issue-current-actions { display: grid; gap: 10px; margin: 20px 0; }
.issue-current-actions > button { width: 100%; }
.issue-current-actions > a { text-align: center; padding: 10px 0; }
.issue-detail-sidebar > .issue-assignment { order: -3; }
.issue-detail-sidebar > .issue-status { order: -4; border-top: 0; padding-top: 0; }
.issue-detail-sidebar > .issue-information { order: 0; border-top: 1px solid var(--line); padding-top: 24px; }
.issue-workflow { border-top: 1px solid var(--line); padding-top: 24px; }
@media (max-width: 1000px) {
  .issue-detail-grid:not(.issue-detail-editing) .issue-detail-main,
  .issue-detail-grid:not(.issue-detail-editing) .issue-detail-sidebar { display: contents; }
  .issue-detail-sidebar > .issue-assignment { order: -1; }
  .issue-detail-sidebar > .issue-status { order: -2; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
  .issue-detail-sidebar > .issue-information { order: -1; }
  .issue-workflow, .issue-sharing-hint { order: 2; }
}
</style>
