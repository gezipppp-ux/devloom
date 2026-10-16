<script setup>
/* global document */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId, watch } from "vue";
import { UserOutlined, LogoutOutlined, DownOutlined, RightOutlined, CloseOutlined, GlobalOutlined, DesktopOutlined } from "@antdv-next/icons";
import LocaleSelect from "../../shared/components/LocaleSelect.vue";
import ThemeSelect from "../../shared/components/ThemeSelect.vue";

const props = defineProps({ user: { type: Object, default: null }, busy: Boolean, contextKey: { type: String, default: "" } });
const emit = defineEmits(["personal", "logout"]);
const trigger = ref(), panel = ref(), open = ref(false), mobile = ref(false);
const id = useId();
const initial = computed(() => Array.from(props.user?.displayName || props.user?.username || "")[0] || "?");
let media, observer, previousOverflow, previousGutter;
function close(returnFocus = true) {
  open.value = false;
  panel.value?.close();
  if (previousOverflow !== undefined) { document.documentElement.style.overflow = previousOverflow; document.documentElement.style.scrollbarGutter = previousGutter; previousOverflow = undefined; }
  if (returnFocus && trigger.value?.isConnected) trigger.value.focus();
}
function place() {
  if (!open.value || mobile.value || !panel.value || !trigger.value) return;
  const view = document.defaultView, anchor = trigger.value.getBoundingClientRect(), box = panel.value.getBoundingClientRect();
  panel.value.style.left = `${Math.max(12, Math.min(anchor.right - box.width, view.innerWidth - box.width - 12))}px`;
  panel.value.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, view.innerHeight - box.height - 12))}px`;
}
async function show() {
  if (props.busy) return;
  open.value = true;
  await nextTick();
  if (!open.value || !panel.value) return;
  if (!panel.value.open) {
    if (mobile.value) { previousOverflow = document.documentElement.style.overflow; previousGutter = document.documentElement.style.scrollbarGutter; document.documentElement.style.overflow = "hidden"; document.documentElement.style.scrollbarGutter = "auto"; panel.value.showModal(); }
    else panel.value.show();
  }
  place();
  panel.value.querySelector(".account-personal")?.focus({ preventScroll: true });
}
function choose(action) { close(); emit(action); }
function pointer(event) {
  if (!open.value || panel.value?.contains(event.target) || trigger.value?.contains(event.target)) return;
  close(false);
}
function backdrop(event) {
  if (event.target !== panel.value) return;
  const box = panel.value.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
}
function focusOut(event) {
  if (!open.value || mobile.value || panel.value?.contains(event.relatedTarget) || trigger.value?.contains(event.relatedTarget)) return;
  close(false);
}
function keydown(event) {
  // AppSelect consumes Escape while its own dropdown is open.
  if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(); }
  if (event.key === "Tab" && mobile.value) {
    const controls = [...panel.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
function viewportChanged() { if (open.value && mobile.value !== media.matches) close(); mobile.value = media.matches; place(); }
watch([() => props.user?.id, () => props.contextKey], () => close(false));
onMounted(() => {
  media = document.defaultView.matchMedia("(max-width: 767px)");
  mobile.value = media.matches;
  media.addEventListener("change", viewportChanged);
  document.addEventListener("pointerdown", pointer);
  document.defaultView.addEventListener("resize", viewportChanged);
  document.defaultView.addEventListener("scroll", place, true);
  observer = new document.defaultView.ResizeObserver(place);
  observer.observe(panel.value);
});
onBeforeUnmount(() => {
  close(false); observer?.disconnect();
  media?.removeEventListener("change", viewportChanged);
  document.removeEventListener("pointerdown", pointer);
  document.defaultView.removeEventListener("resize", viewportChanged);
  document.defaultView.removeEventListener("scroll", place, true);
});
</script>

<template>
  <button ref="trigger" type="button" class="ui-avatar" :title="user?.displayName" :aria-label="$t('账号与个人设置')" aria-haspopup="dialog" :aria-controls="id" :aria-expanded="open" :disabled="busy" @click="open ? close() : show()" @keydown.down.prevent="show()">
    <span class="account-avatar" aria-hidden="true">{{ initial }}</span><DownOutlined aria-hidden="true" />
  </button>
  <Teleport to="body">
    <dialog :id="id" ref="panel" class="ui-account-menu" :class="{ 'account-sheet': mobile }" :aria-label="$t('我的账号')" @cancel.prevent="close()" @click="backdrop" @keydown="keydown" @focusout="focusOut">
      <header class="account-sheet-heading"><h2>{{ $t('我的账号') }}</h2><button type="button" :aria-label="$t('关闭弹窗')" @click="close()"><CloseOutlined aria-hidden="true" /></button></header>
      <div class="account-menu-body">
        <div class="account-menu-identity"><span class="account-avatar" aria-hidden="true">{{ initial }}</span><div><strong>{{ user?.displayName }}</strong><span>@{{ user?.username }}</span><small>{{ $t(user?.role === 'admin' ? '管理员' : '普通成员') }}</small></div></div>
        <button type="button" class="account-menu-action account-personal" @click="choose('personal')"><UserOutlined aria-hidden="true" /><span>{{ $t('个人中心') }}</span><RightOutlined class="account-action-arrow" aria-hidden="true" /></button>
        <section class="account-preferences" :aria-label="$t('偏好设置')">
          <h3>{{ $t('偏好设置') }}</h3>
          <div class="account-preference"><span><GlobalOutlined aria-hidden="true" />{{ $t('语言') }}</span><LocaleSelect /></div>
          <div class="account-preference"><span><DesktopOutlined aria-hidden="true" />{{ $t('外观主题') }}</span><ThemeSelect :icon-only="false" /></div>
        </section>
      </div>
      <footer><button type="button" class="account-menu-action account-signout" :disabled="busy" @click="choose('logout')"><LogoutOutlined aria-hidden="true" /><span>{{ $t('退出登录') }}</span></button></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ui-avatar { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 5px 7px; flex-shrink: 0; border: 1px solid transparent; border-radius: 24px; background: transparent; }
.ui-avatar:hover, .ui-avatar[aria-expanded="true"] { background: var(--soft); border-color: var(--line); }
.ui-avatar > .anticon { color: var(--muted); font-size: 10px; }
.account-avatar { display: inline-grid; place-items: center; width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%; background: var(--selected); color: var(--highlight); font-size: 13px; }
.ui-account-menu { position: fixed; inset: auto; margin: 0; width: 312px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-dialog); z-index: 80; overflow: visible; }
.account-menu-body { max-height: calc(100dvh - 104px); overflow-y: auto; }
.account-sheet-heading { display: none; }
.account-menu-identity { display: flex; align-items: center; gap: 12px; padding: 14px 12px 20px; }
.account-menu-identity > div { display: grid; gap: 4px; min-width: 0; }
.account-menu-identity .account-avatar { width: 40px; height: 40px; flex-basis: 40px; font-size: 16px; }
.account-menu-identity strong { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.account-menu-identity span:not(.account-avatar), .account-menu-identity small { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.account-menu-action { display: flex; align-items: center; width: 100%; min-height: 44px; gap: 12px; padding: 11px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); text-align: left; justify-content: flex-start; box-shadow: none; }
.account-menu-action:hover { background: var(--soft); }
.account-menu-action:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; border-radius: 6px; }
.account-menu-action > .anticon { color: var(--muted); font-size: 16px; }
.account-action-arrow { margin-left: auto; font-size: 12px !important; }
.account-personal { border-top: 1px solid var(--line); border-radius: 0; }
.account-preferences { border-top: 1px solid var(--line); padding: 16px 12px; margin-top: 4px; }
.account-preferences h3 { color: var(--muted); font-size: 12px; font-weight: 400; margin: 0 0 10px; }
.account-preference { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
.account-preference > span { display: flex; align-items: center; gap: 10px; font-size: 13px; white-space: nowrap; }
.account-preference > span > .anticon { color: var(--muted); font-size: 16px; }
.account-preference :deep(.app-select) { max-width: 165px; }
.ui-account-menu footer { padding-top: 4px; border-top: 1px solid var(--line); }
.account-signout, .account-signout > .anticon { color: var(--danger); }
.account-signout:hover { background: var(--danger-soft); }
.ui-account-menu::backdrop { background: var(--backdrop); }
@media (max-width: 767px) {
  .ui-avatar { padding: 5px; min-width: 44px; }
  .ui-avatar > .anticon { display: none; }
  .ui-account-menu.account-sheet { inset: auto 0 0 !important; width: 100%; max-width: 100%; max-height: calc(100dvh - 24px); padding: 0; border-radius: 18px 18px 0 0; }
  .account-sheet[open] { display: flex; flex-direction: column; }
  .account-sheet-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px 4px; flex-shrink: 0; }
  .account-sheet-heading h2 { font-size: 16px; margin: 0; }
  .account-sheet-heading button { width: 44px; height: 44px; padding: 0; border: 0; background: transparent; }
  .account-menu-body { padding: 0 12px; overflow-y: auto; min-height: 0; max-height: none; }
  .account-menu-identity { padding-block: 16px 20px; }
  .account-preferences { padding-block: 16px 20px; }
  .account-preference { margin-top: 12px; }
  .ui-account-menu footer { padding: 8px 12px max(16px, env(safe-area-inset-bottom)); flex-shrink: 0; }
}
</style>
