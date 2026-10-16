<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
const props = defineProps({ projectId: { type: String, required: true }, issueIds: { type: Array, required: true }, assign: Boolean });
const emit = defineEmits(["closed", "planned"]);
const executorId = ref(""), visible = ref(true);
const requestId = createRequestId();
const { data, loading, saving, error, reload, save } = useResource(async () => { const [members, ...issues] = await Promise.all([props.assign ? appApi(`/projects/${props.projectId}/members`) : { members: [] }, ...props.issueIds.map(id => appApi(`/projects/${props.projectId}/issues/${id}`))]); return { members: members.members, issues }; });
const members = computed(() => (data.value?.members || []).filter(m => m.status === "active" && m.userStatus === "active" && m.effectivePermissions?.includes("session.start")));
function close() { if (!saving.value) { visible.value = false; emit("closed"); } }
function submit() { return save(`/projects/${props.projectId}/tasks`, { requestId, issueIds: props.issueIds, ...(props.assign ? { executorId: executorId.value } : {}) }, result => { visible.value = false; emit("planned", result.tasks); }, "已加入负责人的待开发任务，可在任务列表多选合并。"); }
</script>
<template>
  <ModalDialog :open="visible" :title="assign ? $t('指派') : $t('认领')" @close="close">
    <FeedbackMessage :message="error" type="error" /><p v-if="loading" role="status">{{ $t('正在读取事项…') }}</p><button v-if="error" :disabled="loading || saving" @click="reload">{{ $t('重新读取') }}</button>
    <form id="plan-development" class="project-form" @submit.prevent="submit">
      <ul><li v-for="issue in data?.issues" :key="issue.id">#{{ issue.number }} {{ issue.title }} · {{ issue.release?.name || $t('未排期') }}</li></ul>
      <label v-if="assign">{{ $t('开发负责人') }}<AppSelect search-pinyin native-events :aria-label="$t('开发负责人')" v-model="executorId" required :disabled="saving || loading"><option value="" disabled>{{ $t('选择开发负责人') }}</option><option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}（{{ member.username }}）</option></AppSelect></label>
      <p class="field-hint">{{ $t('每条事项分别加入负责人的待开发任务。同项目、同版本的待开发任务可在任务列表多选合并，准备好后再启动 Codex。') }}</p>
    </form>
    <template #footer><button type="button" :disabled="saving" @click="close">{{ $t('取消') }}</button><button class="primary" type="submit" form="plan-development" :disabled="saving || loading || !data || assign && !executorId">{{ saving ? $t('正在保存…') : $t(assign ? '确认指派' : '确认认领') }}</button></template>
  </ModalDialog>
</template>
