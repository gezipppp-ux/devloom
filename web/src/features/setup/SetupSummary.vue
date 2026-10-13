<script setup>
import FormSection from "../../shared/components/FormSection.vue";
defineProps({ state: { type: Object, required: true } });
</script>
<template>
  <FormSection title="初始化结果">
    <dl class="setup-summary">
      <div><dt>管理员</dt><dd>{{ state.administrator?.displayName || '—' }}<small>{{ state.administrator?.username }}</small></dd></div>
      <div><dt>运行环境</dt><dd>{{ state.steps.environment ? '基础工具检测通过' : '未记录' }}<small v-if="state.steps.environment?.data?.deferCodexLogin">配置时选择稍后完成 Codex 登录；开发前请重新检测。</small></dd></div>
      <div><dt>成员目录</dt><dd><code>{{ state.memberStorageRoot }}</code></dd></div>
      <div><dt>默认部门</dt><dd>{{ state.departments.map(item => item.name).join('、') || '未记录' }}</dd></div>
      <div><dt>测试账号</dt><dd>{{ state.accounts.map(item => item.displayName).join('、') || '已跳过' }}</dd></div>
      <div><dt>第一个项目</dt><dd>{{ state.project?.name || '已跳过' }}<small v-if="state.project">已选择 {{ state.steps.project.data.memberIds.length }} 个测试成员加入项目</small><small v-else>之后创建项目并添加成员，账号才获得该项目的访问权。</small></dd></div>
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
