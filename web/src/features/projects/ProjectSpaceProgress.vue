<script setup>
/* global setInterval, clearInterval */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { CheckOutlined, ExclamationCircleOutlined, ReloadOutlined } from "@antdv-next/icons";
import { i18n } from "../../shared/i18n/index.js";
const props = defineProps({ space: { type: Object, default: null }, submitting: Boolean, unknown: Boolean, checking: Boolean, connectionError: { type: String, default: "" } });
defineEmits(["reconnect", "browse"]);
const now = ref(Date.now());
const heading = ref();
watch(() => props.submitting, value => { if (value) void nextTick(() => heading.value?.focus({ preventScroll: true })); }, { immediate: true });
let timer;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onBeforeUnmount(() => clearInterval(timer));
const pending = computed(() => props.submitting || props.unknown);
const ready = computed(() => !pending.value && props.space?.status === "ready");
const failed = computed(() => !pending.value && ["failed", "interrupted"].includes(props.space?.status));
const progress = computed(() => pending.value ? null : props.space?.progress);
const updated = computed(() => Date.parse(progress.value?.updatedAt));
const elapsed = computed(() => {
  const start = props.submitting ? NaN : Date.parse(progress.value?.startedAt);
  const end = ready.value || failed.value ? Date.parse(props.space?.updatedAt) : now.value;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : null;
});
const age = computed(() => Number.isFinite(updated.value) ? Math.max(0, Math.floor((now.value - updated.value) / 1000)) : null);
const stale = computed(() => props.space?.status === "preparing" && age.value !== null && age.value >= 30);
const unavailable = computed(() => props.unknown || Boolean(props.connectionError));
const phase = computed(() => ready.value ? 4 : ({ validating: 0, connecting: 0, counting: 1, compressing: 1, receiving: 1, resolving: 2, checkout: 2, publishing: 2 })[progress.value?.stage] ?? -1);
const stages = ["验证访问", "下载代码", "整理文件", "空间就绪"];
const labels = { validating: "验证仓库访问", connecting: "连接仓库", counting: "统计对象", compressing: "压缩对象", receiving: "下载项目代码", resolving: "整理对象差异", checkout: "检出项目文件", publishing: "校验工作空间" };
const title = computed(() => props.submitting ? "正在提交创建请求" : unavailable.value ? "暂时无法获取进度" : ready.value ? "工作空间准备好了" : failed.value ? "工作空间准备失败" : stale.value ? "暂未收到新的进度" : ({ validating: "正在验证仓库访问", connecting: "正在连接仓库", counting: "正在统计仓库对象", compressing: "正在压缩仓库对象", receiving: "正在下载项目代码", resolving: "正在整理项目文件", checkout: "正在整理项目文件", publishing: "正在校验工作空间" })[progress.value?.stage] || "正在准备工作空间");
const description = computed(() => props.submitting ? "正在确认请求是否受理，请稍候。" : unavailable.value ? "创建结果尚未确认。重新连接后继续查询本次创建，无需重复提交。" : ready.value ? "项目代码已准备完成，现在可以进入工作台。" : failed.value ? "账号选择已保留，请检查失败原因后重新尝试。" : stale.value ? "正在查询最新状态。等待较久并不代表创建失败，无需重复提交。" : "首次使用需要准备仓库副本，耗时取决于仓库大小和网络情况。");
const percent = computed(() => props.submitting ? null : progress.value?.percent ?? null);
const showMeter = computed(() => !ready.value && !failed.value);
const number = value => new Intl.NumberFormat(i18n.global.locale.value).format(value);
function duration(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function date(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat(i18n.global.locale.value, { dateStyle: "medium", timeStyle: "medium" }).format(time) : "—";
}
</script>

<template>
  <div class="space-progress" :class="{ 'space-progress-ready': ready, 'space-progress-failed': failed }">
    <div ref="heading" class="space-progress-title" role="status" aria-live="polite" tabindex="-1">
      <CheckOutlined v-if="ready" aria-hidden="true" />
      <ExclamationCircleOutlined v-else-if="failed || unavailable || stale" aria-hidden="true" />
      <span v-else class="space-spinner" aria-hidden="true"></span>
      <h3>{{ $t(title) }}</h3>
    </div>
    <p class="space-description">{{ $t(description) }}</p>
    <ol v-if="!submitting" class="space-steps" :aria-label="$t('工作空间创建阶段')">
      <li v-for="(label, index) in stages" :key="label" :class="{ done: index < phase, active: index === phase && !failed }" :aria-current="index === phase && !failed ? 'step' : undefined">
        <span class="space-step-marker"><CheckOutlined v-if="index < phase" aria-hidden="true" /><span v-else>{{ index + 1 }}</span></span><span>{{ $t(label) }}</span>
      </li>
    </ol>
    <template v-if="showMeter">
      <div class="space-meter-label"><span>{{ submitting ? $t('等待受理') : $t(unavailable || stale ? '上次进度：{stage}' : '当前阶段：{stage}', { stage: $t(labels[progress?.stage] || '准备工作空间') }) }}</span><strong v-if="percent !== null">{{ number(percent) }}%</strong></div>
      <progress v-if="percent !== null" :value="percent" max="100" :aria-label="$t('当前阶段进度')"></progress>
      <div v-else class="space-indeterminate" :class="{ paused: unavailable || stale }" role="progressbar" :aria-label="$t('正在准备工作空间')"></div>
      <div class="space-telemetry"><span v-if="elapsed !== null">{{ $t('已用时：{elapsed}', { elapsed: duration(elapsed) }) }}</span><span v-if="age !== null && !submitting">{{ age < 5 ? $t('最近更新：刚刚') : $t('最近更新：{seconds} 秒前', { seconds: number(age) }) }}</span></div>
      <p v-if="percent !== null" class="space-stage-note">{{ $t('百分比仅代表当前阶段，各阶段进度单独计算。') }}</p>
    </template>
    <p v-if="failed && space.error" class="space-alert" role="alert">{{ space.error }}</p>
    <div v-if="unavailable && !submitting" class="space-progress-actions"><button type="button" class="primary" :disabled="checking" @click="$emit('reconnect')"><ReloadOutlined aria-hidden="true" />{{ checking ? $t('正在确认…') : $t('重新连接并确认') }}</button></div>
    <slot v-if="ready" name="ready" />
    <template v-else-if="!failed && !submitting">
      <div class="space-progress-actions"><button type="button" @click="$emit('browse')">{{ $t('先浏览项目') }}</button></div>
      <p class="space-footer-note">{{ $t('离开此页不会停止准备，可从项目「代码与环境」返回查看。') }}</p>
    </template>
    <details v-if="progress && !submitting" class="space-details"><summary>{{ $t('查看准备详情') }}</summary><dl><dt>{{ $t('开始时间') }}</dt><dd>{{ date(progress.startedAt) }}</dd><dt>{{ $t('最近进度时间') }}</dt><dd>{{ date(progress.updatedAt) }}</dd><dt>{{ $t('当前阶段') }}</dt><dd>{{ ready ? $t('空间就绪') : $t(labels[progress.stage] || '准备工作空间') }}</dd></dl></details>
  </div>
</template>

<style scoped>
.space-progress { padding-top: 8px; }
.space-progress-title { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; }
.space-progress-title h3 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.5; }
.space-progress-title > .anticon { color: var(--highlight); font-size: 22px; }
.space-progress-ready .space-progress-title > .anticon { color: var(--success); }
.space-progress-failed .space-progress-title > .anticon { color: var(--danger); }
.space-description { margin: 0; color: var(--muted); line-height: 1.8; }
.space-spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid var(--field-border); border-top-color: var(--highlight); border-radius: 50%; animation: space-spin 1s linear infinite; flex-shrink: 0; }
.space-steps { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); list-style: none; padding: 0; gap: 12px; margin: 26px 0; }
.space-steps li { position: relative; display: grid; justify-items: start; gap: 10px; font-size: 13px; color: var(--muted); min-width: 0; }
.space-step-marker { width: 26px; height: 26px; border: 1px solid var(--field-border); background: var(--surface); border-radius: 50%; display: grid; place-items: center; font-size: 12px; }
.space-steps li:not(:last-child)::after { content: ''; position: absolute; top: 13px; left: 37px; width: calc(100% - 37px); border-top: 1px solid var(--line); }
.space-steps .done .space-step-marker { color: var(--highlight); background: var(--selected); border-color: transparent; }
.space-steps .active { color: var(--ink); font-weight: 600; }
.space-steps .active .space-step-marker { background: var(--highlight); color: white; border-color: transparent; }
.space-meter-label { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; margin-bottom: 10px; }
.space-meter-label strong { font-size: 17px; font-weight: 600; }
progress { display: block; width: 100%; height: 7px; appearance: none; border: 0; border-radius: 8px; overflow: hidden; background: var(--soft); }
progress::-webkit-progress-bar { background: var(--soft); }
progress::-webkit-progress-value { background: var(--highlight); border-radius: 8px; }
progress::-moz-progress-bar { background: var(--highlight); }
.space-indeterminate { height: 7px; border-radius: 8px; background: var(--soft); overflow: hidden; }
.space-indeterminate::after { content: ''; display: block; width: 30%; height: 100%; border-radius: 8px; background: var(--highlight); animation: space-glide 2s ease-in-out infinite; }
.space-indeterminate.paused::after { animation: none; opacity: .5; }
.space-telemetry { display: flex; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; margin-top: 12px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.space-stage-note,.space-footer-note { margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.space-progress-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.space-progress-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; }
.space-alert { padding: 14px 16px; color: var(--danger); background: var(--danger-soft); border: 1px solid var(--line); border-radius: var(--radius-control); line-height: 1.8; margin-top: 20px; overflow-wrap: anywhere; }
.space-details { margin-top: 24px; border-top: 1px solid var(--line); padding-top: 6px; color: var(--muted); font-size: 12px; }
.space-details summary { cursor: pointer; padding-block: 12px; min-height: 44px; }
.space-details dl { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 10px 20px; }
.space-details dd { margin: 0; overflow-wrap: anywhere; }
@keyframes space-spin { to { transform: rotate(360deg); } }
@keyframes space-glide { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
@media (max-width:767px) { .space-progress-title { align-items: flex-start; } .space-progress-title h3 { font-size: 18px; } .space-progress-title > .anticon,.space-spinner { margin-top: 3px; } .space-steps { gap: 8px; } .space-steps li { font-size: 12px; } .space-details dl { grid-template-columns: 1fr; gap: 4px; } .space-details dd { margin-bottom: 8px; } }
@media (prefers-reduced-motion:reduce) { .space-spinner,.space-indeterminate::after { animation: none; } }
</style>
