<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
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
    <label>{{ $t("标题") }}<input :value="modelValue.title" required maxlength="200" @input="update('title', $event.target.value)" /></label>
    <MarkdownEditor :model-value="modelValue.description" :label="$t('描述')" :rows="6" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :attachments="attachments" :error="attachmentError" :busy="attachmentBusy" @update:model-value="update('description', $event)" @files="emit('files', $event)" @remove="emit('remove', $event)" />
    <MarkdownEditor v-for="[key, label] in details" :key="key" :model-value="modelValue[key]" :label="$t(label)" :rows="4" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :busy="attachmentBusy" @update:model-value="update(key, $event)" @files="emit('files', $event)" />
    <label>{{ $t("目标版本") }}<AppSelect native-events :aria-label="$t('目标版本')" :value="modelValue.releaseId || ''" @change="update('releaseId', $event.target.value || null)"><option value="">{{ $t("未排期") }}</option><option v-for="release in releases.filter(r => r.status === 'active' || r.id === modelValue.releaseId)" :key="release.id" :value="release.id">{{ release.name }}</option></AppSelect></label>
    <label>{{ $t("优先级") }}<AppSelect native-events :aria-label="$t('优先级')" :value="modelValue.priority" @change="update('priority', $event.target.value)"><option v-for="(label, value) in priorityLabels" :key="value" :value="value">{{ $t(label) }}</option></AppSelect></label>
    <label v-if="type === 'bug'">{{ $t("严重程度") }}<AppSelect native-events :aria-label="$t('严重程度')" :value="modelValue.severity" @change="update('severity', $event.target.value)"><option value="minor">{{ $t("轻微") }}</option><option value="normal">{{ $t("普通") }}</option><option value="major">{{ $t("严重") }}</option><option value="critical">{{ $t("致命") }}</option></AppSelect></label>
    <div class="form-columns"><label>{{ $t("截止日期") }}<input type="date" :value="modelValue.dueDate || ''" @input="update('dueDate', $event.target.value || null)" /></label><label>{{ $t("标签") }}<input :value="(modelValue.tags || []).join(', ')" maxlength="400" :placeholder="$t('用逗号分隔，最多 12 个')" @change="update('tags', $event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))" /></label></div>
  </fieldset>
  <fieldset v-if="canAssign" :disabled="disabled">
    <p class="field-hint">{{ $t("保存事项后，通过「认领」或「指派」确定开发负责人并加入其待开发任务。") }}</p>
    <label>{{ $t("参与人") }}<AppSelect native-events :aria-label="$t('参与人')" multiple @change="update('participantIds', [...$event.target.selectedOptions].map(option => option.value))"><option v-for="p in members" :key="p.userId" :value="p.userId" :selected="modelValue.participantIds.includes(p.userId)">{{ p.displayName }}（{{ p.username }}）</option></AppSelect></label>
  </fieldset>
</template>
