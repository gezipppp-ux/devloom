<script setup>
import { computed, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeftOutlined } from "@antdv-next/icons";
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { createRequestId } from "../../shared/api/request-id.js";
import IssueFields from "./IssueFields.vue";
import { emptyIssue, issueFieldsInput, removeAttachmentLinks } from "./issue-fields.js";
import { useProjectAttachments } from "./use-project-attachments.js";
import "../../shared/styles/issue-creation.css";

const props = defineProps({ projectId: { type: String, required: true }, projectName: { type: String, required: true }, type: { type: String, required: true }, permissions: { type: Array, required: true } });
const route = useRoute(), router = useRouter();
const form = reactive(emptyIssue()), requestId = createRequestId();
const can = permission => props.permissions.includes(permission);
const title = computed(() => props.type === "bug" ? "新建 Bug" : "新建需求");
const { saving, error, save } = useResource(() => null, { immediate: false });
const { pending, images, busy: attachmentBusy, error: attachmentError, add, serialize, remove } = useProjectAttachments(() => props.projectId);
const members = useResource(() => can("issue.assign") ? appApi(`/projects/${props.projectId}/members`) : { members: [] });
const activeMembers = computed(() => (members.data.value?.members || []).filter(member => member.status === "active" && member.userStatus === "active"));
const releases = useResource(() => appApi(`/projects/${props.projectId}/releases?includeArchived=true`));
const workflow = useResource(() => appApi(`/projects/${props.projectId}/issue-workflows/${props.type}`));
const publishedVersion = computed(() => workflow.data.value?.workflow?.versions.find(version => version.version === workflow.data.value.workflow.publishedVersion));
const publishedWorkflow = computed(() => publishedVersion.value?.definition);
watch(() => props.type, () => { workflow.data.value = null; void workflow.reload(); });
watch(() => can("issue.assign"), () => { members.data.value = null; void members.reload(); });
const returnLocation = computed(() => {
  const value = route.query.returnTo;
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    const target = router.resolve(value);
    if (!target.query.create && (target.name === "project" && target.params.projectId === props.projectId || ["workspace", "issues"].includes(target.name))) return target;
  }
  return router.resolve({ name: "project", params: { projectId: props.projectId }, query: { tab: props.type === "bug" ? "bugs" : "issues" } });
});
function changeType(value) {
  if (saving.value || attachmentBusy.value || !can("issue.create")) return;
  void router.replace({ query: { ...route.query, tab: value === "bug" ? "bugs" : "issues" } });
}
function cancel() { if (!saving.value) void router.replace(returnLocation.value.fullPath); }
async function attach({ files, insert }) { const markdown = await add(files); if (markdown) insert(markdown); }
function removeFile(id) { removeAttachmentLinks(form, `/api/projects/${props.projectId}/files/${id}`); remove(id); }
function create() {
  if (saving.value || attachmentBusy.value || !can("issue.create") || !can("issue.assign")) return;
  const location = route.fullPath, type = props.type;
  const query = returnLocation.value.name === "project" ? returnLocation.value.query : {};
  return save(`/projects/${props.projectId}/issues`, { requestId, type, ...issueFieldsInput(form, { assign: can("issue.assign") }), attachments: serialize() }, issue => {
    if (route.fullPath === location) void router.replace({ name: "project", params: { projectId: props.projectId }, query: { ...query, tab: type === "bug" ? "bugs" : "issues", issue: issue.id, create: undefined, returnTo: returnLocation.value.name === "issues" ? returnLocation.value.fullPath : undefined } });
  });
}
</script>
<template>
  <section class="issue-create-page">
    <button type="button" class="project-return-button issue-create-back" :disabled="saving" @click="cancel"><ArrowLeftOutlined aria-hidden="true" />{{ $t('返回事项') }}<span>{{ projectName }}</span></button>
    <header class="issue-create-heading"><h1>{{ $t(title) }}</h1><AppSelect :model-value="type" :aria-label="$t('事项类型')" :disabled="saving || attachmentBusy || !can('issue.create')" :options="[{ value: 'requirement', label: $t('需求') }, { value: 'bug', label: 'Bug' }]" @update:model-value="changeType" /></header>
    <FeedbackMessage :message="error || releases.error.value || workflow.error.value" type="error" />
    <div v-if="releases.error.value || workflow.error.value" class="actions"><button v-if="releases.error.value" type="button" :disabled="releases.loading.value" @click="releases.reload">{{ $t('重新读取版本') }}</button><button v-if="workflow.error.value" type="button" :disabled="workflow.loading.value" @click="workflow.reload">{{ $t('重新读取流程') }}</button></div>
    <form v-if="can('issue.create')" class="project-form issue-create-form" @submit.prevent="create">
      <IssueFields creation :model-value="form" :type="type" :workflow="publishedWorkflow" :responsibility-permissions="publishedVersion?.responsibilityPermissions" can-edit :can-assign="can('issue.assign')" :disabled="saving" :context-key="`${projectId}/new/${requestId}`" :members="activeMembers" :releases="releases.data.value?.items || []" :images="images" :attachments="pending" :attachment-error="attachmentError" :attachment-busy="attachmentBusy" @update:model-value="Object.assign(form, $event)" @files="attach" @remove="removeFile">
        <template #people-feedback><p v-if="members.loading.value" role="status">{{ $t('正在读取可分派成员…') }}</p><FeedbackMessage :message="members.error.value" type="error" /><button v-if="members.error.value" type="button" :disabled="members.loading.value" @click="members.reload">{{ $t('重试读取成员') }}</button></template>
      </IssueFields>
      <p v-if="!can('issue.assign')" class="warning" role="status">{{ $t('新建事项需指定三位负责人，请联系管理员授予事项分派权限。') }}</p>
      <footer class="issue-create-footer"><button type="button" :disabled="saving" @click="cancel">{{ $t('取消') }}</button><button class="primary" type="submit" :disabled="saving || attachmentBusy || !can('issue.assign')">{{ saving ? $t('正在保存…') : $t('保存事项') }}</button></footer>
    </form>
    <p v-else class="warning" role="status">{{ $t('当前项目只读或你没有新建事项权限。') }}</p>
  </section>
</template>
