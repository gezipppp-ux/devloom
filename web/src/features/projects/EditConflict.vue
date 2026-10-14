<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed, reactive } from "vue";
import { fieldLabels, mergeFields, readableValue } from "./project-records.js";
const props = defineProps({ base: Object, draft: Object, latest: Object, people: { type: Array, default: () => [] } });
const emit = defineEmits(["resolve", "discard"]);
const choices = reactive({});
const merge = computed(() => mergeFields(props.base, props.draft, props.latest, choices));
</script>
<template><section class="project-section" :aria-label="$t('处理编辑冲突')"><h3>{{ $t("最新内容已加载，草稿仍保留") }}</h3><p>{{ $t("未冲突的修改会合并；以下字段请逐项选择。确认后仍需点击保存。") }}</p><div v-for="key in merge.conflicts" :key="key"><h4>{{ $t(fieldLabels[key]) }}</h4><p class="project-text">{{ $t("我的草稿：") }}{{ readableValue(key, draft[key], people) }}</p><p class="project-text">{{ $t("最新内容：") }}{{ readableValue(key, latest[key], people) }}</p><label>{{ $t("保留哪个版本") }}<AppSelect native-events v-model="choices[key]" :aria-label="$t('{p0}冲突处理', { p0: $t(fieldLabels[key]) })"><option :value="undefined" disabled>{{ $t("请选择") }}</option><option value="draft">{{ $t("我的草稿") }}</option><option value="latest">{{ $t("最新内容") }}</option></AppSelect></label></div><p v-if="!merge.conflicts.length">{{ $t("没有重叠修改，可以安全合并。") }}</p><div class="actions"><button type="button" :disabled="merge.conflicts.some(key => !choices[key])" @click="emit('resolve', merge.values)">{{ $t("确认合并并继续编辑") }}</button><button type="button" @click="emit('discard')">{{ $t("放弃草稿，使用最新内容") }}</button></div></section></template>
