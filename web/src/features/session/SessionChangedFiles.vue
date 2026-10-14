<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { ref, watch } from "vue";
import { useSessionFileList } from "./use-session-files.js";
import "./session-files.css";
const props = defineProps({ taskKey: { type: String, required: true }, status: { type: String, default: "" } });
const emit = defineEmits(["open-file"]);
const scope = ref("task");
const { files, loading, error, refresh } = useSessionFileList(() => props.taskKey, scope);
watch(() => props.status, refresh);
const labels = { A: "新增", M: "修改", D: "删除", R: "重命名", C: "复制", T: "类型变更", U: "冲突" };
</script>
<template>
  <section class="session-changed-files" :aria-label="$t('变更文件')" :aria-busy="loading">
    <h3>{{ $t("变更文件") }}</h3>
    <select v-model="scope" :aria-label="$t('变更文件范围')"><option value="task">{{ $t("任务累计变更") }}</option><option value="head">{{ $t("未提交变更") }}</option></select>
    <p v-if="loading" class="muted" role="status">{{ $t("正在读取变更文件…") }}</p>
    <FeedbackMessage v-else-if="error" :message="error" type="error" />
    <p v-else-if="!files.length" class="muted">{{ $t("此范围内没有变更文件。") }}</p>
    <button v-for="file in files" :key="file.path" type="button" class="file-list-entry" @click="emit('open-file', { path: file.path, scope })"><span>{{ $t(labels[file.status] || file.status) }}</span><span>{{ file.path }}</span></button>
    <button type="button" :disabled="loading" @click="refresh">{{ $t("刷新变更文件") }}</button>
  </section>
</template>
