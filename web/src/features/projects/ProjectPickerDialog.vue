<script setup>
import { computed, ref } from "vue";
import { ArrowRightOutlined, CloseOutlined, LoadingOutlined, SearchOutlined } from "@antdv-next/icons";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
const props = defineProps({ title: { type: String, required: true }, purpose: { type: String, required: true }, projects: { type: Array, required: true }, busy: Boolean, selectedId: { type: String, default: "" }, error: { type: String, default: "" } });
const emit = defineEmits(["choose", "close"]);
const query = ref(""), list = ref(null);
const searchable = computed(() => props.projects.length > 5);
const matches = computed(() => props.projects.filter(project => !searchable.value || `${project.name} ${project.description || ""}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
function escapeInput(event) { if (event.isComposing) return; event.preventDefault(); event.stopPropagation(); emit("close"); }
function move(event) {
  if (event.isComposing || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...(list.value?.querySelectorAll("button:not(:disabled)") || [])];
  if (!buttons.length || event.target.tagName === "INPUT" && ["Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = buttons.indexOf(event.target.closest("button"));
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? event.key === "ArrowUp" ? buttons.length - 1 : 0 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
}
</script>
<template>
  <ModalDialog open class="project-picker-dialog" :title="$t(title)" @close="emit('close')">
    <template #header><div><h2>{{ $t('选择项目') }}</h2><p>{{ $t(purpose) }}</p></div><button type="button" :aria-label="$t('关闭弹窗')" @click="emit('close')"><CloseOutlined aria-hidden="true" /></button></template>
    <FeedbackMessage :message="error" type="error" />
    <label v-if="searchable" class="project-picker-search"><SearchOutlined aria-hidden="true" /><input v-model="query" autofocus type="search" :aria-label="$t('搜索项目')" :placeholder="$t('搜索项目')" @keydown="move" @keydown.esc="escapeInput" /></label>
    <div ref="list" class="ui-project-choices project-picker-list" :aria-busy="busy" @keydown="move"><button v-for="(project, index) in matches" :key="project.id" type="button" :disabled="busy" :autofocus="!searchable && index === 0" @click="emit('choose', project.id)"><span class="project-picker-symbol" aria-hidden="true">{{ project.name.slice(0, 1) }}</span><span class="project-picker-copy"><strong>{{ project.name }}</strong><small v-if="project.description?.trim()">{{ project.description }}</small></span><LoadingOutlined v-if="busy && selectedId === project.id" spin aria-hidden="true" /><ArrowRightOutlined v-else aria-hidden="true" /></button></div>
    <p v-if="busy" class="project-picker-message" role="status">{{ $t('正在读取开发空间…') }}</p>
    <p v-if="!matches.length" class="project-picker-message" role="status">{{ $t(projects.length ? '没有匹配的项目。' : '暂无允许此操作的项目，请先创建项目或联系项目负责人授权。') }}</p>
  </ModalDialog>
</template>
<style>
.ui-dialog.project-picker-dialog { width: min(480px, calc(100% - 32px)); }
.project-picker-dialog[open] { display: flex; flex-direction: column; }
.ui-dialog.project-picker-dialog > header { padding: 20px 24px 12px; border-bottom: 0; flex-shrink: 0; }
.project-picker-dialog > header p { color: var(--muted); font-size: 12px; margin: 4px 0 0; }
.ui-dialog.project-picker-dialog > header button { display: grid; place-items: center; font-size: 16px; min-height: 36px; width: 36px; flex-shrink: 0; }
.project-picker-dialog > .ui-dialog-body { padding: 4px 14px 14px; min-height: 0; overflow-y: auto; }
.project-picker-dialog .project-picker-list { gap: 2px; }
.project-picker-dialog .project-picker-list > button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 10px; border: 0; background: transparent; }
.project-picker-list > button:hover { background: var(--soft); }
.project-picker-list .project-picker-symbol { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; background: var(--soft); flex-shrink: 0; }
.project-picker-copy { flex: 1; min-width: 0; }
.project-picker-copy strong { display: block; font-weight: 500; overflow-wrap: anywhere; }
.project-picker-copy small { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
.project-picker-list > button > .anticon { color: var(--muted); flex-shrink: 0; }
.project-picker-search { display: flex; align-items: center; gap: 8px; margin: 0 10px 10px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-control); color: var(--muted); }
.project-picker-search input:not([type="checkbox"]) { width: 100%; min-width: 0; border: 0; background: transparent; padding: 10px 0; }
.project-picker-message { margin: 10px; color: var(--muted); font-size: 13px; }
@media (max-width: 767px) { .ui-dialog.project-picker-dialog > header { padding: 16px 20px 10px; } .ui-dialog.project-picker-dialog > header button { width: 44px; min-height: 44px; } .project-picker-search input { font-size: 16px; } }
</style>
