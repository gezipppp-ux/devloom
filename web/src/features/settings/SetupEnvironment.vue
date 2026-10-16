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
const ready = computed(() => Boolean(report.value && !locked.value && job.value?.status !== "restart-required" &&
  ["git", "codex", "node", "npm"].every(id => { const tool = report.value.tools.find(item => item.id === id); return tool && !tool.pendingRestart && (tool.binaryReady ?? tool.status === "pass"); }) &&
  !report.value.checks.some(check => check.name !== "成员目录可写" && check.status !== "pass")));
watch([ready, busy, loading, checking, submitting], () => emit("status", { ready: ready.value, busy: busy.value || submitting.value }), { immediate: true });
function status(tool) {
  if (job.value?.id === tool.id && job.value.status === "running") return "安装中";
  if (job.value?.id === tool.id && job.value.status === "restart-required") return "已安装，待重启";
  if (tool.status === "unknown") return "检测异常";
  if (tool.missing) return "待安装";
  return tool.status === "pass" ? "满足要求" : "需要处理";
}
</script>
<template>
  <div>
    <p class="muted">{{ $t("检查运行 DevLoom 的服务器。已有合格版本保持不变，缺失工具按下方计划依次安装。") }}</p>
    <p v-if="loading || checking" role="status">{{ checking ? $t("正在查询可安装版本…") : $t("正在检测工具版本…") }}</p>
    <FeedbackMessage :message="error" type="error" />
    <p v-if="busy" class="notice" role="status">{{ job?.status === 'running' ? $t("正在安装 {p0} {p1}。", { p0: job.id, p1: job.version }) : $t("正在核对安装计划。") }} {{ $t("已受理的安装离开页面后仍会继续，请保持服务运行。") }}</p>
    <p v-else-if="batch && ['failed', 'restart-required'].includes(batch.status)" class="notice">{{ $t(batch.message) }}</p>
    <p v-else-if="job && ['failed', 'restart-required'].includes(job.status)" class="notice">{{ $t(job.message) }}</p>
    <FormSection v-if="report" :title="$t('开发所需工具')">
      <div v-for="tool in tools" :key="tool.id" class="setup-tool-row"><div><strong>{{ tool.name }}</strong><p class="field-hint">{{ tool.version ? $t("已检测到 {p0}", { p0: tool.version }) : tool.missing ? $t("尚未安装") : $t("版本未知") }}</p><p class="field-hint">{{ $t(tool.detail || "") }}</p><p v-if="tool.missing && tool.installVersion" class="field-hint">{{ $t("安装目标") }} {{ tool.installVersion }} · {{ tool.installSource }}</p><p v-if="tool.missing && !tool.installAvailable" class="field-hint">{{ $t(tool.updateReason || "") }}</p><p v-if="tool.latestError" class="error">{{ $t("版本查询失败：") }}{{ $t(tool.latestError || "") }}</p><button v-if="!tool.missing && !tool.binaryReady && tool.updateAvailable && tool.latestStatus === 'available'" type="button" :disabled="locked" @click="update(tool)">{{ $t("修复到") }} {{ tool.latest }}</button></div><span class="setup-tool-status" :class="{ pass: tool.status === 'pass' }">{{ $t(status(tool)) }}</span></div>
      <div class="setup-prerequisites"><span><CheckOutlined aria-hidden="true" /> {{ $t("PostgreSQL 已连接") }}</span><span v-for="tool in report.tools.filter(item => ['node', 'npm'].includes(item.id))" :key="tool.id">{{ tool.name }} {{ tool.version || $t("未知") }} · {{ tool.status === 'pass' ? $t("可用") : $t("需处理") }}</span></div>
      <p v-for="check in report.checks.filter(item => item.name !== '成员目录可写' && item.status !== 'pass')" :key="check.name" class="error">{{ $t(check.name) }}: {{ $t(check.detail || "") }}</p>
      <div class="actions"><button v-if="missing.length" type="button" class="primary" :disabled="locked || !installable" @click="installMissing(missing)"><DownloadOutlined aria-hidden="true" /> {{ $t("安装缺失工具") }}</button><button type="button" :disabled="locked" @click="load()"><ReloadOutlined aria-hidden="true" />{{ $t("重新检测") }}</button><button type="button" :disabled="locked" @click="load(true)">{{ $t("检查安装版本") }}</button></div>
    </FormSection>
    <button v-else-if="!loading && !checking" type="button" :disabled="locked" @click="load()">{{ $t("重新检测") }}</button>
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
