<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { formatDate } from "../../shared/i18n/index.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
/* global document, navigator */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { CloseOutlined, ReloadOutlined, CopyOutlined, FileTextOutlined } from "@antdv-next/icons";
import { useSessionFile, useSessionFileList } from "./use-session-files.js";
import { diffRows, splitRows } from "./code-content.js";
import CodeLine from "./CodeLine.vue";
import "./session-files.css";

const props = defineProps({ taskKey: { type: String, required: true }, request: { type: Object, required: true }, status: { type: String, default: "" } });
const emit = defineEmits(["close"]);
const selected = ref(props.request.path || ""), scope = ref(props.request.scope || "task"), mode = ref(props.request.line ? "source" : "diff"), layout = ref("unified");
const closeButton = ref(), codeArea = ref(), copied = ref("");
const targetLine = ref(props.request.line || null);
const list = useSessionFileList(() => props.taskKey, scope);
const { file, loading, error, refresh } = useSessionFile(() => props.taskKey, () => selected.value, scope);
const rows = computed(() => diffRows(file.value?.hunks || []));
const pairs = computed(() => splitRows(rows.value));
const source = computed(() => file.value?.current?.text ?? "");
const lines = computed(() => source.value === "" ? [] : source.value.replace(/\n$/, "").split("\n"));
const changed = computed(() => rows.value.some((row) => ["added", "removed"].includes(row.type)));
const totals = computed(() => ({ added: rows.value.filter((row) => row.type === "added").length, removed: rows.value.filter((row) => row.type === "removed").length }));
const choices = computed(() => {
  const files = list.files.value;
  return !selected.value || files.some((entry) => entry.path === selected.value) ? files : [{ path: selected.value, status: "" }, ...files];
});
watch(list.files, files => { if (!selected.value && files.length) choose(files[0].path); });
function choose(path, line = null) { selected.value = path; targetLine.value = line; copied.value = ""; }
function reload() { void refresh(); void list.refresh(); }
async function copy() {
  copied.value = "";
  try { await navigator.clipboard.writeText(source.value); copied.value = "已复制"; }
  catch { copied.value = "复制不可用，可选中源码复制。"; }
}
function escape(event) {
  if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog:modal")) { event.preventDefault(); emit("close"); }
}
watch(() => props.request, (request) => { choose(request.path || list.files.value[0]?.path || "", request.line); if (request.scope) scope.value = request.scope; mode.value = request.line ? "source" : "diff"; if (selected.value === file.value?.path) void refresh(); });
watch(() => props.status, reload);
watch([file, mode], async () => {
  copied.value = "";
  if (file.value?.path) selected.value = file.value.path;
  await nextTick();
  const target = codeArea.value?.querySelector(`[data-line="${targetLine.value}"]`);
  if (target && mode.value === "source") codeArea.value.scrollTop = target.offsetTop - codeArea.value.offsetTop - 48;
  else if (codeArea.value) codeArea.value.scrollTop = 0;
});
onMounted(() => { closeButton.value?.focus({ preventScroll: true }); document.addEventListener("keydown", escape); });
onUnmounted(() => document.removeEventListener("keydown", escape));
</script>
<template>
  <aside class="session-file-panel" :aria-label="$t('文件预览与对比')" :aria-busy="loading">
    <header class="file-panel-heading">
      <FileTextOutlined aria-hidden="true" />
      <div><strong>{{ (file?.path || selected || $t('代码变更')).split(/[\\/]/).at(-1) }}</strong><small>{{ file?.path || selected }}</small></div>
      <button type="button" :disabled="loading || list.loading.value" :aria-label="$t('刷新文件与差异')" @click="reload"><ReloadOutlined /></button>
      <button ref="closeButton" type="button" :aria-label="$t('关闭文件预览')" @click="emit('close')"><CloseOutlined /></button>
    </header>
    <div class="code-workspace">
    <nav class="code-file-list" :aria-label="$t('变更的文件')"><h3>{{ $t('变更的文件') }} <small>{{ list.files.value.length }}</small></h3><p v-if="list.loading.value" role="status">{{ $t('正在加载…') }}</p><button v-for="entry in choices" :key="entry.path" type="button" :aria-pressed="selected === entry.path" @click="choose(entry.path)"><span>{{ entry.path }}</span><small>{{ entry.status }}</small></button><p v-if="!list.loading.value && !list.error.value && !choices.length">{{ $t('此范围内没有变更文件。') }}</p></nav>
    <div class="code-file-content">
    <div class="file-picker">
      <AppSelect native-events :aria-label="$t('预览文件')" :value="selected" @change="choose($event.target.value)"><option v-for="entry in choices" :key="entry.path" :value="entry.path">{{ entry.status }} {{ entry.path }}</option></AppSelect>
    </div>
    <FeedbackMessage :message="list.error.value ? $t('变更列表：{p0}', { p0: list.error.value }) : ''" type="error" />
    <nav class="file-mode-tabs" :aria-label="$t('文件查看方式')">
      <button type="button" :aria-pressed="mode === 'source'" @click="mode = 'source'">{{ $t("源码") }}</button>
      <button type="button" :aria-pressed="mode === 'diff'" @click="mode = 'diff'">{{ $t("变更对比") }}</button>
      <span v-if="file?.path && !file.comparisonReason" class="file-delta"><span class="file-added">+{{ totals.added }}</span><span class="file-removed">−{{ totals.removed }}</span></span>
    </nav>
    <div class="file-controls">
      <label>{{ $t("比较范围") }}<AppSelect native-events v-model="scope" :aria-label="$t('文件比较范围')"><option value="task">{{ $t("任务累计变更") }}</option><option value="head">{{ $t("未提交变更") }}</option></AppSelect></label>
      <label v-if="mode === 'diff'" class="file-layout-choice">{{ $t("显示方式") }}<AppSelect native-events v-model="layout" :aria-label="$t('差异显示方式')"><option value="unified">{{ $t("统一差异") }}</option><option value="split">{{ $t("左右对照") }}</option></AppSelect></label>
      <button v-else type="button" :disabled="!file?.current?.exists || file?.current?.text == null" @click="copy"><CopyOutlined /> {{ $t("复制源码") }}</button>
    </div>
    <FeedbackMessage :message="copied" :type="copied === '已复制' ? 'success' : 'error'" />
    <div ref="codeArea" class="file-code-area">
      <p v-if="loading" class="file-feedback" role="status">{{ $t("正在读取文件…") }}</p>
      <div v-else-if="error" class="file-feedback"><FeedbackMessage :message="error" type="error" /><button type="button" @click="reload">{{ $t("重试") }}</button></div>
      <div v-else-if="file?.candidates" class="file-candidates"><p>{{ $t("找到多个同名文件，请选择完整路径：") }}</p><button v-for="path in file.candidates" :key="path" type="button" @click="choose(path)">{{ path }}</button></div>
