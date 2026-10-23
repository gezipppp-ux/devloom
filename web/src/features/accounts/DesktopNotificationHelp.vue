<script setup>
/* global document */
import { computed, onUnmounted, ref } from "vue";
import { CopyOutlined } from "@antdv-next/icons";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import { copyText } from "../../shared/components/clipboard.js";
const props = defineProps({ origin: { type: String, required: true }, status: { type: String, required: true } });
const emit = defineEmits(["close", "recheck"]);
const method = ref("https"), browser = ref("chrome"), checked = ref(false), copyMessage = ref(""), copyError = ref(false);
const flagsUrl = computed(() => `${browser.value}://flags/#unsafely-treat-insecure-origin-as-secure`);
const checkMessage = computed(() => ({ insecure: "当前连接仍不满足要求，请完成所选方式的设置后重试。", denied: "当前连接符合要求。请在地址栏左侧的网站设置中允许通知，然后刷新页面。", unsupported: "当前浏览器不支持系统桌面通知。", default: "当前连接已符合要求。关闭此窗口，开启通知并选择“允许”。", granted: "通知权限已允许。关闭此窗口后可调整通知开关。" })[props.status]);
let alive = true, copyGeneration = 0;
async function copy(value) {
  const generation = ++copyGeneration;
  copyMessage.value = "";
  try { await copyText(value); if (alive && generation === copyGeneration) { copyMessage.value = "已复制。"; copyError.value = false; } }
  catch { if (alive && generation === copyGeneration) { copyMessage.value = "无法自动复制，请选中文本后手动复制。"; copyError.value = true; } }
}
function selectMethod(value) { method.value = value; copyGeneration++; copyMessage.value = ""; }
function recheck() { emit("recheck"); checked.value = true; }
function keepFocus(event) {
  if (event.key !== "Tab") return;
  const elements = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), summary")).filter(element => element.getClientRects().length);
  const first = elements[0], last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onUnmounted(() => { alive = false; copyGeneration++; });
</script>
<template>
  <ModalDialog class="notification-help" open :title="$t('开启桌面通知')" @close="emit('close')" @keydown="keepFocus">
    <p class="notification-help-intro">{{ $t("选择一种方式即可，无需同时设置。") }}</p>
    <div class="notification-methods" role="group" :aria-label="$t('选择开启通知的方式')">
      <button type="button" class="notification-method" :aria-pressed="method === 'https'" aria-controls="notification-method-instructions" @click="selectMethod('https')"><span class="method-label">{{ $t("方式一") }}<span class="recommended">{{ $t("推荐") }}</span></span><strong>{{ $t("使用 HTTPS 访问") }}</strong><span class="method-caption">{{ $t("适合团队长期使用") }}</span></button>
      <button type="button" class="notification-method" :aria-pressed="method === 'temporary'" aria-controls="notification-method-instructions" @click="selectMethod('temporary')"><span class="method-label">{{ $t("方式二") }}</span><strong>{{ $t("临时允许当前内网站点") }}</strong><span class="method-caption">{{ $t("仅调整当前浏览器") }}</span></button>
    </div>
    <div id="notification-method-instructions">
      <ol v-if="method === 'https'" class="notification-steps">
        <li><strong>{{ $t("向管理员获取 HTTPS 地址") }}</strong><p>{{ $t("站点需配置浏览器信任的有效证书。") }}</p></li>
        <li><strong>{{ $t("通过新地址打开本站") }}</strong><p>{{ $t("使用管理员提供的完整地址，不要直接把当前地址的 http 改为 https。") }}</p></li>
        <li><strong>{{ $t("开启通知并选择“允许”") }}</strong><p>{{ $t("进入个人设置，开启通知开关。团队成员无需修改浏览器实验设置。") }}</p></li>
      </ol>
      <template v-else>
        <p class="notification-help-note">{{ $t("适用于电脑上的 Chrome / Edge；仅为你信任的内网站点设置。") }}</p>
        <div class="notification-browsers" role="group" :aria-label="$t('选择浏览器')"><button type="button" :aria-pressed="browser === 'chrome'" @click="browser = 'chrome'">Chrome</button><button type="button" :aria-pressed="browser === 'edge'" @click="browser = 'edge'">Edge</button></div>
        <ol class="notification-steps">
          <li><strong>{{ $t("打开浏览器实验设置") }}</strong><p>{{ $t("复制下方地址，粘贴到浏览器地址栏打开。") }}</p><div class="notification-copy"><code>{{ flagsUrl }}</code><button type="button" :aria-label="$t('复制浏览器设置地址')" @click="copy(flagsUrl)"><CopyOutlined aria-hidden="true" />{{ $t("复制") }}</button></div></li>
          <li><strong>{{ $t("添加当前站点并启用") }}</strong><p>{{ $t("在 Insecure origins treated as secure 下填入：") }}</p><div class="notification-copy"><code>{{ origin }}</code><button type="button" :aria-label="$t('复制当前站点地址')" @click="copy(origin)"><CopyOutlined aria-hidden="true" />{{ $t("复制") }}</button></div><p>{{ $t("右侧选为 Enabled（已启用）。") }}</p></li>
          <li><strong>{{ $t("重启浏览器并允许通知") }}</strong><p>{{ $t("点击 Relaunch，重新打开本站，再开启通知开关并选择“允许”。") }}</p></li>
        </ol>
        <p class="notification-help-note">{{ $t("此设置仅对当前浏览器生效，不会加密 HTTP 连接。改用 HTTPS 后可移除例外。") }}</p>
        <details class="notification-help-note"><summary>{{ $t("重启后仍被拦截？") }}</summary><p>{{ $t("在地址栏左侧打开网站设置，将“通知”改为“允许”，然后刷新本站。如果浏览器不提供以上选项，请使用 HTTPS 地址。") }}</p></details>
      </template>
    </div>
    <p v-if="copyMessage" class="notification-copy-feedback" :class="{ error: copyError }" role="status">{{ $t(copyMessage) }}</p>
    <template #footer><div class="notification-help-footer"><button type="button" @click="recheck">{{ $t("重新检测") }}</button><p role="status">{{ $t(checked ? checkMessage : '完成设置后，回到此处检查。') }}</p></div></template>
  </ModalDialog>
