<script setup>
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { Select as ASelect } from 'antdv-next';
import { api } from '../../shared/api/api.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  workspace: { type: String, default: '' },
  channel: { type: String, required: true },
  label: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue']);
const inputId = `assignee-${useId()}`;
const options = ref([]),
  loading = ref(false),
  error = ref(''),
  queried = ref(false);
let timer,
  revision = 0;
const emptyText = computed(() =>
  loading.value
    ? '正在搜索…'
    : error.value
      ? '搜索失败，请重新输入'
      : queried.value
        ? '没有匹配人员'
        : '输入姓名或拼音搜索',
);
function search(query) {
  clearTimeout(timer);
  const current = ++revision;
  options.value = [];
  error.value = '';
  queried.value = false;
  loading.value = Boolean(query.trim() && props.workspace);
  if (!loading.value) return;
  timer = setTimeout(async () => {
    try {
      const result = await api(
        `/users?${new URLSearchParams({ query: query.trim(), workspace: props.workspace, channel: props.channel })}`,
      );
      if (current !== revision) return;
      const unique = new Map(
        result.users
          .filter((user) => user.nick)
          .map((user) => [
            user.nick,
            {
              value: user.nick,
              label:
                user.name && user.name !== user.nick
                  ? `${user.nick}（${user.name}）`
                  : user.nick,
            },
          ]),
      );
      options.value = [...unique.values()];
      queried.value = true;
    } catch (e) {
      if (current === revision) error.value = e.message;
    } finally {
      if (current === revision) loading.value = false;
    }
  }, 250);
}
watch(
  () => [props.workspace, props.channel],
  () => {
    search('');
    emit('update:modelValue', '');
  },
);
onUnmounted(() => {
  clearTimeout(timer);
  revision++;
});
</script>

<template>
  <div class="user-search">
    <label :for="inputId" class="sr-only">{{ label }}</label>
    <a-select
      :id="inputId"
      :value="modelValue || undefined"
      :options="options"
      show-search
      allow-clear
      :filter-option="false"
      :default-active-first-option="false"
      :loading="loading"
      :disabled="!workspace"
      :not-found-content="emptyText"
      placeholder="输入姓名或拼音搜索"
      style="width: 100%"
      @search="search"
      @change="(value) => emit('update:modelValue', value || '')"
    />
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </div>
</template>
