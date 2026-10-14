<script setup>
import { computed, onUnmounted, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import { createRequestId } from "../../shared/api/request-id.js";
import FormSection from "../../shared/components/FormSection.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import ManualDevelopmentContent from "./ManualDevelopmentContent.vue";
import AgentModelSettings from "../../shared/components/AgentModelSettings.vue";
import { taskTypes } from "./task-metadata.js";

const props = defineProps({ projectId: { type: String, required: true } });
const emit = defineEmits(["started", "cancel", "open-record"]);
const endpoint = `/projects/${props.projectId}/tasks/manual`;
const requestId = createRequestId();
const form = reactive({ title: "", content: "", images: [], taskType: "other", baseBranch: "",
  model: accountSession.settings.model || "", reasoningEffort: accountSession.settings.reasoningEffort || "",
  permissionMode: accountSession.settings.permissionMode || "ask" });
const starting = ref(false), uploading = ref(false), permissionsReady = ref(false), uncertain = ref(false),
  accepted = ref(null), error = ref("");
const attachmentsReady = ref(true);
const locked = computed(() => starting.value || uncertain.value || Boolean(accepted.value));
let alive = true;
onUnmounted(() => { alive = false; });
function received(task) {
  if (!alive) return;
  uncertain.value = false;
  if (task.status === "started" && task.runKey) emit("started", task.runKey);
  else {
    accepted.value = task;
    error.value = task.error || "启动请求已受理，结果尚未确定。请查看原任务记录，不要重复启动。";
  }
}
async function check() {
  if (!alive || starting.value) return;
  starting.value = true;
  try {
    const result = await appApi(`${endpoint}?requestId=${requestId}`);
    if (!alive) return;
    if (result.task) received(result.task);
    else { uncertain.value = false; error.value = "未找到已受理的启动记录，内容已保留，可重试启动。"; }
  } catch (failure) {
    if (alive) { uncertain.value = true; error.value = `无法确认启动结果：${failure.message}。请检查启动结果后再操作。`; }
  } finally { if (alive) starting.value = false; }
}
async function start() {
  if (!alive || locked.value || uploading.value || !permissionsReady.value || !attachmentsReady.value || !form.baseBranch) return;
  if (!form.content.trim() && !form.images.length) { error.value = "请填写开发目标或上传图片。"; return; }
  starting.value = true;
  error.value = "";
  try {
    const result = await appApi(endpoint, { requestId, ...form, images: [...form.images] });
    if (alive) received(result.task);
  } catch (failure) {
    if (!alive) return;
    error.value = failure.message;
    // A lost response may follow accepted dispatch. Only read its recorded result.
    try {
      const result = await appApi(`${endpoint}?requestId=${requestId}`);
      if (!alive) return;
      if (result.task) received(result.task);
    } catch {
      if (alive) { uncertain.value = true; error.value += "；无法确认是否已启动，请先检查启动结果。"; }
    }
  } finally { if (alive) starting.value = false; }
}
</script>

<template>
  <section class="page-layout manual-development-start">
    <header class="page-heading"><h1>{{ $t("手动开启开发") }}</h1><p>{{ $t("在当前项目中直接启动独立开发，不关联需求或 Bug。填写内容仅在点击启动后提交。") }}</p></header>
    <a-form :model="form" :rules="{ title: [{ required: true, whitespace: true, message: '请填写任务标题' }] }" layout="vertical" @finish="start">
      <FormSection :title="$t('开发目标')">
        <label>{{ $t("任务类型") }}<select v-model="form.taskType" :aria-label="$t('任务类型')" :disabled="locked || uploading"><option v-for="entry in taskTypes" :key="entry.value" :value="entry.value">{{ $t(entry.label) }}</option></select></label>
        <a-form-item :label="$t('任务标题')" name="title"><input v-model="form.title" :aria-label="$t('任务标题')" maxlength="200" :disabled="locked" required :placeholder="$t('例如：新增登录入口')" /></a-form-item>
        <ManualDevelopmentContent v-model="form.content" v-model:image-ids="form.images" :disabled="locked"
          @uploading="uploading = $event" @validity-change="attachmentsReady = $event" />
      </FormSection>
      <FormSection :title="$t('起始分支')"><slot name="branch-select" :value="form.baseBranch" :disabled="locked || uploading" :update="value => form.baseBranch = value" /></FormSection>
      <AgentModelSettings v-model:model="form.model" v-model:reasoning-effort="form.reasoningEffort" v-model:permission-mode="form.permissionMode" :disabled="locked || uploading" @validity-change="permissionsReady = $event" />
      <FeedbackMessage :message="error" type="error" />
      <p v-if="uncertain" role="status">{{ $t("正在确认原启动请求；检查结果只读取记录，不会再次执行。") }}</p>
      <p v-if="accepted" role="status">{{ $t("启动请求已记录，结果需要确认。") }}{{ accepted.error || $t("请查看原开发任务记录，不要重复启动。") }}</p>
      <div class="actions page-actions">
        <button type="button" :disabled="starting || uploading" @click="emit('cancel')">{{ accepted || uncertain ? $t("返回会话") : $t("取消") }}</button>
        <button v-if="accepted" type="button" class="primary" :disabled="starting" @click="emit('open-record', accepted.id)">{{ $t("查看开发任务记录") }}</button>
        <button v-else-if="uncertain" type="button" class="primary" :disabled="starting" @click="check">{{ starting ? $t("正在检查…") : $t("检查启动结果") }}</button>
        <button v-else class="primary" type="submit" :disabled="locked || uploading || !attachmentsReady || !permissionsReady || !form.baseBranch">{{ starting ? $t("正在启动…") : $t("启动独立开发") }}</button>
      </div>
    </a-form>
  </section>
</template>

<style scoped>
.manual-development-start { width: 100%; max-width: 1040px; margin-inline: auto; }
.page-heading { margin-bottom: 32px; }
.page-heading h1 { font-size: clamp(24px, 2.2vw, 32px); font-weight: 600; letter-spacing: -.02em; }
.page-heading p { max-width: 640px; line-height: 1.8; }
.manual-development-start > :deep(.ant-form) { padding: 0 32px 24px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
.manual-development-start :deep(.form-section) { margin: 0; padding: 28px 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; box-shadow: none; }
.manual-development-start :deep(.form-section-heading) { margin-bottom: 24px; }
.manual-development-start :deep(.form-section-heading h2) { font-size: 16px; }
.page-actions { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); gap: 12px; }
@media (max-width: 767px) {
  .page-heading { margin-bottom: 24px; }
  .manual-development-start > :deep(.ant-form) { padding: 0 16px 20px; }
  .manual-development-start :deep(.form-section) { padding-block: 22px; }
  .page-actions { flex-wrap: wrap; }
  .page-actions > button { min-height: 44px; }
}
</style>
