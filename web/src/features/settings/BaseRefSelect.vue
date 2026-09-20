<script setup>
import { computed, onUnmounted, ref, useId, watch } from "vue";
import { Select as ASelect } from "antdv-next";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  modelValue: { type: String, default: "HEAD" },
  repository: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const inputId = `base-ref-${useId()}`;
const refs = ref([]),
  loading = ref(false),
  error = ref(""),
  query = ref("");
let timer,
  revision = 0;
const options = computed(() => {
  const list = [...refs.value];
  if (!list.some((item) => item.value === "HEAD"))
    list.unshift({ value: "HEAD", label: "HEAD · 当前检出提交" });
  if (props.modelValue && !list.some((item) => item.value === props.modelValue))
    list.push({
      value: props.modelValue,
      label: `当前值 · ${props.modelValue}`,
    });
  const search = query.value.trim();
  if (
    /^[a-f\d]{7,64}$/i.test(search) &&
    !list.some((item) => item.value === search)
  )
    list.push({ value: search, label: `使用 commit · ${search}` });
  return list.filter((item) =>
    `${item.label} ${item.value}`.toLowerCase().includes(search.toLowerCase()),
  );
});
watch(
  () => props.repository,
  (repository, previous) => {
    clearTimeout(timer);
    const current = ++revision;
    refs.value = [];
    error.value = "";
    query.value = "";
    if (previous && previous !== repository) emit("update:modelValue", "HEAD");
    loading.value = Boolean(repository.trim());
    if (!loading.value) return;
    timer = setTimeout(async () => {
      try {
        const result = await api(
          `/settings/refs?${new URLSearchParams({ repository })}`,
        );
        if (current === revision) refs.value = result.refs;
      } catch (e) {
        if (current === revision) error.value = e.message;
      } finally {
        if (current === revision) loading.value = false;
      }
    }, 300);
  },
  { immediate: true },
);
onUnmounted(() => {
  clearTimeout(timer);
  revision++;
});
</script>

<template>
  <label :for="inputId" class="sr-only">新任务基准引用</label>
  <a-select
    :id="inputId"
    :value="modelValue"
    :options="options"
    :loading="loading"
    :disabled="disabled || !repository.trim()"
    :aria-describedby="!repository.trim() ? `${inputId}-hint` : undefined"
    show-search
    :filter-option="false"
    :not-found-content="
      loading ? '正在读取仓库引用…' : '无匹配引用，可输入 commit SHA'
    "
    placeholder="选择分支、标签或输入 commit SHA"
    style="width: 100%"
    @search="(value) => (query = value)"
    @change="
      (value) => {
        emit('update:modelValue', value);
        query = '';
      }
    "
  />
  <p v-if="!repository.trim()" :id="`${inputId}-hint`" class="base-ref-hint">
    请先填写上方的“项目代码仓库”绝对路径，填写后会自动加载分支和标签，无需先保存。
  </p>
  <p v-if="error" role="alert" class="error">引用加载失败：{{ error }}</p>
</template>

<style scoped>
.base-ref-hint {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
</style>
