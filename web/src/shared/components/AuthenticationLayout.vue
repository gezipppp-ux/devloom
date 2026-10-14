<script setup>
import LocaleSelect from "./LocaleSelect.vue";
</script>
<template>
  <main class="authentication-layout">
    <header class="authentication-brand-bar"><div class="authentication-brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor" /><path d="m8 11 5 5-5 5m9 0h7" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg><span>WEB CODING</span></div><LocaleSelect /></header>
    <section class="authentication-card"><slot /></section>
  </main>
</template>
<style scoped>
.authentication-layout { display: flex; flex-direction: column; min-height: 100dvh; padding: 36px 40px; background: var(--canvas); }
.authentication-brand-bar { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 36px; }
.authentication-brand { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; letter-spacing: .06em; color: var(--ink); }
.authentication-brand svg { width: 28px; height: 28px; flex: 0 0 28px; }
.authentication-card { width: min(420px, 100%); padding: 36px; margin: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-sm); }
.authentication-card :deep(h1) { font-size: 26px; margin: 10px 0 8px; }
.authentication-card :deep(> .muted) { font-size: 13px; line-height: 1.8; margin-bottom: 28px; }
.authentication-card :deep(form > button.primary) { width: 100%; }
@media (max-width: 767px) { .authentication-layout { padding: 24px 20px; } .authentication-card { padding: 28px; } }
@media (max-width: 360px) { .authentication-layout { padding: 20px 16px; } .authentication-card { padding: 24px; } }
</style>