<p v-else-if="!selected" class="file-feedback">{{ $t(list.loading.value ? '正在加载…' : '此范围内没有变更文件。') }}</p>
      <template v-else-if="file?.path">
        <template v-if="mode === 'source'">
          <p v-if="file.current.reason" class="file-feedback">{{ file.current.reason }}</p>
          <p v-else-if="!file.current.exists" class="file-feedback">{{ $t("当前文件已删除，可切换「变更对比」查看删除前内容。") }}</p>
          <p v-else-if="!lines.length" class="file-feedback">{{ $t("这是一个空文件。") }}</p>
          <div v-else class="file-source" :aria-label="$t('当前文件源码')"><div v-for="(text, index) in lines" :key="index" class="file-source-line" :class="{ 'file-target-line': index + 1 === targetLine }" :data-line="index + 1"><span class="file-line-number">{{ index + 1 }}</span><CodeLine :text="text" :path="file.path" /></div></div>
        </template>
        <template v-else>
          <div class="file-compare-caption">{{ scope === 'task' ? $t("任务开始时") : $t("最新提交") }} · {{ file.base?.slice(0, 8) || $t("不可用") }} {{ $t("→ 当前文件") }}<span v-if="file.previousPath !== file.path">{{ $t("重命名自") }} {{ file.previousPath }}</span></div>
          <p v-if="file.comparisonReason" class="file-feedback">{{ file.comparisonReason }}</p>
          <p v-else-if="!changed" class="file-feedback">{{ file.status === 'R' ? $t("文件已重命名，内容没有变化。") : $t("此范围内没有内容差异。") }}</p>
          <div v-else class="file-diff" :class="{ 'file-diff-split': layout === 'split' }" :aria-label="$t('文件差异')">
            <div class="file-unified"><template v-for="row in rows" :key="row.key"><div v-if="row.type === 'hunk' || row.type === 'note'" class="file-hunk">{{ row.text }}</div><div v-else class="file-diff-line" :class="row.type"><span class="file-line-number">{{ row.old }}</span><span class="file-line-number">{{ row.next }}</span><span class="file-mark">{{ row.mark }}</span><CodeLine :text="row.text" :path="file.path" /></div></template></div>
            <div v-if="layout === 'split'" class="file-split"><div class="file-split-caption"><span>{{ $t("修改前") }}</span><span>{{ $t("当前文件") }}</span></div><template v-for="row in pairs" :key="row.key"><div v-if="row.type === 'hunk' || row.type === 'note'" class="file-hunk">{{ row.left.text }}</div><div v-else class="file-split-row"><div v-for="side in ['left', 'right']" :key="side" class="file-split-line" :class="row[side]?.type"><span class="file-line-number">{{ side === 'left' ? row.left?.old : row.right?.next }}</span><span class="file-mark">{{ row[side]?.mark }}</span><CodeLine :text="row[side]?.text || ''" :path="file.path" /></div></div></template></div>
          </div>
        </template>
      </template>
    </div>
    </div></div>
    <footer class="file-panel-footer"><span>{{ $t("只读 · 当前 Worktree") }}</span><span v-if="file?.readAt">{{ $t("读取于") }} {{ formatDate(file.readAt, { hour: "2-digit", minute: "2-digit" }) }}</span><small>{{ $t("历史消息链接打开当前文件，不代表该轮结束时的版本。") }}</small></footer>
  </aside>
