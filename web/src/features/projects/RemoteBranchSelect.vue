<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { formatDate } from "../../shared/i18n/index.js";
import { computed, useId } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
const props = defineProps({
  projectId: { type: String, required: true },
  modelValue: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const inputId = `remote-branch-${useId()}`;
const { data, loading, error, reload } = useResource(() =>
  appApi(`/projects/${props.projectId}/branches`),
);
const branches = computed(() =>
  (data.value?.branches || []).map(branch => ({ value: branch.name, label: branch.name })),
);
function filterBranch(input, option) {
  return option.label.toLowerCase().includes(input.trim().toLowerCase());
}
function refresh() {
  emit("update:modelValue", "");
  data.value = null;
  void reload();
}
</script>
<template>
  <section class="project-form development-branch-select">
    <div class="development-branch-field">
      <label :for="inputId">{{ $t("起始分支") }}</label>
      <AppSelect
        :id="inputId"
        :value="modelValue || undefined"
        :options="branches"
        show-search
        allow-clear
        :filter-option="filterBranch"
        :default-active-first-option="false"
        :loading="loading"
        :disabled="disabled || loading || Boolean(error)"
        aria-required="true"
        :placeholder="$t('搜索并选择远端分支')"
        :not-found-content="loading ? '正在读取远端分支…' : '没有匹配的远端分支。'"
        @change="value => emit('update:modelValue', value || '')"
      />
    </div>
    <button type="button" :disabled="disabled || loading" @click="refresh">
      {{ loading ? $t("正在读取远端…") : $t("刷新远端分支") }}
    </button>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="data && !branches.length" class="field-hint">
      {{ $t("没有匹配的远端分支。") }}
    </p>
    <p class="field-hint">
      {{ $t("实时读取远端分支；启动时获取最新提交。读取失败请刷新重试。") }}
    </p>
    <p v-if="data?.fetchedAt" class="field-hint">
      {{ $t("读取时间：") }}{{ formatDate(data.fetchedAt, { hour: "2-digit", minute: "2-digit" }) }}
    </p>
  </section>
</template>

<style scoped>
.development-branch-field {
  display: grid;
  gap: 8px;
  min-width: 0;
}
</style>