</template>
<style scoped>
.notification-help { width: min(640px, calc(100vw - 32px)); }
.notification-help-intro { margin: 0 0 16px; font-size: 14px; }
.notification-methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.notification-method { display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; min-width: 0; padding: 16px; gap: 8px; text-align: left; white-space: normal; border: 1px solid var(--field-border); border-radius: 8px; background: var(--surface); color: var(--ink); }
.notification-method[aria-pressed="true"] { border-color: var(--highlight); box-shadow: inset 0 0 0 1px var(--highlight); background: var(--selected); }
.notification-method strong { font-size: 14px; line-height: 1.6; }.method-label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--muted); }.method-caption { font-size: 12px; color: var(--muted); line-height: 1.6; }
.notification-method[aria-pressed="true"] .method-label { color: var(--highlight); }.recommended { padding: 1px 6px; border-radius: 4px; background: var(--accent-subtle); color: var(--highlight); font-size: 12px; }
.notification-steps { list-style: none; counter-reset: notification-step; padding: 0; margin: 0; }
.notification-steps li { counter-increment: notification-step; position: relative; padding-left: 32px; margin-top: 18px; font-size: 13px; line-height: 1.7; }
.notification-steps li::before { content: counter(notification-step); position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--soft); color: var(--muted); font-size: 12px; }
.notification-steps p { margin: 6px 0 0; color: var(--muted); }
.notification-help-note { margin: 16px 0; color: var(--muted); font-size: 12px; line-height: 1.8; }.notification-help-note summary { cursor: pointer; }
.notification-browsers { display: flex; gap: 8px; }.notification-browsers button { min-height: 36px; padding: 5px 16px; font-size: 13px; }.notification-browsers button[aria-pressed="true"] { border-color: var(--ink); }
.notification-copy { display: flex; gap: 8px; align-items: center; padding: 8px 12px; margin-top: 8px; border-radius: 6px; background: var(--soft); }.notification-copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--ink); font-family: var(--font-code); font-size: 12px; }.notification-copy button { flex-shrink: 0; border: 0; padding: 5px 8px; background: transparent; font-size: 12px; }
.notification-copy-feedback { font-size: 12px; margin: 16px 0 0; color: var(--success); }.notification-copy-feedback.error { color: var(--danger); }
.notification-help-footer { display: flex; align-items: center; gap: 16px; }.notification-help-footer button { flex-shrink: 0; }.notification-help-footer p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
@media (max-width: 480px) { .notification-methods { grid-template-columns: 1fr; gap: 10px; }.notification-method { padding: 13px 16px; gap: 4px; }.notification-browsers button, .notification-copy button, .notification-help-note summary { min-height: 44px; }.notification-copy { padding: 8px; }.notification-copy code { font-size: 11px; }.notification-help-footer { align-items: stretch; flex-direction: column; gap: 10px; } }
</style>
