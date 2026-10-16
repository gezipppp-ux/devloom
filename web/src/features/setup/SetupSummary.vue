<script setup>
import FormSection from "../../shared/components/FormSection.vue";
defineProps({ state: { type: Object, required: true } });
</script>
<template>
  <FormSection :title="$t('初始化结果')">
    <dl class="setup-summary">
      <div><dt>{{ $t("管理员") }}</dt><dd>{{ state.administrator?.displayName || '—' }}<small>{{ state.administrator?.username }}</small></dd></div>
      <div><dt>{{ $t("运行环境") }}</dt><dd>{{ state.steps.environment ? $t("基础工具检测通过") : $t("未记录") }}</dd></div>
      <div><dt>{{ $t("成员目录") }}</dt><dd><code>{{ state.memberStorageRoot }}</code></dd></div>
      <div><dt>{{ $t("默认部门") }}</dt><dd>{{ state.departments.map(item => item.name).join('、') || $t("未记录") }}</dd></div>
      <div><dt>{{ $t("测试账号") }}</dt><dd>{{ state.accounts.map(item => item.displayName).join('、') || $t("已跳过") }}</dd></div>
      <div><dt>{{ $t("第一个项目") }}</dt><dd>{{ state.project?.name || $t("已跳过") }}<small v-if="state.project">{{ $t("已选择") }} {{ state.steps.project.data.memberIds.length }} {{ $t("个测试成员加入项目") }}</small><small v-else>{{ $t("之后创建项目并添加成员，账号才获得该项目的访问权。") }}</small></dd></div>
    </dl>
  </FormSection>
</template>
<style scoped>
.setup-summary { margin: 0; }
.setup-summary > div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.setup-summary > div:last-child { border: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
small { display: block; color: var(--muted); margin-top: 8px; }
code { overflow-wrap: anywhere; }
@media (max-width: 480px) { .setup-summary > div { grid-template-columns: 1fr; gap: 8px; } }
</style>
