<script setup>
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";
import { useResource } from "../../shared/api/use-resource.js";
import { spaceStates } from "./project-labels.js";
import FormSection from "../../shared/components/FormSection.vue";
const props = defineProps({ projectId: { type: String, required: true }, space: { type: Object, default: null }, canStart: Boolean, canViewSession: { type: Boolean, default: true } });
const emit = defineEmits(["open-workspace", "refresh", "return-to-issue"]);
const route = useRoute();
const { data, loading, saving, error, notice, save } = useResource(() => appApi("/account/git-accounts"));
const gitAccountId = ref(props.space?.gitAccountId || "");
const requestId = ref(createRequestId());
const preparing = computed(() => props.space?.status === "preparing");
function prepare() { return save(`/projects/${props.projectId}/space/prepare`, { gitAccountId: gitAccountId.value, requestId: requestId.value }, () => { requestId.value = createRequestId(); emit("refresh"); }, "已提交空间准备请求。空间可用后，请返回原事项确认启动开发。"); }
</script>
<template>
  <FormSection title="我的代码与环境"><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p><p role="status">状态：{{ spaceStates[space?.status] || '尚未分配' }}</p><p v-if="space?.error" class="error">{{ space.error }}</p><p class="field-hint">空间由项目权限自动分配；同一项目的成员使用各自的 Git 账号和仓库副本。</p><button v-if="space?.status === 'ready'" class="primary" @click="emit('open-workspace', space.workspaceId)">{{ canViewSession ? "打开开发工作台" : "打开代码仓库" }}</button><form v-else-if="canStart && space" class="project-form" @submit.prevent="prepare"><label>个人 Git 账号<select aria-label="个人 Git 账号" v-model="gitAccountId" required :disabled="loading || saving || preparing"><option value="" disabled>选择 Git 账号</option><option v-for="account in data?.accounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.host }}</option></select></label><p v-if="!loading && !data?.accounts?.length" class="field-hint">请先<RouterLink :to="{ path: '/personal', query: { tab: 'git', returnTo: route.fullPath }, hash: '#git-accounts' }">配置个人 Git 账号</RouterLink>，再返回此页准备空间。</p><button class="primary" type="submit" :disabled="saving || preparing || !gitAccountId">{{ preparing ? '正在准备仓库…' : '验证访问并准备空间' }}</button></form><p v-if="route.query.returnTab" class="field-hint">准备空间不会自动启动开发；请返回原事项确认。</p><button v-if="route.query.returnTab" @click="emit('return-to-issue')">返回待开发事项</button></FormSection>
</template>
