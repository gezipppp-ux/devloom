<script setup>
import { computed, ref } from "vue";
import { workspaceIcons, workspaceIcon } from "./workspace-icons.js";
const props = defineProps({
  modelValue: { type: String, default: null },
  name: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const query = ref("");
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
        type="button"
        :aria-pressed="!modelValue"
        @click="emit('update:modelValue', null)"
      >
        恢复默认
      </button>
    </div>
    <input
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
        @click="emit('update:modelValue', icon.id)"
      >
        <component :is="icon.component" aria-hidden="true" /><span>{{
          icon.label
        }}</span>
      </button>
      <p v-if="!filtered.length" class="muted">
        没有匹配的图标，试试其他关键词。
      </p>
    </div>
  </fieldset>
</template>
