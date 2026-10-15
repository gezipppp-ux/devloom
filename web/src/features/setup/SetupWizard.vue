<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ArrowRightOutlined, CheckOutlined, TeamOutlined, CodeOutlined } from "@antdv-next/icons";
import { accountSession } from "../../shared/api/account-session.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import FormSection from "../../shared/components/FormSection.vue";
import steps from "../../../../shared/setup-steps.json";
import SetupFrame from "./SetupFrame.vue";
import SetupSummary from "./SetupSummary.vue";
import { useSetup } from "./use-setup.js";
import { translate } from "../../shared/i18n/index.js";

const emit = defineEmits(["exit", "complete"]);
const { state, loading, saving, error, step, directory, accounts, project, load, submit, navigate, saveDraft } = useSetup();
const heading = ref(), environment = ref({ ready: false, needsLogin: false, busy: false });
const locked = computed(() => loading.value || saving.value);
const completed = computed(() => state.value?.steps[step.value]?.status === "completed");
const selectedStep = computed(() => steps.find(item => item.id === step.value));
const previewRoot = computed(() => {
  const separator = state.value?.platform === "win32" ? "\\" : "/";
  return [directory.value.replace(/[\\/]+$/, ""), "projects", translate("<仓库名>"), "members", translate("<用户名>")].join(separator);
});
const separator = computed(() => state.value?.platform === "win32" ? "\\" : "/");
const nextLabel = computed(() => {
  if (step.value === "complete") return state.value?.project ? "完成并进入项目" : "完成并进入全部项目";
  if (completed.value && step.value !== "environment") return "继续配置";
  return { admin: "继续配置", environment: environment.value.needsLogin ? "稍后登录，继续配置" : "继续配置", directory: "保存并继续", departments: "创建默认部门并继续", accounts: "创建所选账号并继续", project: "创建项目并继续" }[step.value];
});
const cannotContinue = computed(() => locked.value || step.value === "environment" && (!environment.value.ready || environment.value.busy) || step.value === "accounts" && !completed.value && !accounts.some(account => account.selected));
function updateEnvironment(value) { environment.value = value; }
function permissionLabel(id) { return state.value.permissions.find(item => item.id === id)?.label || id; }
async function next() {
  if (cannotContinue.value) return;
  if (state.value.status === "completed") { emit("complete", state.value.project?.id); return; }
  if (completed.value && step.value !== "environment") {
    navigate(steps[steps.findIndex(item => item.id === step.value) + 1]?.id || "complete");
    return;
  }
  const value = {
    environment: { deferCodexLogin: environment.value.needsLogin }, directory: { memberStorageRoot: directory.value },
    accounts: { accounts: accounts.filter(account => account.selected).map(({ kind, username, displayName, password }) => ({ kind, username, displayName, password })) },
    project: { ...project, memberIds: [...project.memberIds] },
  }[step.value] || {};
  const finishing = step.value === "complete";
  if (await submit(step.value, value) && finishing) emit("complete", state.value.project?.id);
}
async function exit() { if (await saveDraft()) emit("exit"); }
function back() { navigate(steps[Math.max(0, steps.findIndex(item => item.id === step.value) - 1)].id); }
watch(step, async () => { await nextTick(); heading.value?.focus({ preventScroll: true }); heading.value?.scrollIntoView({ block: "start" }); });
</script>
<template>
  <SetupFrame :step="step" :current-step="state?.currentStep || 'environment'" :completed="state?.steps || {}" :busy="locked" :username="accountSession.user?.username" @navigate="navigate" @exit="exit">
    <p v-if="loading" role="status">{{ $t("正在加载初始化进度…") }}</p>
    <FeedbackMessage :message="error" type="error" />
    <div v-if="error" class="actions"><button :disabled="locked" @click="load">{{ $t("重新加载进度（保留输入）") }}</button></div>
    <form v-if="state" @submit.prevent="next">
      <header class="setup-step-heading"><h2 ref="heading" tabindex="-1">{{ $t(selectedStep.title) }}</h2><span>{{ steps.findIndex(item => item.id === step) + 1 }} / 7</span></header>
      <template v-if="step === 'admin'"><FormSection :title="$t('管理员已创建')"><p>{{ state.administrator?.displayName }} · {{ state.administrator?.username }}</p><p class="field-hint">{{ $t("后续步骤将以当前管理员身份完成。") }}</p></FormSection></template>
      <slot v-else-if="step === 'environment'" name="environment" :update="updateEnvironment" :disabled="locked" />
      <template v-else-if="step === 'directory'">
        <FormSection :title="$t('成员项目与任务目录')" :description="$t('项目仓库和任务 Worktree 共用一个基础路径。')">
          <label for="setup-directory">{{ $t("成员目录基础路径") }}</label>
          <div class="setup-directory-row"><input id="setup-directory" v-model="directory" required :readonly="completed" :disabled="locked" /><slot name="directory-picker" :path="directory" :select="value => directory = value" :disabled="locked || completed" /></div>
          <p class="field-hint">{{ $t("填写服务器上的绝对路径。保存时创建缺失目录并检查写入权限。") }}</p>
          <div class="setup-path-preview"><small>{{ $t("成员项目仓库") }}</small><code>{{ previewRoot }}{{ separator }}{{ $t("repository-<准备修订号>") }}</code><small>{{ $t("任务 Worktree") }}</small><code>{{ previewRoot }}{{ separator }}worktree{{ separator }}{{ $t("<任务目录>") }}</code></div>
          <p class="field-hint">{{ $t("使用 Git 仓库名和登录用户名，例如 devloom / admin。同名仓库的后创建项目自动加短后缀；修改显示名称不搬移目录。") }}</p>
        </FormSection>
      </template>
      <template v-else-if="step === 'departments'">
        <p class="notice">{{ $t("系统自动创建产品部门和研发部门，并应用对应功能上限。加入项目后，成员才能访问该项目内容。") }}</p>
        <div class="setup-departments"><FormSection v-for="template in state.templates" :key="template.kind" :title="template.name" :description="template.kind === 'product' ? $t('维护需求，组织协作与业务验收。') : $t('准备开发空间，通过 Agent 处理任务。')"><template #action><TeamOutlined aria-hidden="true" v-if="template.kind === 'product'" /><CodeOutlined aria-hidden="true" v-else /></template><p>{{ template.permissions.length }} {{ $t("项默认权限") }}</p><ul class="setup-permissions"><li v-for="id in template.permissions" :key="id"><CheckOutlined aria-hidden="true" /><span>{{ $t(permissionLabel(id)) }}</span></li></ul><p class="field-hint">{{ $t("不包含系统管理、项目管理和敏感资产权限。") }}</p></FormSection></div>
        <p v-if="completed" class="notice">{{ $t("默认部门已经创建，后续可在部门管理中调整。") }}</p>
      </template>
      <template v-else-if="step === 'accounts'">
        <p class="muted">{{ $t("可分别选择测试账号，或跳过本步稍后添加正式成员。") }}</p>
        <template v-if="completed"><FormSection v-for="account in state.accounts" :key="account.id" :title="account.displayName"><p>{{ account.username }} · {{ account.kind === 'product' ? $t("产品部门") : $t("研发部门") }}</p><p class="field-hint">{{ $t("账号已创建。初始密码不回显，首次登录仍需修改密码。") }}</p></FormSection></template>
        <template v-else><FormSection v-for="(account, index) in accounts" :key="account.kind" :title="account.kind === 'product' ? $t('产品测试账号') : $t('研发测试账号')"><template #action><label class="setup-check"><input v-model="account.selected" type="checkbox" :disabled="locked" />{{ $t("创建此账号") }}</label></template><div v-if="account.selected"><div class="setup-field-grid"><div><label :for="`setup-account-name-${index}`">{{ $t("显示名称") }}</label><input :id="`setup-account-name-${index}`" v-model="account.displayName" required maxlength="80" :disabled="locked" /></div><div><label :for="`setup-account-login-${index}`">{{ $t("登录名") }}</label><input :id="`setup-account-login-${index}`" v-model="account.username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,63}" :disabled="locked" /></div></div><label :for="`setup-account-password-${index}`">{{ $t("初始密码") }}</label><input :id="`setup-account-password-${index}`" v-model="account.password" type="password" autocomplete="new-password" required minlength="6" maxlength="256" :disabled="locked" /><p class="field-hint">{{ $t("6–256 个字符，首次登录须修改；退出时清除密码草稿。") }}</p></div><p class="field-hint">{{ account.kind === 'product' ? $t("产品部门") : $t("研发部门") }} {{ $t("· 普通成员；不授予创建项目资格。") }}</p></FormSection></template>
        <p class="field-hint">{{ $t("中文与 # 用于显示名称；登录名采用字母、数字、点、短横线或下划线。") }}</p>
      </template>
      <template v-else-if="step === 'project'">
        <FormSection v-if="completed" :title="$t('项目已创建')"><p>{{ state.project?.name }}</p><code>{{ state.project?.remoteUrl }}</code></FormSection>
        <template v-else><FormSection :title="$t('第一个项目')" :description="$t('创建项目不会克隆仓库或启动开发任务。')"><div class="setup-field"><label for="setup-project-name">{{ $t("项目名称") }}</label><input id="setup-project-name" v-model="project.name" required maxlength="80" :disabled="locked" /></div><div class="setup-field"><label for="setup-project-remote">{{ $t("Git 仓库地址") }}</label><input id="setup-project-remote" v-model="project.remoteUrl" required :disabled="locked" placeholder="https://git.example.com/team/project.git" /><p class="field-hint">{{ $t("支持 HTTP(S) 或 SSH 地址，不填写密码或令牌。") }}</p></div><div class="setup-field"><label for="setup-project-description">{{ $t("项目说明（可选）") }}</label><textarea id="setup-project-description" v-model="project.description" maxlength="8000" :disabled="locked" /></div><p class="field-hint">{{ $t("负责人：") }}{{ accountSession.user?.displayName }}{{ $t("。开发成员之后再绑定个人 Git 账号并准备空间。") }}</p></FormSection><FormSection :title="$t('加入项目的测试成员')"><label v-for="account in state.accounts" :key="account.id" class="setup-member"><span class="setup-check"><input v-model="project.memberIds" type="checkbox" :value="account.id" :disabled="locked" />{{ account.displayName }}</span><span class="field-hint">{{ account.kind === 'product' ? $t("产品协作 · 12 项权限") : $t("研发执行 · 13 项权限") }}</span></label><p v-if="!state.accounts.length" class="muted">{{ $t("已跳过测试账号。之后可在项目成员页添加正式成员。") }}</p></FormSection></template>
      </template>
      <template v-else-if="step === 'complete'"><p class="notice">{{ $t("核对已保存的结果。完成时会再次检查环境、目录和已创建资料。") }}</p><SetupSummary :state="state" /></template>
      <div class="setup-actions"><button type="button" :disabled="locked || step === 'admin' || environment.busy && step === 'environment'" @click="back">{{ $t("上一步") }}</button><div><button v-if="selectedStep.optional && !completed" type="button" :disabled="locked" @click="submit(step, undefined, true)">{{ step === 'accounts' ? $t("跳过测试账号") : $t("跳过项目创建") }}</button><button class="primary" type="submit" :disabled="cannotContinue">{{ saving ? $t("正在保存…") : nextLabel }}<ArrowRightOutlined aria-hidden="true" /></button></div></div>
    </form>
  </SetupFrame>
