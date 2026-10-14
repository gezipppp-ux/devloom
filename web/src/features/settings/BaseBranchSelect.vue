<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, onUnmounted, ref, useId, watch } from "vue";
import { Select as ASelect } from "antdv-next";
import { api } from "../../shared/api/api.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  repository: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const inputId = `base-branch-${useId()}`;
const branches = ref([]),
  loading = ref(false),
  error = ref(""),
  query = ref("");
let timer,
  revision = 0;
const options = computed(() => {
  const list = [...branches.value];
  if (props.modelValue && !list.some((item) => item.value === props.modelValue))
    list.push({
      value: props.modelValue,
      label: `当前值 · ${props.modelValue}`,
    });
  const search = query.value.trim();
  if (
    search && !/^(?:HEAD$|refs\/|origin\/)/.test(search) && !/^[a-f\d]{7,64}$/i.test(search) &&
    !list.some((item) => item.value === search)
  )
    list.push({ value: search, label: `使用远端分支 · ${search}` });
  return list.filter((item) =>
    `${item.label} ${item.value}`.toLowerCase().includes(search.toLowerCase()),
  );
});
watch(
  () => props.repository,
  (repository, previous) => {
    clearTimeout(timer);
    const current = ++revision;
    branches.value = [];
    error.value = "";
    query.value = "";
    if (previous && previous !== repository) emit("update:modelValue", "");
    loading.value = Boolean(repository.trim());
    if (!loading.value) return;
    timer = setTimeout(async () => {
      try {
        const result = await api("/settings/branches");
        if (current === revision) branches.value = result.branches;
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
  <label :for="inputId" class="sr-only">{{ $t("新任务开发分支") }}</label>
  <a-select
    :id="inputId"
    :value="modelValue"
    :options="options"
    :loading="loading"
    :disabled="disabled || !repository.trim()"
    :aria-describedby="!repository.trim() ? `${inputId}-hint` : undefined"
    allow-clear
    show-search
    :filter-option="false"
    :not-found-content="
      loading ? '正在读取远端分支…' : '无匹配分支，可输入远端短分支名'
    "
    :placeholder="$t(&quot;选择或输入远端短分支名&quot;)"
    style="width: 100%"
    @search="(value) => (query = value)"
    @change="
      (value) => {
        emit('update:modelValue', value || '');
        query = '';
      }
    "
  />
  <p v-if="!repository.trim()" :id="`${inputId}-hint`" class="base-branch-hint">
    {{ $t("项目仓库由创建工作区时的 Git 地址生成；加载后会显示已获取的 origin 分支。") }}
  </p>
  <FeedbackMessage :message="error ? $t(&quot;分支加载失败：{p0}&quot;, { p0: error }) : ''" type="error" />
</template>

<style scoped>
.base-branch-hint {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
</style>
