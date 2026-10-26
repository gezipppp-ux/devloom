<script setup>
import { nextTick, ref } from "vue";
import { LeftOutlined, RightOutlined } from "@antdv-next/icons";
import SessionPreview from "./SessionPreview.vue";
import { usePreviewFullscreen } from "./use-preview-fullscreen.js";

const props = defineProps({
  previews: { type: Array, required: true }, runKey: { type: String, required: true },
  latestVersions: { type: Object, default: () => ({}) }, readonly: Boolean, canFeedback: Boolean,
});
const emit = defineEmits(["feedback"]);
const root = ref(), selected = ref(0), visited = ref([0]);
const { fullscreen, fallback, changing, toggle, exit, keydown } = usePreviewFullscreen(root);
function navigate(delta) {
  selected.value = (selected.value + delta + props.previews.length) % props.previews.length;
  if (!visited.value.includes(selected.value)) visited.value.push(selected.value);
}
async function feedback(value) { await exit(); await nextTick(); emit("feedback", value); }
</script>
<template>
  <section ref="root" class="session-preview-group" :class="{ 'is-fullscreen': fullscreen, 'fallback-fullscreen': fallback }"
    :role="fullscreen ? 'dialog' : 'region'" :aria-modal="fullscreen || undefined" :aria-label="$t('交互预览')" tabindex="-1" @keydown.capture="keydown">
    <template v-for="(preview, index) in previews" :key="preview.id">
      <SessionPreview v-if="visited.includes(index)" v-show="selected === index" :preview="preview" :run-key="runKey"
        :active="selected === index" :fullscreen="fullscreen" :fullscreen-changing="changing"
        :readonly="readonly" :can-feedback="canFeedback" :latest-version="latestVersions[preview.group] || preview.version"
        @feedback="feedback" @fullscreen="toggle" @escape="exit">
        <template v-if="previews.length > 1" #navigation>
          <nav class="preview-navigation" :aria-label="$t('切换预览')">
            <button type="button" class="text-button" :aria-label="$t('上一个预览')" @click="navigate(-1)"><LeftOutlined /></button>
            <span aria-live="polite">{{ index + 1 }} / {{ previews.length }}</span>
            <button type="button" class="text-button" :aria-label="$t('下一个预览')" @click="navigate(1)"><RightOutlined /></button>
          </nav>
        </template>
      </SessionPreview>
    </template>
  </section>
</template>
<style scoped>
.session-preview-group { min-width: 0; margin: 14px 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); overflow: hidden; }
.session-preview-group.is-fullscreen, .session-preview-group.fallback-fullscreen { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; padding: 0; }
.fallback-fullscreen { position: fixed; inset: 0; z-index: 1100; }
.session-preview-group::backdrop { background: var(--canvas); }
.preview-navigation { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.preview-navigation button { display: grid; place-items: center; width: 30px; min-height: 30px; padding: 4px; }
.preview-navigation span { min-width: 42px; text-align: center; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
@media (max-width: 767px) { .preview-navigation button { width: 44px; min-height: 44px; } }
</style>