</template>
<style scoped>
.setup-step-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.setup-step-heading h2 { margin: 0; font-size: 21px; }
.setup-step-heading > span { color: var(--muted); font: 12px var(--font-code); }
.setup-actions { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-top: 20px; margin-top: 24px; border-top: 1px solid var(--line); }
.setup-actions > div { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.setup-actions > button { flex-shrink: 0; white-space: nowrap; }
.setup-field, .setup-field-grid { margin-bottom: 20px; }
.setup-field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
label:not(.setup-check):not(.setup-member) { display: block; margin-bottom: 8px; }
.setup-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.setup-check input { width: 16px; height: 16px; flex-shrink: 0; }
.setup-directory-row { display: flex; gap: 8px; }
.setup-directory-row :deep(button) { flex-shrink: 0; }
.setup-path-preview { padding: 16px; background: var(--canvas); border: 1px solid var(--line); border-radius: var(--radius-control); margin-top: 20px; }
.setup-path-preview small { display: block; color: var(--muted); margin-bottom: 8px; }
.setup-path-preview code { display: block; overflow-wrap: anywhere; }
.setup-path-preview code + small { margin-top: 20px; }
.setup-departments { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.setup-permissions { list-style: none; padding: 0; display: grid; gap: 10px; font-size: 13px; }
.setup-permissions li { display: flex; gap: 8px; align-items: baseline; }
.setup-permissions .anticon { color: var(--success); }
.setup-member { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.setup-member:last-child { border: 0; }
@media (min-width: 769px) and (max-width: 1000px), (max-width: 600px) { .setup-field-grid, .setup-departments { grid-template-columns: 1fr; } }
@media (max-width: 480px) {
  .setup-directory-row { flex-wrap: wrap; }
  .setup-actions { gap: 8px; }
  .setup-actions button { font-size: 12px; padding: 8px; }
}
</style>
