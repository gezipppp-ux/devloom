<script setup>
import { ref, watch } from "vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";

const props = defineProps({ projectId: { type: String, required: true }, issueId: { type: String, required: true } });
const emit = defineEmits(["close", "upgraded"]);
const endpoint = `/projects/${props.projectId}/issues/${props.issueId}/workflow-upgrade`;
const { data, loading, saving, error, reload, save } = useResource(() => appApi(endpoint));
const reason = ref(""), confirmed = ref(false), requestId = ref(createRequestId());
watch(data, () => { confirmed.value = false; requestId.value = createRequestId(); });
watch(reason, () => { requestId.value = createRequestId(); });
function close() { if (!saving.value) emit("close"); }
function submit() {
  if (!data.value?.available || !confirmed.value || !reason.value.trim() || loading.value) return;
  const { issueRevision, actionRevision, targetVersionId, tasks } = data.value;
  return save(endpoint, { requestId: requestId.value, issueRevision, actionRevision, targetVersionId, tasks, reason: reason.value }, () => emit("upgraded"), "事项已采用新流程版本，原有历史已保留。");
}
</script>

<template>
  <ModalDialog open :title="$t('采用新流程版本')" @close="close">
    <FeedbackMessage :message="error" type="error" />
    <p v-if="loading" role="status">{{ $t('正在核对流程与关联任务…') }}</p>
    <p v-if="data && !data.available" class="warning">{{ data.reason }}</p>
    <form v-if="data?.available" id="issue-workflow-upgrade" class="project-form" @submit.prevent="submit">
      <div class="workflow-version-change"><span>{{ $t('流程版本') }}</span><strong>v{{ data.currentVersion }} <span aria-hidden="true">→</span> v{{ data.targetVersion }}</strong></div>
      <p>{{ $t('当前步骤') }}：{{ data.statusName }} → {{ data.targetStatusName }}</p>
      <p>{{ $t('当前处理人') }}：{{ data.people.find(person => person.id === data.handlerId)?.displayName }}</p>
      <p>{{ $t('保留事项、关联任务和原版本历史。切换流程不会启动开发或提交交付。') }}</p>
      <label>{{ $t('切换原因') }}<textarea v-model="reason" rows="3" maxlength="4000" required :disabled="saving" /></label>
      <label class="ui-check-row"><input v-model="confirmed" type="checkbox" :disabled="saving" /><span>{{ $t('我已核对以上版本、步骤和处理人。') }}</span></label>
    </form>
    <template #footer>
      <button type="button" :disabled="saving || loading" @click="reload">{{ $t('重新预览') }}</button>
      <button type="button" :disabled="saving" @click="close">{{ $t('取消') }}</button>
      <button v-if="data?.available" class="primary" type="submit" form="issue-workflow-upgrade" :disabled="saving || loading || !confirmed || !reason.trim()">{{ $t(saving ? '正在更新…' : '确认采用新流程') }}</button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.workflow-version-change { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; padding: 18px; border-radius: var(--radius-control); background: var(--soft); }
.workflow-version-change strong { color: var(--highlight); }
.project-form .ui-check-row { flex-direction: row; }
</style>
