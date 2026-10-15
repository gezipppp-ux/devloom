<script setup>
import { ArrowLeftOutlined, ArrowRightOutlined } from "@antdv-next/icons";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthenticationLayout from "../shared/components/AuthenticationLayout.vue";

const route = useRoute();
const router = useRouter();
function back() {
  const previous = router.options.history.state?.back;
  if (typeof previous === "string" && previous.startsWith("/") && !previous.startsWith("//") && !router.resolve(previous).meta.notFound)
    router.back();
  else void router.replace({ name: "workspace" });
}
</script>

<template>
  <AuthenticationLayout class="not-found-layout">
    <section class="not-found-content" aria-labelledby="not-found-title">
      <div class="not-found-art" aria-hidden="true">
        <svg viewBox="0 0 480 240" fill="none">
          <path d="M20 158h52c28 0 28-93 60-93h214c30 0 30 113 62 113h50" class="not-found-trail" stroke-dasharray="4 7" />
          <circle cx="20" cy="158" r="4" class="not-found-dot" /><circle cx="458" cy="178" r="5" class="not-found-end" />
          <text x="72" y="182" class="not-found-digit">4</text>
          <text x="304" y="182" class="not-found-digit">4</text>
          <rect x="193" y="55" width="94" height="134" rx="45" class="not-found-zero" />
          <g transform="rotate(9 240 120)">
            <path d="M218 88h28l16 16v49a5 5 0 0 1-5 5h-39a5 5 0 0 1-5-5V93a5 5 0 0 1 5-5Z" class="not-found-paper" />
            <path d="M246 88v16h16M226 124h23M226 136h14" class="not-found-paper-lines" />
          </g>
          <path d="M315 44v12m-6-6h12M168 195v8m-4-4h8" class="not-found-spark" />
        </svg>
      </div>
      <p class="not-found-label">404 <span aria-hidden="true">/</span> {{ $t("页面未找到") }}</p>
      <h1 id="not-found-title">{{ $t("这个页面走丢了") }}</h1>
      <p class="not-found-description">{{ $t("页面可能已移动、被删除，或地址输入有误。回到工作台，继续手头的工作吧。") }}</p>
      <div class="not-found-actions">
        <RouterLink class="not-found-home" :to="{ name: 'workspace' }">{{ $t("回到工作台") }}<ArrowRightOutlined aria-hidden="true" /></RouterLink>
        <button type="button" @click="back"><ArrowLeftOutlined aria-hidden="true" />{{ $t("返回上一页") }}</button>
      </div>
      <div v-if="route.path.toLowerCase().replace(/\/$/, '') !== '/404'" class="not-found-address">
        <span>{{ $t("访问地址") }}</span><code>{{ route.path }}</code>
      </div>
    </section>
  </AuthenticationLayout>
</template>

<style scoped>
.not-found-layout { background: var(--surface); }
.not-found-layout :deep(.authentication-card) { width: min(680px, 100%); padding: 16px 32px 64px; border: 0; background: transparent; box-shadow: none; }
.not-found-content { text-align: center; }
.not-found-art { width: min(480px, 100%); margin: 0 auto 22px; }
.not-found-art svg { display: block; width: 100%; }
.not-found-trail { stroke: var(--field-border); stroke-width: 1.5; }
.not-found-dot { fill: var(--field-border); }
.not-found-end { fill: var(--highlight); stroke: var(--selected); stroke-width: 7; }
.not-found-digit { fill: var(--ink); font: 600 172px var(--font-ui); letter-spacing: -8px; }
.not-found-zero { fill: var(--selected); }
.not-found-paper { fill: var(--surface); stroke: var(--highlight); stroke-width: 1.5; }
.not-found-paper-lines, .not-found-spark { stroke: var(--highlight); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.not-found-label { display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--muted); font-size: 12px; letter-spacing: 1.5px; }
.not-found-label span { color: var(--field-border); }
.not-found-content h1 { margin: 16px 0; font-size: clamp(28px, 3vw, 32px); font-weight: 650; letter-spacing: -.6px; }
.not-found-description { max-width: 400px; margin: 0 auto; font-size: 15px; line-height: 1.9; color: var(--muted); }
.not-found-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin: 32px 0 0; }
.not-found-actions > * { min-height: 44px; padding: 10px 20px; }
.not-found-home { display: inline-flex; align-items: center; justify-content: center; gap: 12px; border: 1px solid var(--accent); border-radius: var(--radius-control); background: var(--accent); color: var(--on-accent); text-decoration: none; }
.not-found-home:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-accent); }
.not-found-home:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; }
.not-found-address { display: flex; justify-content: center; align-items: baseline; gap: 10px; margin: 40px auto 0; padding-top: 20px; border-top: 1px solid var(--line); max-width: 440px; color: var(--muted); font-size: 12px; line-height: 1.8; }
.not-found-address span { flex-shrink: 0; }
.not-found-address code { overflow-wrap: anywhere; min-width: 0; text-align: left; font-family: var(--font-code); }
@media (max-width: 767px) {
  .not-found-layout :deep(.authentication-card) { padding: 0 0 32px; }
  .not-found-art { margin-bottom: 12px; }
  .not-found-actions { gap: 10px; }
  .not-found-actions > * { padding: 10px 16px; }
  .not-found-address { margin-top: 32px; }
}
@media (max-width: 360px) {
  .not-found-actions { flex-direction: column; }
  .not-found-address { flex-direction: column; align-items: center; gap: 4px; }
}
</style>
