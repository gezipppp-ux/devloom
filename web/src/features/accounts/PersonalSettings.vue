<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { usePageTitle } from "../../shared/components/page-title.js";
import { translate } from "../../shared/i18n/index.js";
import { computed, reactive, ref } from "vue";
import { UserOutlined, ReloadOutlined, BranchesOutlined, ApiOutlined, LockOutlined } from "@antdv-next/icons";
import { accountSession, saveAccountSettings } from "../../shared/api/account-session.js";
import { appApi } from "../../shared/api/api.js";
import { useModelCatalog } from "../../shared/api/use-model-catalog.js";
import { usePermissionModes } from "../../shared/api/use-permission-modes.js";
import FormSection from "../../shared/components/FormSection.vue";
import AgentModelControls from "../../shared/components/AgentModelControls.vue";
import PermissionSelect from "../../shared/components/PermissionSelect.vue";
import AccountProfile from "./AccountProfile.vue";
import DesktopNotificationSettings from "./DesktopNotificationSettings.vue";
import PasswordForm from "./PasswordForm.vue";
import GitAccountSettings from "./GitAccountSettings.vue";
import McpTokenSettings from "./McpTokenSettings.vue";
import { useRoute, useRouter } from "vue-router";
import SettingsLayout from "../../shared/components/SettingsLayout.vue";
const route = useRoute(), router = useRouter();
const items = [{ id: "profile", label: "资料与偏好", icon: UserOutlined }, { id: "git", label: "Git 账号", icon: BranchesOutlined }, { id: "mcp", label: "MCP 接入", icon: ApiOutlined }, { id: "security", label: "账号安全", icon: LockOutlined }];
const currentTab = computed(() => items.some(item => item.id === route.query.tab) ? route.query.tab : "profile");
usePageTitle(() => [translate(items.find(item => item.id === currentTab.value).label), translate("个人设置")]);
function select(tab) { void router.push({ query: { ...route.query, tab: tab === "profile" ? undefined : tab } }); }
defineProps({ notifications: { type: Object, required: true } });
const form = reactive({ model: accountSession.settings.model || "", reasoningEffort: accountSession.settings.reasoningEffort || "", permissionMode: accountSession.settings.permissionMode || "ask" });
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
    <SettingsLayout :title="$t('个人设置')" :description="$t('管理你的偏好与连接，让工作更顺手。')" :label="$t('我的账号')" :items="items" :active="currentTab" @select="select">
    <div v-show="currentTab === 'profile'" class="ui-profile-settings"><header class="ui-settings-heading"><h2>{{ $t('个人资料与偏好') }}</h2><p>{{ $t('这些设置只影响你的账号。') }}</p></header>
    <div class="profile-settings-panel">
    <AccountProfile />
    <FormSection :title="$t('执行默认值')" :description="$t('创建任务时自动填入，单个任务仍可独立调整。已有会话保持原设置。')">
      <template #action><button type="button" class="text-button" :disabled="models.loading.value" @click="models.refresh"><ReloadOutlined aria-hidden="true" />{{ $t("刷新模型列表") }}</button></template>
      <a-form id="personal-defaults-form" :model="form" layout="vertical" @finish="save">
        <AgentModelControls :agent-label="permissions.agent.value?.label || 'Agent'" :model="form.model" :reasoning-effort="form.reasoningEffort" :models="models.models.value" :loading="models.loading.value" :disabled="busy" @change="Object.assign(form, $event)" />
        <FeedbackMessage :message="models.error.value ? $t('模型列表加载失败：{p0}。当前选择会保留。', { p0: models.error.value }) : ''" type="error" />
        <a-form-item :label="$t('默认执行权限')"><PermissionSelect v-model="form.permissionMode" :options="permissions.permissionModes.value" :disabled="busy" refreshable :refreshing="permissions.loading.value" @refresh="permissions.refresh" /></a-form-item>
        <FeedbackMessage :message="permissions.error.value" type="error" />
        <p v-if="!permissions.loading.value && !permissions.error.value && !permissions.isAvailable(form.permissionMode)" class="error" role="alert">{{ $t("当前权限模式不可用，请选择可用的权限模式后保存。") }}</p>
        <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="saved ? '个人设置已保存。' : ''" type="success" />
      </a-form>
    </FormSection>
    <DesktopNotificationSettings v-if="currentTab === 'profile'" :notifications="notifications" />
    <footer class="profile-settings-footer"><button type="submit" form="personal-defaults-form" class="primary" :disabled="busy || !permissions.isAvailable(form.permissionMode)">{{ busy ? $t("正在保存…") : $t("保存个人设置") }}</button></footer>
    </div>
    </div>
    <McpTokenSettings v-if="currentTab === 'mcp'" />
    <GitAccountSettings v-if="currentTab === 'git'" />
    <section v-if="currentTab === 'security'" :aria-label="$t('账号安全')">
      <header class="ui-settings-heading"><div><h2>{{ $t('账号安全') }}</h2><p>{{ $t('修改登录密码。') }}</p></div></header>
      <PasswordForm />
    </section>
    </SettingsLayout>
  </section>
</template>
<style scoped>
.profile-settings-panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.profile-settings-panel :deep(.form-section) { margin: 0; padding: 28px; border: 0; border-radius: 0; box-shadow: none; }
.profile-settings-panel :deep(.form-section + .form-section) { border-top: 1px solid var(--line); }
.profile-settings-panel :deep(.form-section-heading h2) { font-size: 18px; }
.profile-settings-panel :deep(form) { max-width: none; }
.profile-settings-panel :deep(.ant-form-item:last-child) { margin-bottom: 0; }
.profile-settings-panel :deep(.form-section-heading) { flex-wrap: wrap; }
.profile-settings-panel :deep(.section-action) { margin-left: auto; }
.profile-settings-footer { display: flex; justify-content: flex-end; border-top: 1px solid var(--line); padding: 20px 28px; }
@media (max-width: 767px) {
  .profile-settings-panel :deep(.form-section) { padding: 20px; }
  .profile-settings-panel :deep(.section-action) { margin-left: 0; }
  .profile-settings-footer { padding: 20px; }
}
</style>
