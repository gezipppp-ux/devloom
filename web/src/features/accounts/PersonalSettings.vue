<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { reactive, ref } from "vue";
import { UserOutlined, BellOutlined, ReloadOutlined } from "@antdv-next/icons";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
import { appApi } from "../../shared/api/api.js";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";
import FormSection from "../../shared/components/FormSection.vue";
import AgentModelControls from "../../shared/components/AgentModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import AccountProfile from "./AccountProfile.vue";
import PasswordForm from "./PasswordForm.vue";
import GitAccountSettings from "./GitAccountSettings.vue";
defineProps({ notifications: { type: Object, required: true } });
const form = reactive({ model: accountSession.settings.model || "", reasoningEffort: accountSession.settings.reasoningEffort || "", permissionMode: accountSession.settings.permissionMode || "ask", grouping: accountSession.settings.grouping || "type" });
const models = useModelCatalog((url) => appApi(`/account${url}`));
const permissions = usePermissionModes((url) => appApi(`/account${url}`));
const busy = ref(false), saved = ref(false), error = ref("");
async function save() {
  if (busy.value || !permissions.isAvailable(form.permissionMode)) return;
  busy.value = true; saved.value = false; error.value = "";
  try {
    await saveAccountSettings({ ...form, model: form.model || null, reasoningEffort: form.reasoningEffort || null });
    saved.value = true;
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">PERSONAL</div><h1><UserOutlined aria-hidden="true" /> 个人设置</h1><p>设置你的执行默认值与提醒偏好，在不同设备登录后保持一致。</p></header>
    <AccountProfile />
    <FormSection title="新任务默认值" description="创建任务时自动填入，单个任务仍可独立调整。已有会话保持原设置。">
      <template #action><button type="button" class="text-button" :disabled="models.loading.value" @click="models.refresh"><ReloadOutlined aria-hidden="true" />刷新模型列表</button></template>
      <a-form :model="form" layout="vertical" @finish="save">
        <AgentModelControls :agent-label="permissions.agent.value?.label || 'Agent'" :model="form.model" :reasoning-effort="form.reasoningEffort" :models="models.models.value" :loading="models.loading.value" :disabled="busy" @change="Object.assign(form, $event)" />
        <FeedbackMessage :message="models.error.value ? `模型列表加载失败：${models.error.value}。当前选择会保留。` : ''" type="error" />
        <a-form-item label="默认执行权限"><PermissionSelect v-model="form.permissionMode" :options="permissions.permissionModes.value" :disabled="busy" refreshable :refreshing="permissions.loading.value" @refresh="permissions.refresh" /></a-form-item>
        <FeedbackMessage :message="permissions.error.value" type="error" />
        <p v-if="!permissions.loading.value && !permissions.error.value && !permissions.isAvailable(form.permissionMode)" class="error" role="alert">当前权限模式不可用，请选择可用的权限模式后保存。</p>
        <a-form-item label="默认任务分组"><select v-model="form.grouping" aria-label="默认任务分组" :disabled="busy"><option value="type">按类型</option><option value="progress">按进度</option><option value="none">不分组</option></select></a-form-item>
        <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="saved ? '个人设置已保存。' : ''" type="success" />
        <button type="submit" class="primary" :disabled="busy || !permissions.isAvailable(form.permissionMode)">{{ busy ? "正在保存…" : "保存个人设置" }}</button>
      </a-form>
    </FormSection>
    <FormSection title="桌面通知" description="Codex 返回未读结果时提醒你。每台设备仍需单独允许浏览器通知。">
      <button v-if="notifications.available.value" :disabled="notifications.busy.value" @click="notifications.toggle"><BellOutlined aria-hidden="true" />{{ notifications.enabled.value && notifications.permission.value === 'granted' ? '关闭桌面通知' : '开启桌面通知' }}</button>
      <p v-else class="muted">当前浏览器不支持系统桌面通知。</p>
      <p v-if="notifications.permission.value === 'denied'" class="field-hint">浏览器已拦截通知，请在网站权限中允许后重试。</p>
      <FeedbackMessage :message="notifications.error.value" type="error" />
    </FormSection>
    <GitAccountSettings />
    <FormSection title="账号安全" description="修改登录密码。"><PasswordForm /></FormSection>
  </section>
</template>
