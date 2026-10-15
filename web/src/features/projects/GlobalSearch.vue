<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { BugOutlined, CloseOutlined, CodeOutlined, FileTextOutlined, FolderOutlined, InboxOutlined, SearchOutlined } from "@antdv-next/icons";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { useGlobalSearch } from "./use-global-search.js";
const props = defineProps({ projects: { type: Array, default: () => [] } });
const emit = defineEmits(["close"]);
const router = useRouter(), results = ref(null);
const { query, rows, recent, loading, error, search } = useGlobalSearch(() => props.projects);
const label = computed(() => query.value.trim() ? "搜索结果" : recent.value ? "最近项目" : "可访问项目");
const rowType = row => row.kind === "projects" ? "项目" : row.kind === "tasks" ? "我的开发" : row.kind === "deliveries" ? "交付" : row.type === "bug" ? "Bug" : "需求";
const rowIcon = row => row.kind === "projects" ? FolderOutlined : row.kind === "tasks" ? CodeOutlined : row.kind === "deliveries" ? InboxOutlined : row.type === "bug" ? BugOutlined : FileTextOutlined;
function open(row) { emit("close"); void router.push(row.location); }
function escapeInput(event) { if (event.isComposing) return; event.preventDefault(); event.stopPropagation(); emit("close"); }
function move(event) {
  if (event.isComposing || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(results.value?.querySelectorAll("button") || [])];
  if (!buttons.length || event.target.tagName === "INPUT" && ["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = buttons.indexOf(event.target.closest("button"));
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? event.key === "ArrowUp" ? buttons.length - 1 : 0 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
}
function enter(event) { if (event.isComposing) return; event.preventDefault(); if (rows.value.length) open(rows.value[0]); else search(); }
</script>
<template>
  <ModalDialog open class="quick-search-dialog" :title="$t('搜索项目与工作')" @close="emit('close')">
    <template #header><SearchOutlined aria-hidden="true" /><input v-model="query" autofocus type="search" :aria-label="$t('搜索项目与工作')" :placeholder="$t('搜索项目与工作…')" maxlength="200" @keydown="move" @keydown.enter="enter" @keydown.esc="escapeInput" /><button type="button" :aria-label="$t('关闭弹窗')" @click="emit('close')"><CloseOutlined aria-hidden="true" /></button></template>
    <FeedbackMessage :message="error" type="error" />
    <div v-if="error" class="quick-search-error"><span>{{ $t('部分内容读取失败，可重试。') }}</span><button type="button" @click="search">{{ $t('重试') }}</button></div>
    <p v-if="loading" class="quick-search-state" role="status">{{ $t('正在搜索…') }}</p>
    <template v-else-if="rows.length"><div class="quick-search-label"><span>{{ $t(label) }}</span><span aria-live="polite">{{ $t('{count} 条', { count: rows.length }) }}</span></div><div ref="results" class="quick-search-results" @keydown="move"><button v-for="row in rows" :key="row.key" type="button" class="quick-search-row" @click="open(row)"><component :is="rowIcon(row)" aria-hidden="true" /><span><strong>{{ row.title }}</strong><small v-if="row.description">{{ row.description }}</small></span><span class="quick-search-type">{{ $t(rowType(row)) }}</span></button></div></template>
    <div v-else-if="!error" class="quick-search-state" role="status"><strong>{{ $t(query.trim() ? '没有找到匹配内容' : '暂无可访问的项目') }}</strong><p>{{ $t(query.trim() ? '试试更短的关键词。' : '输入关键词，搜索你有权访问的工作内容。') }}</p></div>
    <template #footer><span class="quick-search-keys"><kbd>↑</kbd><kbd>↓</kbd>{{ $t('选择') }}<kbd>Enter</kbd>{{ $t('打开') }}</span><span>{{ $t('仅搜索有权访问的内容，开发任务仅本人可见。') }}</span></template>
  </ModalDialog>
</template>
<style>
.ui-dialog.quick-search-dialog { width: min(600px, calc(100% - 32px)); }
.quick-search-dialog[open] { display: flex; flex-direction: column; }
.ui-dialog.quick-search-dialog > header { padding: 14px 18px; gap: 12px; flex-shrink: 0; }
.quick-search-dialog > header > .anticon { color: var(--muted); flex-shrink: 0; }
.quick-search-dialog > header input[type="search"] { width: 100%; min-width: 0; padding: 8px 0; border: 0; background: transparent; }
.ui-dialog.quick-search-dialog > header > button { display: grid; place-items: center; flex-shrink: 0; width: 36px; min-height: 36px; font-size: 16px; }
.quick-search-dialog > .ui-dialog-body { padding: 10px; min-height: 0; overflow-y: auto; }
.quick-search-label { display: flex; justify-content: space-between; gap: 12px; padding: 2px 10px 6px; color: var(--muted); font-size: 12px; }
.quick-search-results { display: grid; gap: 2px; }
.quick-search-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 10px; border: 0; background: transparent; text-align: left; }
.quick-search-row:hover, .quick-search-row:focus-visible { background: var(--selected); }
.quick-search-row > .anticon { color: var(--muted); flex-shrink: 0; }
.quick-search-row > span:nth-child(2) { flex: 1; min-width: 0; }
.quick-search-row strong { display: block; overflow-wrap: anywhere; font-weight: 500; }
.quick-search-row small { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.quick-search-type { flex-shrink: 0; font-size: 12px; color: var(--muted); }
.quick-search-state { padding: 20px 10px; margin: 0; color: var(--muted); font-size: 13px; }
.quick-search-state strong { color: var(--ink); font-weight: 500; }
.quick-search-state p { margin: 6px 0 0; }
.quick-search-error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 10px 10px; color: var(--muted); font-size: 12px; }
.ui-dialog.quick-search-dialog > footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; flex-shrink: 0; gap: 8px 16px; padding: 12px 20px; color: var(--muted); font-size: 12px; }
.quick-search-keys { display: flex; align-items: center; gap: 4px; }
.quick-search-keys kbd { border: 1px solid var(--line); border-radius: 4px; padding: 1px 4px; font-size: 11px; }
.quick-search-keys kbd:nth-of-type(3) { margin-left: 8px; }
@media (max-width: 767px) { .ui-dialog.quick-search-dialog > header { padding: 10px 14px; gap: 8px; } .ui-dialog.quick-search-dialog > header > button { width: 44px; min-height: 44px; } .quick-search-dialog > header input { font-size: 16px; } .ui-dialog.quick-search-dialog > footer { padding: 10px 14px; } .quick-search-row { gap: 8px; } .quick-search-keys { display: none; } }
</style>
