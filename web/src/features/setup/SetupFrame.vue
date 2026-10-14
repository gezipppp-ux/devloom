<script setup>
import LocaleSelect from "../../shared/components/LocaleSelect.vue";
import { computed } from "vue";
import { CheckOutlined, SaveOutlined } from "@antdv-next/icons";
import steps from "../../../../shared/setup-steps.json";
const props = defineProps({ step: { type: String, required: true }, currentStep: { type: String, default: "admin" }, completed: { type: Object, default: () => ({}) }, busy: Boolean, username: { type: String, default: "" } });
defineEmits(["navigate", "exit"]);
const maximum = computed(() => steps.findIndex(item => item.id === props.currentStep));
</script>
<template>
  <div class="setup-page">
    <header class="setup-brand-bar"><div><span class="setup-mark">W</span><strong>Web Coding</strong><span class="muted">{{ $t("首次初始化") }}</span></div><LocaleSelect /><span>{{ username || $t("等待创建管理员") }}</span></header>
    <main class="page-layout">
      <header class="page-heading setup-heading"><div><div class="eyebrow">WORKSPACE SETUP</div><h1>{{ $t("初始化你的工作台") }}</h1><p>{{ $t("从管理员账号开始，为团队准备好协作环境。") }}</p></div><button v-if="username" type="button" :disabled="busy" @click="$emit('exit')">{{ $t("保存并退出") }}</button></header>
      <div class="setup-layout">
        <aside><ol class="setup-steps" :aria-label="$t(&quot;初始化步骤&quot;)"><li v-for="(item, index) in steps" :key="item.id"><button type="button" :class="{ active: step === item.id, done: completed[item.id] }" :aria-current="step === item.id ? 'step' : undefined" :disabled="busy || index > maximum" @click="$emit('navigate', item.id)"><span class="setup-number"><CheckOutlined aria-hidden="true" v-if="completed[item.id]?.status === 'completed'" /><span v-else>{{ completed[item.id]?.status === 'skipped' ? '–' : index + 1 }}</span></span><span><strong>{{ $t(item.title) }}</strong><small>{{ completed[item.id]?.status === 'skipped' ? $t("已跳过") : completed[item.id] ? $t("已保存") : $t(item.description) }}</small></span></button></li></ol><p class="setup-side-note"><strong>{{ $t("按步骤保存，随时继续") }}</strong>{{ $t("基础配置需要完成。测试账号和第一个项目可跳过，之后再补充。") }}</p></aside>
        <section class="setup-content"><slot /><p class="setup-save-note"><SaveOutlined aria-hidden="true" /> {{ $t("已完成的步骤保留结果，返回不会重复创建。") }}</p></section>
      </div>
    </main>
  </div>
</template>
<style scoped>
.setup-brand-bar { padding: 16px var(--page-gutter); display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.setup-brand-bar > div { display: flex; align-items: center; gap: 12px; }
.setup-brand-bar > span { overflow-wrap: anywhere; min-width: 0; }
.setup-mark { display: grid; place-items: center; width: 32px; height: 32px; background: var(--accent); color: var(--surface); border-radius: 8px; }
.setup-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.setup-heading button { flex-shrink: 0; }
.setup-layout { display: grid; grid-template-columns: 216px minmax(0, 1fr); gap: 32px; align-items: start; }
.setup-content { min-width: 0; }
.setup-steps { list-style: none; margin: 0; padding: 12px; background: var(--sidebar); border: 1px solid var(--line); border-radius: var(--radius-card); }
.setup-steps li + li { margin-top: 6px; }
.setup-steps button { width: 100%; gap: 12px; padding: 12px 10px; justify-content: flex-start; text-align: left; border-color: transparent; background: transparent; }
.setup-steps button.active { background: var(--surface); border-color: var(--line); }
.setup-steps strong { font-size: 13px; display: block; }
.setup-steps small { font-size: 12px; color: var(--muted); display: block; margin-top: 4px; }
.setup-number { display: grid; place-items: center; width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%; color: var(--muted); background: var(--rail); font-size: 12px; }
.active .setup-number { background: var(--accent); color: var(--surface); }
.done:not(.active) .setup-number { background: var(--selected); color: var(--accent); }
.setup-side-note, .setup-save-note { font-size: 12px; color: var(--muted); line-height: 1.8; margin-top: 20px; }
.setup-side-note { margin-left: 12px; margin-right: 12px; }
.setup-side-note strong { display: block; color: var(--ink); margin-bottom: 8px; }
@media (max-width: 900px) { .setup-layout { grid-template-columns: 180px minmax(0, 1fr); gap: 24px; } }
@media (max-width: 768px) {
  .setup-layout { grid-template-columns: 1fr; }
  .setup-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .setup-steps li + li { margin-top: 0; }
  .setup-steps button { padding: 8px; gap: 6px; }
  .setup-steps small, .setup-side-note { display: none; }
}
@media (max-width: 480px) {
  .setup-brand-bar .muted { display: none; }
  .setup-heading button { padding: 4px; font-size: 12px; }
  .setup-steps { padding: 8px; gap: 4px; }
  .setup-steps strong { font-size: 11px; }
  .setup-steps button { padding: 8px 3px; gap: 5px; }
  .setup-number { width: 22px; height: 22px; flex-basis: 22px; }
}
@media (max-width: 360px) { .setup-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
