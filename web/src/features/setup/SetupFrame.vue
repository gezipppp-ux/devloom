<script setup>
import LocaleSelect from "../../shared/components/LocaleSelect.vue";
import { usePageTitle } from "../../shared/components/page-title.js";
import { translate } from "../../shared/i18n/index.js";
import { computed } from "vue";
import { CheckOutlined, SaveOutlined } from "@antdv-next/icons";
import steps from "../../../../shared/setup-steps.json";
const props = defineProps({ step: { type: String, required: true }, currentStep: { type: String, default: "admin" }, completed: { type: Object, default: () => ({}) }, busy: Boolean, username: { type: String, default: "" } });
defineEmits(["navigate", "exit"]);
const maximum = computed(() => steps.findIndex(item => item.id === props.currentStep));
usePageTitle(() => [translate(steps.find(item => item.id === props.step)?.title), translate("初始化")]);
</script>
<template>
  <div class="setup-page">
    <header class="setup-brand-bar"><div><span class="setup-mark">D</span><strong>DevLoom</strong><span class="muted">{{ $t("首次初始化") }}</span></div><LocaleSelect /><span>{{ username || $t("等待创建管理员") }}</span></header>
    <main class="page-layout">
      <header class="page-heading setup-heading"><div><div class="eyebrow">WORKSPACE SETUP</div><h1>{{ $t("初始化你的工作台") }}</h1><p>{{ $t("从管理员账号开始，为团队准备好协作环境。") }}</p></div><button v-if="username" type="button" :disabled="busy" @click="$emit('exit')">{{ $t("保存并退出") }}</button></header>
      <div class="setup-layout">
        <aside><ol class="setup-steps" :aria-label="$t('初始化步骤')"><li v-for="(item, index) in steps" :key="item.id"><button type="button" :class="{ active: step === item.id, done: completed[item.id] }" :aria-current="step === item.id ? 'step' : undefined" :disabled="busy || index > maximum" @click="$emit('navigate', item.id)"><span class="setup-number"><CheckOutlined aria-hidden="true" v-if="completed[item.id]?.status === 'completed'" /><span v-else>{{ completed[item.id]?.status === 'skipped' ? '–' : index + 1 }}</span></span><span><strong>{{ $t(item.title) }}</strong><small>{{ completed[item.id]?.status === 'skipped' ? $t("已跳过") : completed[item.id] ? $t("已保存") : $t(item.description) }}</small></span></button></li></ol><p class="setup-side-note"><strong>{{ $t("按步骤保存，随时继续") }}</strong>{{ $t("基础配置需要完成。测试账号和第一个项目可跳过，之后再补充。") }}</p></aside>
        <section class="setup-content"><slot /><p class="setup-save-note"><SaveOutlined aria-hidden="true" /> {{ $t("已完成的步骤保留结果，返回不会重复创建。") }}</p></section>
      </div>
    </main>
  </div>
</template>
<style scoped>
.setup-page { min-height: 100dvh; background: var(--canvas); }
.setup-brand-bar { padding: 28px 40px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--surface); }
.setup-brand-bar > div { display: flex; align-items: center; gap: 12px; }
.setup-brand-bar > span { overflow-wrap: anywhere; min-width: 0; }
.setup-mark { display: grid; place-items: center; width: 32px; height: 32px; background: var(--accent); color: var(--surface); border-radius: 8px; }
.setup-page > .page-layout { width: 100%; max-width: 1000px; padding: 44px 28px 80px; margin: 0 auto; }
.setup-heading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; margin-bottom: 32px; }
.setup-heading h1 { font-size: 27px; }
.setup-heading button { flex-shrink: 0; }
.setup-layout { display: flex; flex-direction: column; gap: 28px; align-items: stretch; }
.setup-content { min-width: 0; width: 100%; max-width: 680px; margin: 0 auto; padding: 28px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); }
.setup-content :deep(.form-section) { padding: 0; margin: 0 0 24px; border: 0; box-shadow: none; background: transparent; }
.setup-content :deep(.form-section:last-child) { margin-bottom: 0; }
.setup-steps { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; list-style: none; margin: 0; padding: 0; }
.setup-steps button { width: 100%; min-width: 0; gap: 8px; padding: 10px 4px; justify-content: flex-start; text-align: left; border-color: transparent; background: transparent; }
.setup-steps button.active { background: var(--selected); color: var(--highlight); }
.setup-steps strong { font-size: 13px; display: block; }
.setup-steps small { font-size: 12px; color: var(--muted); display: block; margin-top: 4px; }
.setup-number { display: grid; place-items: center; width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%; color: var(--muted); background: var(--rail); font-size: 12px; }
.active .setup-number { background: var(--highlight); color: var(--surface); }
.done:not(.active) .setup-number { background: var(--selected); color: var(--highlight); }
.setup-side-note, .setup-save-note { font-size: 12px; color: var(--muted); line-height: 1.8; margin-top: 20px; }
.setup-side-note { text-align: center; margin: 16px auto 0; max-width: 680px; }
.setup-side-note strong { color: var(--ink); margin-right: 8px; }
@media (max-width: 1000px) { .setup-steps { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 768px) {
  .setup-brand-bar { padding: 20px; flex-wrap: wrap; }
  .setup-page > .page-layout { padding: 30px 20px 50px; }
  .setup-content { padding: 24px; }
  .setup-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .setup-steps button { min-height: 44px; padding: 8px 4px; }
  .setup-steps small { display: none; }
}
@media (max-width: 480px) {
  .setup-brand-bar .muted { display: none; }
  .setup-page > .page-layout { padding: 24px 16px 40px; }
  .setup-content { padding: 20px; }
  .setup-steps { gap: 4px; }
  .setup-steps strong { font-size: 12px; }
  .setup-number { width: 24px; height: 24px; flex-basis: 24px; }
}
@media (max-width: 360px) { .setup-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
