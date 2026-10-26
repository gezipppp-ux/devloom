<script setup>
import { computed, ref, watch } from "vue";
import { useSessionPreview } from "./use-session-preview.js";
import { usePreviewLayout } from "./use-preview-layout.js";
import { FullscreenOutlined, FullscreenExitOutlined } from "@antdv-next/icons";
import AppSelect from "../../shared/components/AppSelect.vue";
const props = defineProps({
  preview: { type: Object, required: true }, runKey: { type: String, required: true },
  readonly: Boolean, canFeedback: Boolean,
  active: Boolean, fullscreen: Boolean, fullscreenChanging: Boolean,
  latestVersion: { type: Number, default: 0 },
});
const emit = defineEmits(["feedback", "fullscreen", "escape"]);
const panel = ref(false), fitting = ref(true), original = ref(false);
const { selected, data, frame, src, loading, error, controls, height, width, ready, saving, dirty, conflict,
  readonly: viewOnly, load, save, select, post, change, feedback } = useSessionPreview(props, emit);
const { root, stage, scale, canvasStyle, frameStyle, stageStyle } = usePreviewLayout(props, height, width, fitting, panel);
watch([scale, fitting, ready], () => { if (ready.value) post("viewport", { scale: scale.value, fitting: fitting.value }); });
const visible = computed(() => controls.value.filter(control => !control.hidden));
const groups = computed(() => {
  const entries = new Map();
  for (const control of visible.value) {
    const name = control.group || props.preview.title;
    if (!entries.has(name)) entries.set(name, []);
    entries.get(name).push(control);
  }
  return [...entries].map(([name, controls]) => ({ name, controls }));
});
function showOriginal(value) { original.value = value; post("original", { active: value }); }
</script>
<template>
  <section ref="root" class="session-preview" :class="{ 'is-fullscreen': fullscreen }" :aria-label="preview.title || $t('交互预览')">
    <header class="preview-header">
      <slot name="navigation" />
      <strong :title="data?.title || preview.title || $t('交互预览')">{{ data?.title || preview.title || $t('交互预览') }}</strong>
      <AppSelect v-if="data?.versions.length > 1" :model-value="selected" :aria-label="$t('预览版本')" :disabled="dirty || saving" @update:model-value="select">
        <option v-for="version in data.versions" :key="version.id" :value="version.id">{{ $t('版本 {version}', { version: version.version }) }}</option>
      </AppSelect>
      <div class="preview-display-actions">
        <button type="button" class="text-button preview-fit" :disabled="!ready" @click="fitting = !fitting">{{ fitting ? $t('原始大小') : $t('适应窗口') }}</button>
        <button type="button" class="text-button preview-fullscreen" :aria-label="fullscreen ? $t('退出全屏') : $t('全屏预览')" :aria-pressed="fullscreen" :disabled="fullscreenChanging" @click="emit('fullscreen')">
          <FullscreenExitOutlined v-if="fullscreen" aria-hidden="true" /><FullscreenOutlined v-else aria-hidden="true" />{{ fullscreen ? $t('退出全屏') : $t('全屏') }}
        </button>
      </div>
    </header>
    <p v-if="loading" class="preview-status" role="status">{{ $t('正在加载预览…') }}</p>
    <div v-show="src" ref="stage" class="preview-stage" :class="{ 'preview-original': original, fitting }" :style="stageStyle">
      <div v-if="src" class="preview-canvas" :style="canvasStyle">
        <iframe ref="frame" :src="src" sandbox="allow-scripts" referrerpolicy="no-referrer" :inert="original" :title="data?.title || $t('交互预览')" :style="frameStyle" />
      </div>
    </div>
    <p v-if="viewOnly && data" class="preview-status">{{ $t('历史版本或只读会话：可以查看和引用，调整不会保存。') }}</p>
    <footer class="preview-footer">
      <span role="status"><span>{{ loading || !ready ? $t('等待预览') : saving ? $t('正在保存调整…') : dirty ? $t('调整尚未保存') : data?.savedAt ? $t('交互状态已保存') : $t('可交互预览') }}</span><small v-if="ready && scale < .99" class="preview-scale">{{ Math.round(scale * 100) }}%</small></span>
      <button type="button" class="text-button" :aria-expanded="panel" :disabled="!ready" @click="panel = !panel">{{ panel ? $t('收起调整') : $t('调整预览') }}</button>
      <button type="button" class="text-button" :disabled="!ready || !canFeedback" @click="feedback()">{{ $t('引用并续聊') }}</button>
    </footer>
    <div v-if="panel" class="preview-adjustments">
      <p v-if="!visible.length" class="preview-status">{{ $t('此预览未提供调整项，可以直接在预览中操作或引用续聊。') }}</p>
      <fieldset v-for="group in groups" :key="group.name" :disabled="viewOnly || original">
        <legend>{{ group.name }}</legend>
        <div v-for="control in group.controls" :key="control.id" class="preview-control">
          <label :for="`control-${preview.id}-${control.id}`">{{ control.label }} <span v-if="control.kind === 'slider'">{{ control.value }}{{ control.unit }}</span></label>
          <input v-if="control.kind === 'slider'" :id="`control-${preview.id}-${control.id}`" type="range" :min="control.min" :max="control.max" :step="control.step" :value="control.value" @input="change(control, Number($event.target.value))" />
          <input v-else-if="control.kind === 'color'" :id="`control-${preview.id}-${control.id}`" type="color" :value="control.value" @input="change(control, $event.target.value)" />
          <input v-else-if="control.kind === 'toggle'" :id="`control-${preview.id}-${control.id}`" type="checkbox" :checked="control.value" @change="change(control, $event.target.checked)" />
          <AppSelect v-else :id="`control-${preview.id}-${control.id}`" :model-value="control.value" @update:model-value="change(control, $event)">
            <option v-for="option in control.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </AppSelect>
        </div>
      </fieldset>
      <div v-if="visible.length" class="preview-reset">
        <button type="button" class="text-button" :disabled="viewOnly || original" @click="post('reset')">{{ $t('重置调整') }}</button>
        <button type="button" class="text-button" :aria-pressed="original" @click="showOriginal(!original)">{{ original ? $t('返回调整结果') : $t('查看原始效果') }}</button>
      </div>
    </div>
    <div v-if="error" class="preview-error" role="alert">
      <p>{{ $t(error) }}</p>
      <button v-if="dirty && !conflict" type="button" :disabled="saving" @click="save">{{ $t('重试保存') }}</button>
      <button type="button" :disabled="saving" @click="load">{{ dirty ? $t('放弃调整并重新载入') : $t('重新载入预览') }}</button>
    </div>
  </section>
