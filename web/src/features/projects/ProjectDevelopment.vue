<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import { spaceStates } from "./project-labels.js";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ projectId: { type: String, required: true }, remoteUrl: { type: String, required: true }, space: { type: Object, default: null }, canStart: Boolean, canViewSession: { type: Boolean, default: true } });
const emit = defineEmits(["open-workspace", "refresh", "return-to-issue"]);
const route = useRoute();
const { data, loading, saving, error, notice, save } = useResource(() => appApi("/account/git-accounts"));
const gitAccountId = ref(props.space?.gitAccountId || "");
const requestId = ref(createRequestId());
const preparing = computed(() => props.space?.status === "preparing");
function prepare() { return save(`/projects/${props.projectId}/space/prepare`, { gitAccountId: gitAccountId.value, requestId: requestId.value }, () => { requestId.value = createRequestId(); emit("refresh"); }, "已提交空间准备请求。空间可用后，请返回开发任务开始开发。"); }
</script>
<template>
  <FormSection title="我的代码与环境"><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p class="project-text">Git 仓库：{{ remoteUrl }}</p><p role="status">状态：{{ spaceStates[space?.status] || '尚未分配' }}</p><p v-if="space?.error" class="error">{{ space.error }}</p><p class="field-hint">空间由项目权限自动分配；同一项目的成员使用各自的 Git 账号和仓库副本。</p><button v-if="space?.status === 'ready'" class="primary" @click="emit('open-workspace', space.workspaceId)">{{ canViewSession ? "打开开发工作台" : "打开代码仓库" }}</button><form v-else-if="canStart && space" class="project-form" @submit.prevent="prepare"><label>个人 Git 账号<select aria-label="个人 Git 账号" aria-describedby="project-git-account-hint" v-model="gitAccountId" required :disabled="loading || saving || preparing"><option value="" disabled>选择 Git 账号</option><option v-for="account in data?.accounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.host }} · {{ account.authType === "ssh" ? "SSH 密钥" : "HTTP/HTTPS 凭据" }}</option></select><small id="project-git-account-hint" class="field-hint">Gitee（gitee.com）默认端口的 HTTPS 与 SSH 仓库地址会按所选账号的认证方式匹配。其他 Git 服务需与项目地址的主机和认证方式一致。</small></label><p v-if="!loading && !data?.accounts?.length" class="field-hint">请先<RouterLink :to="{ path: '/personal', query: { tab: 'git', returnTo: route.fullPath }, hash: '#git-accounts' }">配置个人 Git 账号</RouterLink>，再返回此页准备空间。</p><button class="primary" type="submit" :disabled="saving || preparing || !gitAccountId">{{ preparing ? '正在准备仓库…' : '验证访问并准备空间' }}</button></form><p v-if="route.query.returnTab" class="field-hint">准备空间不会自动启动开发；请返回开发任务确认。</p><button v-if="route.query.returnTab" @click="emit('return-to-issue')">返回待开发任务</button></FormSection>
</template>
