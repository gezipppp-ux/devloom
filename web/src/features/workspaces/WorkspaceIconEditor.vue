<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { workspaceIcons, workspaceIcon } from "./workspace-icons.js";
const props = defineProps({
  modelValue: { type: String, default: null },
  name: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const query = ref("");
const dialog = ref(), trigger = ref(), searchInput = ref();
async function open() {
  query.value = "";
  dialog.value.showModal();
  await nextTick();
  searchInput.value?.focus();
}
function close() { dialog.value?.close(); trigger.value?.focus(); }
function choose(value) { emit("update:modelValue", value); close(); }
watch(() => props.disabled, value => { if (value) dialog.value?.close(); });
const filtered = computed(() => {
  const search = query.value.trim().toLowerCase();
  return workspaceIcons.filter((icon) =>
    `${icon.label} ${icon.id} ${icon.keywords}`.toLowerCase().includes(search),
  );
});
const selected = computed(() =>
  workspaceIcons.find((icon) => icon.id === props.modelValue),
);
</script>

<template>
  <fieldset class="workspace-icon-editor" :disabled="disabled">
    <legend>工作区图标</legend>
    <div class="icon-preview-row">
      <div class="workspace-icon-preview" aria-label="图标预览">
        <component
          :is="workspaceIcon(modelValue)"
          v-if="workspaceIcon(modelValue)"
          aria-hidden="true"
        />
        <span v-else>{{ Array.from(name.trim())[0] || "项" }}</span>
      </div>
      <div class="icon-preview-caption">
        <strong>{{ selected?.label || "名称首字" }}</strong
        ><small>左侧工作区栏显示的图标</small>
      </div>
      <button
        ref="trigger"
        type="button"
        aria-haspopup="dialog"
        @click="open"
      >
        选择图标
      </button>
    </div>
  </fieldset>
  <Teleport to="body">
    <dialog ref="dialog" class="workspace-dialog workspace-icon-dialog" aria-label="选择工作区图标" @cancel.prevent="close">
      <div class="workspace-dialog-heading">
        <h2>选择工作区图标</h2>
        <button type="button" aria-label="关闭图标选择" @click="close">×</button>
      </div>
    <input
      ref="searchInput"
      v-model="query"
      aria-label="搜索图标"
      placeholder="搜索图标，例如：代码、测试、rocket"
      type="search"
    />
    <div class="icon-presets" aria-label="可选工作区图标">
      <button
        v-for="icon in filtered"
        :key="icon.id"
        type="button"
        :title="icon.label"
        :aria-label="`图标：${icon.label}`"
        :aria-pressed="modelValue === icon.id"
        @click="choose(icon.id)"
      >
        <component :is="icon.component" aria-hidden="true" /><span>{{
          icon.label
        }}</span>
      </button>
      <p v-if="!filtered.length" class="muted">
        没有匹配的图标，试试其他关键词。
      </p>
    </div>
      <div class="actions">
        <button type="button" :aria-pressed="!modelValue" @click="choose(null)">恢复默认</button>
        <button type="button" @click="close">取消</button>
      </div>
    </dialog>
  </Teleport>
</template>
