<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, nextTick, ref } from "vue";
import { ReloadOutlined, DownloadOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import { useEnvironment } from "./use-environment.js";

const { report, loading, checking, submitting, busy, error, job, load, update } = useEnvironment();
const dialog = ref(), selected = ref(null);
const disabled = computed(() => loading.value || checking.value || submitting.value || busy.value);
const labels = { pass: "满足要求", fail: "需要处理", unknown: "检测异常", warning: "需确认" };
const latestLabels = { unchecked: "尚未检查", error: "检查失败", unknown: "无法比较", available: "有新版本", current: "当前版本不低于更新目标" };
const toolNames = { codex: "Codex CLI", npm: "npm", git: "Git", node: "Node.js" };
const jobMessage = computed(() => {
  if (!job.value) return "";
  const current = job.value;
  const status = { running: "更新中", completed: "更新成功", "restart-required": "已安装，待重启生效", failed: "更新失败" }[current.status] || current.status;
  return `${toolNames[current.id]} → ${current.version} · ${status}。${current.message || ""}`;
});
const jobMessageType = computed(() => ({ running: "info", completed: "success", "restart-required": "warning", failed: "error" }[job.value?.status] || "info"));
async function open(tool) {
  selected.value = tool;
  await nextTick();
  dialog.value.showModal();
}
function close() { dialog.value.close(); }
async function confirm() {
  const tool = selected.value;
  close();
  await update(tool);
}
</script>

<template>
  <section class="environment-panel" aria-label="环境检测">
    <p class="muted">检查运行服务的服务器环境，查看工具版本并管理更新。</p>
    <div class="actions environment-actions">
      <button :disabled="disabled" @click="load()"><ReloadOutlined aria-hidden="true" />{{ loading ? '检测中…' : '重新检测' }}</button>
      <button class="primary" :disabled="disabled || !report" @click="load(true)">{{ checking ? '检查版本中…' : '检查最新版本' }}</button>
    </div>
    <FeedbackMessage :message="error" type="error" />
    <p v-if="submitting" class="muted" role="status">正在核对目标版本与安装方式…</p>
    <p v-if="loading && !report" class="muted" role="status">正在检测工具版本、登录状态与目录权限…</p>
    <FeedbackMessage :message="jobMessage" :type="jobMessageType" />
    <template v-if="report">
      <FormSection title="环境概况" :description="report.ready ? '基础环境检测通过' : '部分检测项需要处理或进一步确认'">
        <ul class="environment-checks">
          <li v-for="check in report.checks" :key="check.name"><div><strong>{{ check.name }}</strong><p class="field-hint">{{ check.detail }}</p></div><span class="environment-status" :class="check.status">{{ labels[check.status] }}</span></li>
        </ul>
        <p class="field-hint">服务正在使用 Node.js {{ report.runningNode }}。检测时间：{{ new Date(report.checkedAt).toLocaleString() }}</p>
        <p class="field-hint">基础检测不代表所有业务依赖或外部服务均可用。SSH、目标项目工具链、Git 与 Codex 网络访问仍需按项目确认。</p>
      </FormSection>
      <FormSection v-for="tool in report.tools" :key="tool.id" :title="tool.name" :description="tool.requirement">
        <template #action><span class="environment-status" :class="tool.status">{{ labels[tool.status] }}</span></template>
        <dl class="environment-versions">
          <div><dt>已安装版本</dt><dd>{{ tool.version || '未检测到' }}</dd></div>
          <div><dt>{{ tool.id === 'node' ? '最新 LTS' : '最新稳定版' }}</dt><dd>{{ tool.latest || '—' }}</dd></div>
        </dl>
        <p :class="tool.status === 'pass' ? 'field-hint' : 'error'">{{ tool.detail }}</p>
        <p :class="tool.latestStatus === 'error' ? 'error' : 'field-hint'">{{ latestLabels[tool.latestStatus] }}{{ tool.latestError ? '：' + tool.latestError : '' }}{{ tool.source ? ' · ' + tool.source : '' }}</p>
        <p v-if="tool.nodeEngine" class="field-hint">此更新要求 Node.js {{ tool.nodeEngine }}；安装时会再次校验兼容性。</p>
        <p v-if="tool.pendingRestart" class="notice">新版本已安装，当前服务仍在使用 {{ report.runningNode }}，重启后生效。</p>
        <p v-if="!tool.updateAvailable" class="field-hint">{{ tool.updateReason }}</p>
        <div class="actions">
          <button class="primary" :disabled="disabled || !tool.updateAvailable || tool.latestStatus !== 'available'" @click="open(tool)"><DownloadOutlined aria-hidden="true" />更新 {{ tool.name }}</button>
        </div>
      </FormSection>
    </template>
    <Teleport to="body">
      <dialog ref="dialog" class="workspace-dialog environment-dialog" aria-labelledby="environment-update-title" @cancel.prevent="close">
        <template v-if="selected">
          <div class="workspace-dialog-heading"><h2 id="environment-update-title">更新 {{ selected.name }}</h2><button aria-label="关闭更新窗口" @click="close">×</button></div>
          <template v-if="selected.updateAvailable">
            <p>从 {{ selected.version }} 更新到 {{ selected.latest }}。{{ selected.updateDescription }}</p>
            <p>请先结束正在执行或等待审批的任务。更新期间将暂停新的写入操作；关闭页面后更新仍会继续，可返回本页查看结果。</p>
            <p v-if="selected.restartRequired" class="notice">Node.js 更新后需要重启服务才能生效；跨主版本升级时还需重新安装应用依赖。当前任务不会自动恢复执行。</p>
            <p class="field-hint">安装需要网络与目标目录写入权限；Windows 安装器可能要求管理员授权。</p>
            <div class="actions"><button autofocus @click="close">取消</button><button class="primary" :disabled="disabled" @click="confirm">确认更新</button></div>
          </template>
        </template>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.environment-actions { margin-bottom: 24px; flex-wrap: wrap; }
.environment-checks { list-style: none; margin: 0; padding: 0; }
.environment-checks li { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--line); }
.environment-checks li:last-child { border-bottom: 0; }
.environment-checks .field-hint { margin-bottom: 0; }
.environment-status { display: inline-block; flex-shrink: 0; padding: 4px 8px; font-size: 12px; border-radius: var(--radius-control); color: var(--warning); background: var(--warning-soft); }
.environment-status.pass { color: var(--success); background: var(--success-soft); }
.environment-status.fail, .environment-status.unknown { color: var(--danger); background: var(--danger-soft); }
.environment-versions { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 0; }
.environment-versions dt { color: var(--muted); font-size: 12px; }
.environment-versions dd { margin: 8px 0 0; font: 18px var(--font-code); overflow-wrap: anywhere; }
.environment-dialog p { line-height: 1.8; overflow-wrap: anywhere; }
.environment-dialog .actions { flex-wrap: wrap; }
@media (max-width: 480px) {
  .environment-checks li { flex-wrap: wrap; gap: 8px; }
  .environment-panel :deep(.form-section-heading) { flex-wrap: wrap; }
  .environment-panel :deep(.section-action) { margin-left: 0; }
}
</style>
