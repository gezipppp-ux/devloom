<script setup>
import { computed } from "vue";
import MarkdownEditor from "../../shared/components/MarkdownEditor.vue";
import { priorityLabels } from "./project-labels.js";
const props = defineProps({
  modelValue: { type: Object, required: true }, type: { type: String, required: true },
  canEdit: Boolean, canAssign: Boolean, disabled: Boolean, contextKey: { type: String, required: true },
  releases: { type: Array, default: () => [] }, members: { type: Array, default: () => [] }, images: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] }, attachmentError: { type: String, default: "" }, attachmentBusy: Boolean,
});
const emit = defineEmits(["update:modelValue", "files", "remove"]);
const update = (key, value) => emit("update:modelValue", { ...props.modelValue, [key]: value });
const details = computed(() => props.type === "bug"
  ? [["reproductionSteps", "复现步骤"], ["expectedResult", "预期结果"], ["actualResult", "实际结果"]]
  : [["acceptanceCriteria", "验收标准"]]);
</script>
<template>
  <fieldset :disabled="!canEdit || disabled">
    <label>标题<input :value="modelValue.title" required maxlength="200" @input="update('title', $event.target.value)" /></label>
    <MarkdownEditor :model-value="modelValue.description" label="描述" :rows="6" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :attachments="attachments" :error="attachmentError" :busy="attachmentBusy" @update:model-value="update('description', $event)" @files="emit('files', $event)" @remove="emit('remove', $event)" />
    <MarkdownEditor v-for="[key, label] in details" :key="key" :model-value="modelValue[key]" :label="label" :rows="4" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :busy="attachmentBusy" @update:model-value="update(key, $event)" @files="emit('files', $event)" />
    <label>开发基线分支<input :value="modelValue.baseBranch || ''" aria-label="开发基线分支" placeholder="留空继承项目默认" @input="update('baseBranch', $event.target.value)" /><small class="field-hint">留空继承项目默认开发分支；产品协作无需配置个人 Git，开发人员可在启动前确认。</small></label>
    <label>目标版本<select aria-label="目标版本" :value="modelValue.releaseId || ''" @change="update('releaseId', $event.target.value || null)"><option value="">未排期</option><option v-for="release in releases.filter(r => r.status === 'active' || r.id === modelValue.releaseId)" :key="release.id" :value="release.id">{{ release.name }}</option></select></label>
    <label>优先级<select aria-label="优先级" :value="modelValue.priority" @change="update('priority', $event.target.value)"><option v-for="(label, value) in priorityLabels" :key="value" :value="value">{{ label }}</option></select></label>
    <label v-if="type === 'bug'">严重程度<select aria-label="严重程度" :value="modelValue.severity" @change="update('severity', $event.target.value)"><option value="minor">轻微</option><option value="normal">普通</option><option value="major">严重</option><option value="critical">致命</option></select></label>
  </fieldset>
  <fieldset v-if="canAssign" :disabled="disabled">
    <label>事项负责人<select aria-label="事项负责人" :value="modelValue.assigneeId || ''" @change="update('assigneeId', $event.target.value || null)"><option value="">未分派</option><option v-for="p in members" :key="p.userId" :value="p.userId">{{ p.displayName }}（{{ p.username }}）</option></select></label>
    <label>参与人<select aria-label="参与人" multiple @change="update('participantIds', [...$event.target.selectedOptions].map(option => option.value))"><option v-for="p in members" :key="p.userId" :value="p.userId" :selected="modelValue.participantIds.includes(p.userId)">{{ p.displayName }}（{{ p.username }}）</option></select></label>
  </fieldset>
</template>
