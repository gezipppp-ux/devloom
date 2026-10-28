<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed } from "vue";
import MarkdownEditor from "../../shared/components/MarkdownEditor.vue";
import AcceptanceCriteriaEditor from "./AcceptanceCriteriaEditor.vue";
import { priorityLabels } from "./project-labels.js";
import { issueDetailFields } from "./issue-fields.js";
const props = defineProps({
  modelValue: { type: Object, required: true }, type: { type: String, required: true },
  workflow: { type: Object, default: null },
  canEdit: Boolean, canAssign: Boolean, disabled: Boolean, creation: Boolean, contextKey: { type: String, required: true },
  releases: { type: Array, default: () => [] }, members: { type: Array, default: () => [] }, images: { type: Array, default: () => [] },
  attachments: { type: Array, default: () => [] }, attachmentError: { type: String, default: "" }, attachmentBusy: Boolean,
});
const emit = defineEmits(["update:modelValue", "files", "remove"]);
const update = (key, value) => emit("update:modelValue", { ...props.modelValue, [key]: value });
const details = computed(() => issueDetailFields(props.type, props.workflow, props.modelValue));
</script>
<template>
  <div class="issue-fields" :class="{ 'issue-fields-creation': creation }">
    <div class="issue-fields-main">
      <fieldset class="issue-fields-content" :disabled="!canEdit || disabled">
    <label>{{ $t("标题") }}<input :value="modelValue.title" required maxlength="200" @input="update('title', $event.target.value)" /></label>
    <MarkdownEditor :model-value="modelValue.description" :label="$t('描述')" :rows="6" :show-help="!creation" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :attachments="attachments" :error="attachmentError" :busy="attachmentBusy" @update:model-value="update('description', $event)" @files="emit('files', $event)" @remove="emit('remove', $event)" />
    <template v-for="[key, label] in details" :key="key"><AcceptanceCriteriaEditor v-if="key === 'acceptanceCriteria'" :model-value="modelValue.acceptanceCriteria" :disabled="!canEdit || disabled" @update:model-value="update(key, $event)" /><MarkdownEditor v-else :model-value="modelValue[key]" :label="$t(label)" :rows="4" :show-help="!creation" :disabled="!canEdit || disabled" :context-key="contextKey" :images="images" :busy="attachmentBusy" @update:model-value="update(key, $event)" @files="emit('files', $event)" /></template>
    <p v-if="creation" class="field-hint issue-attachment-hint">{{ $t('支持粘贴图片、Markdown 与附件。') }} {{ $t('单个附件最多 10 MiB，每次合计 20 MiB。') }}</p>
      <p class="field-hint">{{ $t("PNG、JPEG、WebP 直接作为图片输入；其他附件向 Codex 提供本地路径，是否能解析取决于运行环境中的工具。") }}</p>
    </fieldset>
      <fieldset v-if="canAssign" class="issue-fields-people" :disabled="disabled" :aria-label="$t('责任人与关注人')">
        <h2 v-if="creation">{{ $t('责任人与关注人') }}</h2>
        <slot name="people-feedback" />
        <div class="issue-responsibility-fields">
          <label v-for="[key, label] in [['reporterId', '提报人'], ['businessOwnerId', '业务负责人'], ['qaOwnerId', '测试负责人'], ['acceptanceOwnerId', '业务验收人']]" :key="key"><span>{{ $t(label) }}<span v-if="key !== 'reporterId'" class="required-mark" aria-hidden="true"> *</span></span><AppSelect search-pinyin native-events :required="key !== 'reporterId'" :aria-label="$t(label)" :value="modelValue[key] || ''" @change="update(key, $event.target.value || null)"><option value="" :disabled="key !== 'reporterId' || Boolean(modelValue.id)">{{ $t(key === 'reporterId' && creation ? '创建时默认本人' : '请选择') }}</option><option v-if="modelValue[key] && !members.some(person => person.userId === modelValue[key])" :value="modelValue[key]">{{ modelValue.people?.find(person => person.id === modelValue[key])?.displayName || $t('已指定成员') }}</option><option v-for="p in members" :key="p.userId" :value="p.userId">{{ p.displayName }}（{{ p.username }}）</option></AppSelect></label>
        </div>
        <label>{{ $t("关注人") }}<AppSelect search-pinyin native-events :aria-label="$t('关注人')" multiple @change="update('watcherIds', [...$event.target.selectedOptions].map(option => option.value))"><option v-for="p in members" :key="p.userId" :value="p.userId" :selected="modelValue.watcherIds.includes(p.userId)">{{ p.displayName }}（{{ p.username }}）</option></AppSelect></label>
        <p class="field-hint">{{ $t('业务负责人对结果负责；当前处理人由流程决定；关注人仅用于关注，不生成待办。') }}</p>
        <p class="field-hint">{{ $t("保存事项后，通过「认领」或「指派」确定开发负责人并加入其待开发任务。") }}</p>
      </fieldset>
    </div>
    <fieldset class="issue-fields-properties" :disabled="!canEdit || disabled" :aria-label="$t('事项属性')">
    <label>{{ $t("目标版本") }}<AppSelect native-events :aria-label="$t('目标版本')" :value="modelValue.releaseId || ''" @change="update('releaseId', $event.target.value || null)"><option value="">{{ $t("未排期") }}</option><option v-for="release in releases.filter(r => r.status === 'active' || r.id === modelValue.releaseId)" :key="release.id" :value="release.id">{{ release.name }}</option></AppSelect></label>
    <label>{{ $t("优先级") }}<AppSelect native-events :aria-label="$t('优先级')" :value="modelValue.priority" @change="update('priority', $event.target.value)"><option v-for="(label, value) in priorityLabels" :key="value" :value="value">{{ $t(label) }}</option></AppSelect></label>
    <label v-if="type === 'bug'">{{ $t("严重程度") }}<AppSelect native-events :aria-label="$t('严重程度')" :value="modelValue.severity" @change="update('severity', $event.target.value)"><option value="minor">{{ $t("轻微") }}</option><option value="normal">{{ $t("普通") }}</option><option value="major">{{ $t("严重") }}</option><option value="critical">{{ $t("致命") }}</option></AppSelect></label>
    <div class="issue-fields-dates" :class="{ 'form-columns': !creation }"><h2 v-if="creation">{{ $t('日期与标签') }}</h2><label>{{ $t("截止日期") }}<input type="date" :value="modelValue.dueDate || ''" @input="update('dueDate', $event.target.value || null)" /></label><label>{{ $t("标签") }}<input :value="(modelValue.tags || []).join(', ')" maxlength="400" :placeholder="$t('用逗号分隔，最多 12 个')" @change="update('tags', $event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean))" /></label></div>
    </fieldset>
  </div>
</template>
<style scoped>
.issue-fields, .issue-fields-main, .issue-responsibility-fields { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.required-mark { color: var(--danger); }
</style>