</template>

<style scoped>
.session-file-panel { border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; background: var(--surface); }
.code-workspace { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); flex: 1; min-height: 0; }
.code-file-list { padding: 18px 12px; overflow: auto; border-right: 1px solid var(--line); }
.code-file-list h3 { margin: 0 8px 20px; font-size: 14px; }
.code-file-list small { color: var(--muted); font-size: 12px; }
.code-file-list button { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 12px; border: 0; background: transparent; text-align: left; font: 12px/1.7 var(--font-code); overflow-wrap: anywhere; }
.code-file-list button[aria-pressed="true"] { background: var(--selected); color: var(--highlight); }
.code-file-content { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.file-picker { display: none; }
.file-panel-heading { padding: 16px 18px; }
.file-mode-tabs { gap: 12px; }
.file-mode-tabs button { font-size: 12px; }
.file-mode-tabs button[aria-pressed="true"] { color: var(--highlight); border-bottom-color: var(--highlight); background: transparent; }
.file-controls, .file-picker { background: var(--surface); }
.file-code-area { padding-block: 8px; }
.file-panel-footer { padding: 12px 18px; }
@media (max-width: 767px) {
  .code-workspace { grid-template-columns: minmax(0, 1fr); }
  .code-file-list { display: none; }
  .file-picker { display: flex; }
  .file-panel-heading { padding: 12px; }
  .file-panel-heading > button { min-height: 44px; min-width: 44px; }
}
</style>