</template>
<style scoped>
.session-preview { min-width: 0; background: var(--surface); font-size: 13px; line-height: 1.6; }
.session-preview.is-fullscreen { height: 100%; overflow: auto; }
.preview-header, .preview-footer { display: flex; gap: 6px 12px; align-items: center; flex-wrap: wrap; padding: 8px 12px; }
.preview-header { border-bottom: 1px solid var(--line); }
.preview-header strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 500; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.preview-header > .app-select { width: 116px; flex: 0 0 116px; font-size: 12px; }
.preview-stage { display: flex; align-items: flex-start; overflow: auto; background: var(--soft); }
.preview-stage.fitting { justify-content: center; }
.preview-canvas { position: relative; flex: none; overflow: hidden; }
.preview-stage iframe { display: block; position: absolute; inset: 0 auto auto 0; border: 0; transform-origin: top left; }
.preview-fullscreen { display: inline-flex; align-items: center; gap: 6px; }
.preview-display-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.preview-scale { margin-left: 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
.is-fullscreen .preview-adjustments { max-height: 28dvh; overflow: auto; }
.is-fullscreen .preview-stage.fitting { align-items: center; }
.preview-original iframe { pointer-events: none; }
.preview-footer { border-top: 1px solid var(--line); }
.preview-footer span { flex: 1; min-width: 110px; color: var(--muted); font-size: 12px; }
.preview-status { margin: 0; padding: 10px 14px; color: var(--muted); font-size: 12px; }
.preview-adjustments { background: var(--surface-hover); padding: 14px; border-top: 1px solid var(--line); }
fieldset { min-width: 0; border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
fieldset + fieldset { margin-top: 20px; }
legend { padding: 0 0 10px; font-size: 12px; color: var(--muted); }
.preview-control { display: grid; align-content: start; gap: 6px; min-width: 0; }
.preview-control label { overflow-wrap: anywhere; }
.preview-control label span { float: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.preview-control input[type='range'] { width: 100%; padding: 0; accent-color: var(--highlight); }
.preview-control input[type='checkbox'] { width: 18px; height: 18px; }
.preview-control input[type='color'] { width: 64px; padding: 3px; }
.preview-reset { display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; }
.preview-error { padding: 10px 14px; border-top: 1px solid var(--line); color: var(--danger); overflow-wrap: anywhere; }
.preview-error p { margin: 0 0 8px; } .preview-error button { margin: 0 8px 4px 0; }
@media (max-width: 767px) {
  .preview-header, .preview-footer { padding: 6px 10px; gap: 4px 8px; }
  .preview-header button, .preview-footer button, .preview-reset button { min-height: 44px; }
  .preview-footer > span { flex-basis: 100%; }
  .preview-footer > button { flex: 1; }
  fieldset { grid-template-columns: minmax(0, 1fr); }
  .preview-control select, .preview-control input { min-height: 44px; }
}
</style>
