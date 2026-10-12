<script setup>
import { computed, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
const props = defineProps({
  projectId: { type: String, required: true },
  modelValue: { type: String, default: "" },
  disabled: Boolean,
});
const emit = defineEmits(["update:modelValue"]);
const query = ref("");
const { data, loading, error, reload } = useResource(() =>
  appApi(`/projects/${props.projectId}/branches`),
);
const branches = computed(() =>
  (data.value?.branches || []).filter((branch) =>
    branch.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
function refresh() {
  emit("update:modelValue", "");
  data.value = null;
  void reload();
}
</script>
<template>
  <section class="project-form development-branch-select">
    <div class="form-columns">
      <label
        >搜索远端分支<input
          v-model="query"
          type="search"
          :disabled="disabled || loading"
          placeholder="按分支名称筛选" /></label
      ><label
        >起始分支<select
          aria-label="起始分支"
          :value="modelValue"
          required
          :disabled="disabled || loading || Boolean(error)"
          @change="emit('update:modelValue', $event.target.value)"
        >
          <option value="" disabled>从远端分支中选择</option>
          <option
            v-for="branch in branches"
            :key="branch.name"
            :value="branch.name"
          >
            {{ branch.name }}
          </option>
        </select></label
      >
    </div>
    <button type="button" :disabled="disabled || loading" @click="refresh">
      {{ loading ? "正在读取远端…" : "刷新远端分支" }}
    </button>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="data && !branches.length" class="field-hint">
      没有匹配的远端分支。
    </p>
    <p class="field-hint">
      实时读取远端分支；启动时获取最新提交。读取失败请刷新重试。
    </p>
    <p v-if="data?.fetchedAt" class="field-hint">
      读取时间：{{ data.fetchedAt }}
    </p>
  </section>
</template>
