<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { ref, useId } from "vue";
import { useTapdSelection } from "./use-tapd-selection.js";

const props = defineProps({ workspace: { type: String, required: true },
  modelValue: { type: Array, default: () => [] }, disabled: Boolean });
const emit = defineEmits(["update:modelValue", "open-task"]);
const { query, results, searching, error, searched, search } = useTapdSelection(() => props.workspace);
const directId = ref(""), selectionError = ref("");
const id = useId();
function add(item) {
  if (props.disabled || item.localRun) return;
  selectionError.value = "";
  if (props.modelValue.some(entry => entry.id === item.id)) return;
  if (props.modelValue.length >= 20) { selectionError.value = "最多选择 20 条需求。"; return; }
  emit("update:modelValue", [...props.modelValue, { id: item.id, type: item.type, title: item.title || `需求 ${item.id}` }]);
}
function addId() {
  if (!/^\d+$/.test(directId.value.trim())) { selectionError.value = "请填写数字需求 ID。"; return; }
  add({ id: directId.value.trim() });
  directId.value = "";
}
function move(index, offset) {
  const entries = [...props.modelValue];
  [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]];
  emit("update:modelValue", entries);
}
</script>

<template>
  <section class="tapd-picker" aria-label="选择关联需求">
    <label :for="`${id}-query`">检索需求</label>
    <div class="search-row">
      <input :id="`${id}-query`" v-model="query" placeholder="输入需求标题关键词" :disabled="disabled" @keydown.enter.prevent="search" />
      <button type="button" :disabled="disabled || searching || !workspace" @click="search">{{ searching ? '检索中…' : '检索' }}</button>
    </div>
    <div v-if="results.length" class="search-results">
      <div v-for="item in results" :key="item.id" class="tapd-picker-result">
        <button v-if="!item.localRun" type="button" :disabled="disabled || modelValue.some(entry => entry.id === item.id)" @click="add(item)">
          <span>{{ item.title }}</span><small>#{{ item.id }} · {{ modelValue.some(entry => entry.id === item.id) ? '已选择' : '添加' }}</small>
        </button>
        <button v-else type="button" :disabled="disabled" @click="emit('open-task', item.localRun.key)">
          <span>{{ item.title }}</span><small>#{{ item.id }} · {{ item.localRun.archived ? '已归档任务' : '已有任务' }}：{{ item.localRun.title }} · 打开</small>
        </button>
      </div>
    </div>
    <p v-else-if="searched" class="field-hint">没有匹配的待办，也可通过 ID 添加。</p>
    <label :for="`${id}-direct`">通过 ID 添加</label>
    <div class="tapd-picker-direct">
      <input :id="`${id}-direct`" v-model="directId" inputmode="numeric" aria-label="添加需求 ID" :disabled="disabled" @keydown.enter.prevent="addId" />
      <button type="button" :disabled="disabled || !directId.trim()" @click="addId">添加</button>
    </div>
    <p class="field-hint">已选择 {{ modelValue.length }} / 20 条；检索不会清空选择，资料按下方顺序汇总。</p>
    <ol v-if="modelValue.length" class="tapd-selection">
      <li v-for="(item, index) in modelValue" :key="item.id">
        <span>{{ index + 1 }}. {{ item.title }} <small>#{{ item.id }}</small></span>
        <div class="actions">
          <button type="button" :disabled="disabled || index === 0" :aria-label="`上移需求 ${item.id}`" @click="move(index, -1)">上移</button>
          <button type="button" :disabled="disabled || index === modelValue.length - 1" :aria-label="`下移需求 ${item.id}`" @click="move(index, 1)">下移</button>
          <button type="button" :disabled="disabled" :aria-label="`移除需求 ${item.id}`" @click="emit('update:modelValue', modelValue.filter(entry => entry.id !== item.id))">移除</button>
        </div>
      </li>
    </ol>
    <FeedbackMessage :message="error || selectionError" type="error" />
  </section>
</template>

<style scoped>
.tapd-picker { display: grid; gap: 12px; min-width: 0; }
.tapd-picker label { margin: 0; }
.tapd-picker .field-hint { margin: 0; }
.tapd-picker-result button { width: 100%; overflow-wrap: anywhere; }
.tapd-picker-direct { display: flex; flex-wrap: wrap; gap: 8px; }
.tapd-picker-direct input { flex: 1 1 130px; min-width: 0; }
.tapd-selection { padding: 0; margin: 0; list-style: none; display: grid; gap: 8px; }
.tapd-selection li { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); overflow-wrap: anywhere; }
.tapd-selection .actions { margin-top: 8px; gap: 8px; flex-wrap: wrap; }
</style>
