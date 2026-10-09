<script setup>
import { ref } from "vue";
import TapdRequirementPicker from "./TapdRequirementPicker.vue";
import { useRequirementAdditions } from "./use-requirement-additions.js";
const props = defineProps({ taskKey: { type: String, required: true }, workspace: { type: String, required: true }, disabled: Boolean });
const emit = defineEmits(["saved", "open-task"]);
const expanded = ref(false);
const { form, busy, error, append, reset } = useRequirementAdditions(() => props.taskKey, () => { expanded.value = false; emit("saved"); });
</script>

<template>
  <section class="append-requirements" aria-label="追加 TAPD 需求">
    <button v-if="!expanded" type="button" :disabled="disabled" @click="expanded = true">追加 TAPD 需求</button>
    <template v-else>
      <h3>追加 TAPD 需求</h3>
      <p class="field-hint">保存后先核对资料，再点击“继续处理新增需求”；沿用当前会话和代码。</p>
      <TapdRequirementPicker v-model="form.items" :workspace="workspace" :disabled="disabled || busy" @open-task="emit('open-task', $event)" />
      <label>融合说明（可选）<textarea v-model="form.supplementaryInstructions" rows="3" maxlength="60000" :disabled="disabled || busy" /></label>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="expanded = false; reset()">取消</button>
        <button class="primary" type="button" :disabled="disabled || busy || !form.items.length" @click="append(workspace)">{{ busy ? '正在准备资料…' : '保存追加资料' }}</button>
      </div>
    </template>
    <p v-if="disabled" class="field-hint">任务空闲且没有待处理审批时，可以追加或处理需求。</p>
  </section>
</template>

<style scoped>
.append-requirements { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
label { display: grid; gap: 8px; margin-top: 20px; }
.actions { flex-wrap: wrap; margin-top: 16px; }
</style>
