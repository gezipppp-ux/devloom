<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import FormSection from "../../shared/components/FormSection.vue";
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { FolderOutlined, SafetyOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import { spaceStates } from "./project-labels.js";
import { useProjectSpace } from "./use-project-space.js";
import ProjectSpaceProgress from "./ProjectSpaceProgress.vue";

const props = defineProps({ projectId: { type: String, required: true }, remoteUrl: { type: String, required: true }, space: { type: Object, default: null }, canStart: Boolean, canViewSession: { type: Boolean, default: true } });
const emit = defineEmits(["open-workspace", "refresh", "return-to-issue", "browse"]);
const route = useRoute();
const { data, loading, error, reload: reloadAccounts } = useResource(() => appApi("/account/git-accounts"));
const { space, submitting, checking, unknown, busy, connectionError, submissionError, restricted, prepare, confirm } = useProjectSpace(() => props.projectId, () => props.space, () => emit("refresh"));
const gitAccountId = ref(props.space?.gitAccountId || "");
watch(() => space.value?.gitAccountId, value => { if (value) gitAccountId.value = value; });
const selectedAccount = computed(() => data.value?.accounts?.find(account => account.id === gitAccountId.value));
const showProgress = computed(() => busy.value || ["ready", "failed", "interrupted"].includes(space.value?.status));
const openLabel = computed(() => route.query.openIntent === "manual" ? "独立开发" : route.query.openIntent === "history" ? "查看已归档会话" : props.canViewSession ? "打开开发工作台" : "打开代码仓库");
function open() { emit("open-workspace", space.value.workspaceId, undefined, { view: route.query.openIntent }); }
</script>

<template>
  <div class="project-space-grid">
    <FormSection class="project-space-panel" :title="$t('我的代码与环境')">
      <template #action><span class="space-state" :class="{ preparing: busy, ready: space?.status === 'ready' }">{{ submitting ? $t('正在提交') : unknown ? $t('状态待确认') : $t(spaceStates[space?.status] || '尚未分配') }}</span></template>
      <FeedbackMessage :message="error" type="error" />
      <div class="space-repository"><span class="space-repository-icon"><FolderOutlined aria-hidden="true" /></span><div><p>{{ remoteUrl }}</p><small>{{ selectedAccount?.name || $t('个人 Git 账号') }}<template v-if="selectedAccount"> · {{ selectedAccount.authType === 'ssh' ? $t('SSH 密钥') : $t('HTTP/HTTPS 凭据') }}</template></small></div></div>
      <ProjectSpaceProgress v-if="showProgress" :space="space" :submitting="submitting" :unknown="unknown" :checking="checking" :connection-error="connectionError" @reconnect="confirm" @browse="emit('browse')">
        <template #ready><div class="space-ready-actions"><button class="primary" type="button" @click="open">{{ $t(openLabel) }}</button></div><p class="field-hint">{{ $t('开始开发时，再选择任务与分支。') }}</p></template>
      </ProjectSpaceProgress>
      <form v-if="canStart && !restricted && !busy && space?.status !== 'ready'" class="project-form space-create-form" @submit.prevent="prepare(gitAccountId)">
        <p v-if="!showProgress" class="space-intro">{{ $t('选择个人 Git 账号，为这个项目准备一份属于你的代码副本。') }}</p>
        <label>{{ $t('个人 Git 账号') }}<AppSelect id="space-git-account" native-events :aria-label="$t('个人 Git 账号')" aria-describedby="project-git-account-hint" v-model="gitAccountId" required :disabled="loading"><option value="" disabled>{{ $t('选择 Git 账号') }}</option><option v-for="account in data?.accounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.host }} · {{ account.authType === 'ssh' ? $t('SSH 密钥') : $t('HTTP/HTTPS 凭据') }}</option></AppSelect><small id="project-git-account-hint" class="field-hint">{{ $t('使用此账号验证仓库访问并下载项目代码。') }}</small></label>
        <p v-if="!loading && !data?.accounts?.length && !error" class="field-hint">{{ $t('请先') }}<RouterLink :to="{ path: '/personal', query: { tab: 'git', returnTo: route.fullPath }, hash: '#git-accounts' }">{{ $t('配置个人 Git 账号') }}</RouterLink>{{ $t('，再返回此页准备空间。') }}</p>
        <p v-if="submissionError" class="error" role="alert">{{ submissionError }}</p>
        <div class="space-create-actions"><button class="primary" type="submit" :disabled="loading || !gitAccountId">{{ $t(space?.status === 'failed' || space?.status === 'interrupted' ? '重新尝试' : '创建工作空间') }}</button><RouterLink v-if="data?.accounts?.length" class="space-account-link" :to="{ path: '/personal', query: { tab: 'git', returnTo: route.fullPath }, hash: '#git-accounts' }">{{ $t('管理 Git 账号') }}</RouterLink><button v-if="error" type="button" @click="reloadAccounts">{{ $t('重新加载') }}</button></div>
        <p class="field-hint">{{ $t('首次创建需要下载项目代码，提交后会显示准备进度。') }}</p>
      </form>
      <p v-if="restricted" class="error" role="alert">{{ submissionError || connectionError }}</p>
      <div v-if="route.query.returnTab" class="space-return"><button type="button" @click="emit('return-to-issue')">{{ $t('返回待开发任务') }}</button></div>
    </FormSection>
    <aside class="space-guidance"><SafetyOutlined aria-hidden="true" /><h3>{{ $t('你的个人开发环境') }}</h3><p>{{ $t('使用你的 Git 账号准备独立的仓库副本，与其他成员的代码空间分开。') }}</p><div class="space-guidance-divider"></div><h3>{{ $t('准备好之后') }}</h3><p>{{ $t('打开开发工作台，选择任务和起始分支，再开始开发。') }}</p></aside>
  </div>
</template>

<style scoped>
.project-space-grid { display: grid; grid-template-columns: minmax(0,860px) minmax(220px,280px); gap: 40px; align-items: start; }
.project-space-panel { min-width: 0; margin: 0; }
.space-state { display: inline-flex; padding: 3px 9px; font-size: 12px; border-radius: 5px; color: var(--muted); background: var(--soft); white-space: nowrap; }
.space-state.preparing { color: var(--highlight); background: var(--selected); }
.space-state.ready { color: var(--success); background: var(--success-soft); }
.space-repository { display: flex; align-items: center; gap: 12px; padding: 4px 0 26px; min-width: 0; }
.space-repository > div { min-width: 0; }
.space-repository p { margin: 0; overflow-wrap: anywhere; font-weight: 500; font-size: 14px; }
.space-repository small { display: block; color: var(--muted); margin-top: 4px; font-size: 12px; overflow-wrap: anywhere; }
.space-repository-icon { width: 38px; height: 38px; border-radius: 8px; display: grid; place-items: center; background: var(--soft); flex-shrink: 0; font-size: 18px; }
.space-intro { color: var(--muted); line-height: 1.8; margin: 0; }
.space-create-form { max-width: none; margin-top: 16px; }
.space-create-form label { min-width: 0; }
.space-create-actions,.space-ready-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.space-create-actions button,.space-ready-actions button,.space-return button { min-height: 44px; }
.space-ready-actions { margin-top: 24px; }
.space-account-link { min-height: 44px; display: inline-flex; align-items: center; padding-inline: 6px; color: var(--muted); font-size: 13px; }
.space-return { border-top: 1px solid var(--line); padding-top: 18px; margin-top: 24px; }
.space-guidance { padding-top: 8px; font-size: 13px; line-height: 1.9; color: var(--muted); }
.space-guidance > .anticon { font-size: 19px; margin-bottom: 14px; }
.space-guidance h3 { font-size: 14px; font-weight: 600; color: var(--ink); margin: 0 0 10px; }
.space-guidance p { margin: 0; }
.space-guidance-divider { border-top: 1px solid var(--line); margin: 24px 0; }
@media (max-width:1199px) { .project-space-grid { grid-template-columns: minmax(0,1fr); gap: 26px; } .space-guidance { max-width: 680px; } }
@media (max-width:767px) { .space-repository { align-items: flex-start; padding-bottom: 22px; } .space-create-actions { align-items: stretch; } .space-create-actions button { flex: 1; } .space-guidance > .anticon { display: none; } .space-guidance-divider { margin-block: 16px; } }
</style>
