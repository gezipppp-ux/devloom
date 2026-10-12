<script setup>
import { computed, onMounted, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
const props = defineProps({ projectId: { type: String, required: true }, issueIds: { type: Array, required: true }, assign: Boolean });
const emit = defineEmits(["closed", "planned"]);
const dialog = ref(), title = ref(""), executorId = ref("");
const requestId = createRequestId();
const { data, loading, saving, error, reload, save } = useResource(async () => { const [members, ...issues] = await Promise.all([props.assign ? appApi(`/projects/${props.projectId}/members`) : { members: [] }, ...props.issueIds.map(id => appApi(`/projects/${props.projectId}/issues/${id}`))]); return { members: members.members, issues }; }, { immediate: false });
const members = computed(() => (data.value?.members || []).filter(m => m.status === "active" && m.userStatus === "active" && m.effectivePermissions?.includes("session.start")));
function close() { if (!saving.value) { dialog.value.close(); emit("closed"); } }
function submit() { return save(`/projects/${props.projectId}/tasks`, { requestId, issueIds: props.issueIds, ...(title.value.trim() ? { title: title.value.trim() } : {}), ...(props.assign ? { executorId: executorId.value } : {}) }, result => { dialog.value.close(); emit("planned", result.task); }, "已创建待开发任务。执行人可在任务页准备环境并开始开发。"); }
onMounted(() => { dialog.value.showModal(); void reload(); });
</script>
<template><dialog ref="dialog" class="workspace-dialog" aria-labelledby="plan-title" @cancel.prevent="close"><div class="workspace-dialog-heading"><h2 id="plan-title">{{ assign ? '指派开发任务' : '认领到开发任务' }}</h2><button :disabled="saving" @click="close">取消</button></div><FeedbackMessage :message="error" type="error" /><p v-if="loading" role="status">正在读取事项…</p><button v-if="error" :disabled="loading || saving" @click="reload">重新读取</button><form class="project-form" @submit.prevent="submit"><ul><li v-for="issue in data?.issues" :key="issue.id">#{{ issue.number }} {{ issue.title }} · {{ issue.release?.name || '未排期' }}</li></ul><label>任务标题（可选）<input v-model="title" maxlength="200" :disabled="saving" /></label><label v-if="assign">开发执行人<select v-model="executorId" required :disabled="saving || loading"><option value="" disabled>选择开发执行人</option><option v-for="member in members" :key="member.userId" :value="member.userId">{{ member.displayName }}（{{ member.username }}）</option></select></label><p class="field-hint">事项必须属于同一版本，且未被其他活跃任务认领。此步骤无需 Git 环境，不会创建工作树或启动 Agent。</p><div class="actions"><button class="primary" :disabled="saving || loading || !data">{{ saving ? '正在保存…' : '保存待开发任务' }}</button><button type="button" :disabled="saving" @click="close">返回</button></div></form></dialog></template>
