<script setup>
import { computed, watch } from "vue";
import { ReloadOutlined, DownloadOutlined, CheckOutlined } from "@antdv-next/icons";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import FormSection from "../../shared/components/FormSection.vue";
import { useEnvironment } from "./use-environment.js";
const props = defineProps({ disabled: Boolean });
const emit = defineEmits(["status"]);
const { report, loading, checking, submitting, busy, error, job, batch, load, installMissing, update } = useEnvironment({ checkMissingVersions: true });
const locked = computed(() => props.disabled || loading.value || checking.value || submitting.value || busy.value);
const tools = computed(() => report.value?.tools.filter(tool => ["git", "codex"].includes(tool.id)).sort((a, b) => a.id === b.id ? 0 : a.id === "git" ? -1 : 1) || []);
const missing = computed(() => tools.value.filter(tool => tool.missing));
const installable = computed(() => missing.value.length > 0 && missing.value.every(tool => tool.installAvailable && tool.installVersion));
const needsLogin = computed(() => tools.value.some(tool => tool.id === "codex" && tool.binaryReady && tool.authentication === false));
const ready = computed(() => Boolean(report.value && !locked.value && job.value?.status !== "restart-required" &&
  ["git", "codex", "node", "npm"].every(id => { const tool = report.value.tools.find(item => item.id === id); return tool && !tool.pendingRestart && (tool.binaryReady ?? tool.status === "pass"); }) &&
  !report.value.checks.some(check => check.name !== "成员目录可写" && check.status !== "pass")));
watch([ready, needsLogin, busy, loading, checking, submitting], () => emit("status", { ready: ready.value, needsLogin: needsLogin.value, busy: busy.value || submitting.value }), { immediate: true });
function status(tool) {
  if (job.value?.id === tool.id && job.value.status === "running") return "安装中";
  if (job.value?.id === tool.id && job.value.status === "restart-required") return "已安装，待重启";
  if (tool.status === "unknown") return "检测异常";
  if (tool.missing) return "待安装";
  if (tool.authentication === false && tool.binaryReady) return "已安装，待认证";
  return tool.status === "pass" ? "满足要求" : "需要处理";
}
</script>
<template>
  <div>
    <p class="muted">检查运行 Web Coding 的服务器。已有合格版本保持不变，缺失工具按下方计划依次安装。</p>
    <p v-if="loading || checking" role="status">{{ checking ? '正在查询可安装版本…' : '正在检测工具版本和认证状态…' }}</p>
    <FeedbackMessage :message="error" type="error" />
    <p v-if="busy" class="notice" role="status">{{ job?.status === 'running' ? `正在安装 ${job.id} ${job.version}。` : '正在核对安装计划。' }} 已受理的安装离开页面后仍会继续，请保持服务运行。</p>
    <p v-else-if="batch && ['failed', 'restart-required'].includes(batch.status)" class="notice">{{ batch.message }}</p>
    <p v-else-if="job && ['failed', 'restart-required'].includes(job.status)" class="notice">{{ job.message }}</p>
    <FormSection v-if="report" title="开发所需工具">
      <div v-for="tool in tools" :key="tool.id" class="setup-tool-row"><div><strong>{{ tool.name }}</strong><p class="field-hint">{{ tool.version ? `已检测到 ${tool.version}` : tool.missing ? '尚未安装' : '版本未知' }}</p><p class="field-hint">{{ tool.detail }}</p><p v-if="tool.missing && tool.installVersion" class="field-hint">安装目标 {{ tool.installVersion }} · {{ tool.installSource }}</p><p v-if="tool.missing && !tool.installAvailable" class="field-hint">{{ tool.updateReason }}</p><p v-if="tool.latestError" class="error">版本查询失败：{{ tool.latestError }}</p><button v-if="!tool.missing && !tool.binaryReady && tool.updateAvailable && tool.latestStatus === 'available'" type="button" :disabled="locked" @click="update(tool)">修复到 {{ tool.latest }}</button></div><span class="setup-tool-status" :class="{ pass: tool.status === 'pass' }">{{ status(tool) }}</span></div>
      <div class="setup-prerequisites"><span><CheckOutlined aria-hidden="true" /> PostgreSQL 已连接</span><span v-for="tool in report.tools.filter(item => ['node', 'npm'].includes(item.id))" :key="tool.id">{{ tool.name }} {{ tool.version || '未知' }} · {{ tool.status === 'pass' ? '可用' : '需处理' }}</span></div>
      <p v-for="check in report.checks.filter(item => item.name !== '成员目录可写' && item.status !== 'pass')" :key="check.name" class="error">{{ check.name }}：{{ check.detail }}</p>
      <div class="actions"><button v-if="missing.length" type="button" class="primary" :disabled="locked || !installable" @click="installMissing(missing)"><DownloadOutlined aria-hidden="true" /> 安装缺失工具</button><button type="button" :disabled="locked" @click="load()"><ReloadOutlined aria-hidden="true" />重新检测</button><button type="button" :disabled="locked" @click="load(true)">检查安装版本</button></div>
    </FormSection>
    <button v-else-if="!loading && !checking" type="button" :disabled="locked" @click="load()">重新检测</button>
    <FormSection v-if="needsLogin" title="Codex 认证" description="在实际运行服务的账号下登录；也可以先完成团队配置。"><code>codex login</code><p class="field-hint">完成认证后重新检测。选择稍后登录时，开始开发前仍会检查认证状态。</p><button type="button" :disabled="locked" @click="load()">已完成登录，重新检测</button></FormSection>
  </div>
</template>
<style scoped>
.setup-tool-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--line); }
.setup-tool-row > div { min-width: 0; overflow-wrap: anywhere; }
.setup-tool-status { padding: 4px 8px; border-radius: 6px; background: var(--warning-soft); color: var(--warning); font-size: 12px; white-space: nowrap; }
.setup-tool-status.pass { background: var(--success-soft); color: var(--success); }
.setup-prerequisites { display: flex; flex-wrap: wrap; gap: 12px 20px; font-size: 12px; margin: 20px 0; color: var(--muted); }
.actions { flex-wrap: wrap; }
@media (max-width: 480px) { .setup-tool-row { flex-wrap: wrap; gap: 8px; } }
</style>
