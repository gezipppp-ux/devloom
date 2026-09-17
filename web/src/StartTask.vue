<script setup>
/* global crypto */
import { computed, reactive, ref, watch } from 'vue';
import UserSearchSelect from './UserSearchSelect.vue';
import ManualRequirementFields from './ManualRequirementFields.vue';
import { api } from './api';
const props = defineProps({
  workspace: { type: String, default: '' },
  channels: { type: Array, default: () => [] },
});
const emit = defineEmits(['started', 'cancel']);
const form = reactive({
  channel: props.channels[0]?.id || 'tapd',
  workspace: props.workspace,
  id: '',
  developer: '',
  tester: '',
  requestId: crypto.randomUUID(),
  title: '',
  content: '',
  images: [],
  worktreeName: '',
});
const query = ref('');
const items = ref([]);
const error = ref('');
const busy = ref(false);
const uploading = ref(false);
const searched = ref(false);
const selectedChannel = computed(() =>
  props.channels.find((channel) => channel.id === form.channel),
);
const needsAssignees = computed(
  () => selectedChannel.value?.capabilities.assignees,
);
const manualInput = computed(
  () => selectedChannel.value?.capabilities.manualInput,
);
const rules = computed(() =>
  Object.fromEntries(
    [
      'channel',
      ...(manualInput.value ? ['title'] : ['workspace', 'id']),
      ...(needsAssignees.value ? ['developer', 'tester'] : []),
    ].map((key) => [key, [{ required: true, message: '请填写或选择此项' }]]),
  ),
);
watch(
  () => form.channel,
  () => {
    form.workspace = selectedChannel.value?.workspace || '';
    form.id = '';
    form.developer = '';
    form.tester = '';
    items.value = [];
    searched.value = false;
  },
);
watch(
  () => form.workspace,
  () => {
    form.id = '';
    form.developer = '';
    form.tester = '';
    items.value = [];
    searched.value = false;
  },
);
let searchRevision = 0;
watch(
  () => [form.workspace, form.channel],
  () => {
    searchRevision++;
    busy.value = false;
  },
);

async function search() {
  const revision = ++searchRevision;
  busy.value = true;
  error.value = '';
  try {
    const result = (
      await api(
        `/requirements?${new URLSearchParams({ channel: form.channel, workspace: form.workspace, query: query.value })}`,
      )
    ).items;
    if (revision !== searchRevision) return;
    items.value = result;
    searched.value = true;
  } catch (e) {
    if (revision === searchRevision) error.value = e.message;
  } finally {
    if (revision === searchRevision) busy.value = false;
  }
}
async function start() {
  if (busy.value || uploading.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (manualInput.value && !form.content.trim() && !form.images.length)
      throw new Error('请填写需求内容或上传图片。');
    const result = await api(
      '/runs',
      manualInput.value
        ? {
            channel: form.channel,
            requestId: form.requestId,
            title: form.title,
            content: form.content,
            images: [...form.images],
            worktreeName: form.worktreeName,
          }
        : {
            channel: form.channel,
            workspace: form.workspace,
            id: form.id,
            developer: form.developer,
            tester: form.tester,
          },
    );
    emit('started', result.key);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="start-panel">
    <div class="eyebrow">NEW SESSION</div>
    <h1>从需求，开始开发。</h1>
    <p class="muted">
      检索渠道需求或手动填写图文，在独立 worktree 中启动
      Codex。外部渠道会在执行开始后同步开发状态。
    </p>
    <a-form :model="form" :rules="rules" layout="vertical" @finish="start">
      <a-form-item label="需求渠道" name="channel"
        ><select
          v-model="form.channel"
          aria-label="需求渠道"
          :disabled="busy || uploading"
        >
          <option
            v-for="channel in channels"
            :key="channel.id"
            :value="channel.id"
          >
            {{ channel.label }}
          </option>
        </select></a-form-item
      >
      <ManualRequirementFields
        v-show="manualInput"
        :form="form"
        :disabled="busy || !manualInput"
        @uploading="uploading = $event"
        @change="
          Object.assign(form, $event);
          error = '';
        "
      />
      <a-form-item
        v-if="!manualInput"
        :label="selectedChannel?.scopeLabel || '项目 ID'"
        name="workspace"
        ><input
          v-model="form.workspace"
          :aria-label="selectedChannel?.scopeLabel || '项目 ID'"
          required
      /></a-form-item>
      <label v-if="selectedChannel?.capabilities.search" for="search"
        >检索需求</label
      >
      <div v-if="selectedChannel?.capabilities.search" class="search-row">
        <input
          id="search"
          v-model="query"
          placeholder="输入需求标题关键词"
          @keydown.enter.prevent="search"
        /><button
          type="button"
          :disabled="busy || !form.workspace"
          @click="search"
        >
          检索
        </button>
      </div>
      <div v-if="items.length" class="search-results">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          :class="{ selected: form.id === item.id }"
          @click="form.id = item.id"
        >
          <span>{{ item.title }}</span
          ><small>{{ item.id }} · {{ item.status }}</small>
        </button>
      </div>
      <p v-else-if="searched" class="muted">
        当前待办视图没有匹配结果，也可直接填写需求 ID。
      </p>
      <a-form-item v-if="!manualInput" label="需求 ID" name="id"
        ><input v-model="form.id" aria-label="需求 ID" required
      /></a-form-item>
      <div v-if="needsAssignees" class="form-columns">
        <a-form-item label="开发人员" name="developer"
          ><UserSearchSelect
            v-model="form.developer"
            :channel="form.channel"
            :workspace="form.workspace"
            label="开发人员"
        /></a-form-item>
        <a-form-item label="测试人员" name="tester"
          ><UserSearchSelect
            v-model="form.tester"
            :channel="form.channel"
            :workspace="form.workspace"
            label="测试人员"
        /></a-form-item>
      </div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="actions">
        <button
          type="button"
          :disabled="busy || uploading"
          @click="emit('cancel')"
        >
          取消</button
        ><button class="primary" :disabled="busy || uploading" type="submit">
          {{ busy ? '正在处理…' : '创建 session 并开始开发 →' }}
        </button>
      </div>
    </a-form>
  </section>
</template>
