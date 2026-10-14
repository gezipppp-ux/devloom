<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { formatDate, translate, formatNumber } from "../../shared/i18n/index.js";
/* global window, navigator */
import { computed, nextTick, onUnmounted, reactive, ref } from "vue";
import { ArrowLeftOutlined, ArrowRightOutlined, CopyOutlined, DownOutlined, KeyOutlined, PictureOutlined, PlusOutlined, ReloadOutlined } from "@antdv-next/icons";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import McpConnectionHelp from "./McpConnectionHelp.vue";
import McpUploadHelp from "./McpUploadHelp.vue";

const expanded = ref(true), view = ref("overview"), showAll = ref(false), secret = ref("");
const revokeTarget = ref(null), confirmation = ref(null), nameInput = ref(null), secretInput = ref(null), createButton = ref(null), manageButton = ref(null), backButton = ref(null);
const form = reactive({ name: "", expiresInDays: 30, allProjects: true, projectIds: [], scopes: ["read", "issues.write", "issues.assign", "releases.write", "files.upload"] });
const { data, loading, saving, error, notice, reload, perform } = useResource(() => appApi("/account/mcp-tokens"));
const origin = window.location.origin;
const endpoint = new URL("/mcp", origin).href;
const canCreate = computed(() => form.name.trim() && (form.allProjects || form.projectIds.length) && data.value && !loading.value && !saving.value);
const visibleTokens = computed(() => showAll.value ? data.value?.tokens || [] : (data.value?.tokens || []).slice(0, 2));
const title = computed(() => ({ overview: "MCP 接入", guide: "连接配置与图片上传", create: "创建 MCP Token", created: "Token 已创建", upload: "图片上传与发布" })[view.value]);
const description = computed(() => ({ overview: "让本机工具在明确的范围内访问项目。", guide: "让 Agent 访问项目，发布图文需求与 Bug。", create: "按 Agent 或设备区分凭证，方便管理与撤销。", created: "保存凭证后，将它配置到你的客户端。", upload: "使用受鉴权 HTTP 上传，在正文中引用附件 ID。" })[view.value]);
let returnFocus, alive = true, copyGeneration = 0;
function open() { expanded.value = true; view.value = "overview"; void reload(); }
async function close() {
  if (saving.value) return;
  expanded.value = false; secret.value = ""; view.value = "overview"; copyGeneration++;
  await nextTick(); manageButton.value?.focus();
}
async function navigate(target, event) {
  if (saving.value) return;
  returnFocus = event?.currentTarget || returnFocus;
  secret.value = ""; view.value = target; copyGeneration++;
  await nextTick();
  if (target === "create") nameInput.value?.focus();
  else if (target === "overview") (returnFocus?.isConnected ? returnFocus : createButton.value)?.focus();
  else backButton.value?.focus();
}
function create() {
  if (!canCreate.value) return;
  secret.value = "";
  return perform(() => appApi("/account/mcp-tokens", { ...form, projectIds: form.allProjects ? [] : [...form.projectIds], scopes: [...form.scopes] }),
    result => {
      secret.value = result.secret; view.value = "created"; form.name = "";
      void nextTick(() => secretInput.value?.focus()); void reload();
    }, "MCP Token 已创建，请保存这次显示的完整 Token。");
}
async function copy(value) {
  const expected = copyGeneration;
  notice.value = ""; error.value = "";
  try { await navigator.clipboard.writeText(value); if (alive && expected === copyGeneration) notice.value = "已复制。"; }
  catch { if (alive && expected === copyGeneration) error.value = "无法自动复制，请选中文本后手动复制。"; }
}
function requestRevoke(token, event) {
  returnFocus = event.currentTarget; revokeTarget.value = token; confirmation.value.showModal();
}
function closeRevoke() { confirmation.value?.close(); revokeTarget.value = null; returnFocus?.focus(); }
function revoke() {
  if (!revokeTarget.value) return;
  const id = revokeTarget.value.id;
  return perform(() => appApi("/account/mcp-tokens/" + id + "/revoke", {}), () => {
    closeRevoke(); void reload();
  }, "MCP Token 已撤销。");
}
function statusLabel(token) { return { active: "可用", expired: "已过期", revoked: "已撤销", invalidated: "账号凭据已变更" }[token.status] || "不可用"; }
function date(value) { return value ? formatDate(value, { hour: "2-digit", minute: "2-digit" }) : translate("尚未使用"); }
function projectLabel(token) { return token.allProjects ? translate("全部可访问项目") : translate("{count} 个指定项目", { count: formatNumber(token.projectIds.length) }); }
onUnmounted(() => { alive = false; secret.value = ""; copyGeneration++; });
</script>
<template>
  <section class="mcp-access" :aria-label="$t('MCP 接入')">
    <header class="ui-settings-heading"><div><h2>{{ $t(title) }}</h2><p>{{ $t(description) }}</p></div>
    <div v-if="expanded">
      <div class="mcp-row">
        <button type="button" class="text-button" :disabled="saving" @click="close">{{ $t("收起 MCP 接入") }}</button>
      </div>
    </div></header>
    <button v-if="!expanded" ref="manageButton" type="button" @click="open">{{ $t("管理 MCP Token") }}</button>
    <div v-else class="mcp-settings">
      <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
      <button v-if="view !== 'overview'" ref="backButton" type="button" class="text-button mcp-back" :disabled="saving" @click="navigate('overview')"><ArrowLeftOutlined aria-hidden="true" />{{ $t("返回 MCP 接入") }}</button>
      <template v-if="view === 'overview'">
        <section class="mcp-card mcp-address-card" :aria-label="$t('连接地址')"><h3>{{ $t("连接地址") }}</h3><div class="mcp-address-row"><input :value="endpoint" readonly :aria-label="$t('MCP 地址')" /><button type="button" :aria-label="$t('复制 MCP 地址')" @click="copy(endpoint)"><CopyOutlined aria-hidden="true" />{{ $t("复制") }}</button></div><button type="button" class="text-button mcp-guide-link" @click="navigate('guide', $event)"><ArrowRightOutlined aria-hidden="true" />{{ $t("连接配置与图片上传") }}</button></section>
        <section class="mcp-personal-tokens" :aria-label="$t('个人 Token')">
          <header class="mcp-row mcp-between"><h3>{{ $t("个人 Token") }} <span v-if="data" class="mcp-count">{{ data.tokens.length }}</span></h3><div class="mcp-row"><button v-if="data?.tokens.length > 2" type="button" class="text-button" @click="showAll = !showAll">{{ showAll ? $t("收起列表") : $t("查看全部") }}</button><button type="button" class="text-button" :disabled="loading || saving" @click="reload"><ReloadOutlined aria-hidden="true" />{{ $t("刷新") }}</button><button ref="createButton" type="button" class="primary" :disabled="!data || loading || saving" @click="navigate('create', $event)"><PlusOutlined aria-hidden="true" />{{ $t("创建 Token") }}</button></div></header>
          <div class="mcp-token-panel">
          <p v-if="loading" class="muted" role="status">{{ $t("正在读取 MCP Token…") }}</p>
          <p v-else-if="!data" class="field-hint">{{ $t("Token 列表读取失败，请刷新重试。") }}</p>
          <div v-else-if="!data.tokens.length" class="mcp-empty"><KeyOutlined aria-hidden="true" /><h3>{{ $t("尚未创建 Token") }}</h3><p>{{ $t("为你的 Agent 创建一枚专属访问凭证。") }}</p><button type="button" @click="navigate('create', $event)">{{ $t("创建第一枚 Token") }}</button></div>
          <ul v-if="data?.tokens.length" class="mcp-token-list">
            <li v-for="token in visibleTokens" :key="token.id">
              <details class="mcp-token">
                <summary><span class="mcp-key"><KeyOutlined aria-hidden="true" /></span><span class="mcp-token-identity"><strong>{{ token.name }}</strong><span class="field-hint">{{ projectLabel(token) }} · {{ date(token.expiresAt) }} {{ $t("到期") }}</span></span><span class="mcp-status">{{ $t(statusLabel(token)) }}</span><span class="mcp-detail-label">{{ $t("详情") }} <DownOutlined aria-hidden="true" /></span></summary>
                <div class="mcp-token-details"><code>{{ token.prefix }}…</code><p class="field-hint">{{ $t("最近使用：") }}{{ date(token.lastUsedAt) }}</p><p v-if="!token.allProjects" class="field-hint">{{ $t("项目：") }}{{ token.projectIds.map(id => data.projects.find(project => project.id === id)?.name || id).join('、') }}</p><div class="mcp-scope-tags"><span v-for="id in token.scopes" :key="id">{{ $t(data.scopes.find(scope => scope.id === id)?.label || id) }}</span></div></div>
              </details>
              <button v-if="!token.revokedAt" type="button" class="text-button mcp-revoke" :aria-label="$t('撤销 {name}', { name: token.name })" :disabled="saving" @click="requestRevoke(token, $event)">{{ $t("撤销") }}</button>
            </li>
          </ul>
          </div>
        </section>
      </template>
      <template v-if="view === 'guide'">
        <McpConnectionHelp :origin="origin" @copy="copy" />
        <section class="mcp-upload-entry"><PictureOutlined aria-hidden="true" /><div><h3>{{ $t("上传图片，发布完整需求") }}</h3><p>{{ $t("HTTP 上传 → 获取附件 ID → MCP 发布") }}</p></div><button type="button" class="text-button" @click="navigate('upload', $event)">{{ $t("查看用法") }} <ArrowRightOutlined aria-hidden="true" /></button></section>
      </template>
      <form v-if="view === 'create' && data" class="mcp-card mcp-create-form" @submit.prevent="create">
        <div class="mcp-form-fields"><label>{{ $t("Token 名称") }}<input ref="nameInput" v-model="form.name" required maxlength="100" :placeholder="$t('例如：工作电脑 Codex')" :disabled="saving" /></label><label>{{ $t("有效期") }}<AppSelect native-events v-model.number="form.expiresInDays" :disabled="saving"><option :value="7">{{ $t("7 天") }}</option><option :value="30">{{ $t("30 天") }}</option><option :value="90">{{ $t("90 天") }}</option><option :value="365">{{ $t("365 天") }}</option></AppSelect></label></div>
        <fieldset :disabled="saving"><legend>{{ $t("允许的操作") }}</legend><div class="mcp-permissions"><label v-for="scope in data.scopes" :key="scope.id" class="mcp-choice"><input v-model="form.scopes" type="checkbox" :value="scope.id" :disabled="scope.id === 'read'" />{{ $t(scope.label) }}<span v-if="scope.id === 'read'" class="muted">{{ $t("（必选）") }}</span></label></div></fieldset>
        <fieldset :disabled="saving"><legend>{{ $t("项目范围") }}</legend><div class="mcp-row"><label class="mcp-choice"><input v-model="form.allProjects" type="radio" :value="true" name="mcp-project-range" />{{ $t("全部可访问项目") }}</label><label class="mcp-choice"><input v-model="form.allProjects" type="radio" :value="false" name="mcp-project-range" />{{ $t("指定项目") }}</label></div><p class="field-hint">{{ form.allProjects ? $t("包含当前及以后可访问的项目，实际权限受项目授权限制。") : $t("至少选择一个项目，实际权限受项目授权限制。") }}</p><div v-if="!form.allProjects" class="mcp-project-choices"><label v-for="project in data.projects" :key="project.id" class="mcp-choice"><input v-model="form.projectIds" type="checkbox" :value="project.id" />{{ project.name }}</label><p v-if="!data.projects.length" class="muted">{{ $t("暂无可授权的项目。") }}</p></div></fieldset>
        <div class="mcp-upload-hint"><h3><PictureOutlined aria-hidden="true" />{{ $t("需要在需求中附上图片？") }}</h3><p>{{ $t("使用同一 Token 通过 HTTP 上传，再在正文引用附件 ID。") }}</p><details><summary>{{ $t("查看 HTTP 上传示例") }}</summary><McpUploadHelp :origin="origin" @copy="copy" /></details></div>
        <p class="field-hint">{{ $t("指派采用一名开发负责人和多名关注人。负责人需有项目开发资格；创建与指派不会自动启动开发。") }}</p>
        <footer class="mcp-form-footer"><p class="field-hint">{{ $t("完整 Token 仅在创建成功时显示一次。") }}</p><button class="primary" :disabled="!canCreate">{{ saving ? $t("正在提交…") : $t("创建 MCP Token") }}</button></footer>
      </form>
      <template v-if="view === 'created'">
        <section v-if="secret" class="mcp-card mcp-secret" :aria-label="$t('Token 保存提示')"><p class="mcp-warning">{{ $t("请保存完整 Token，离开此页面后无法再次查看。") }}</p><label>{{ $t("新建 Token") }}<input ref="secretInput" :value="secret" readonly autocomplete="off" spellcheck="false" /></label><div class="mcp-row"><button type="button" @click="copy(secret)">{{ $t("复制 Token") }}</button><button type="button" class="text-button" @click="navigate('overview')">{{ $t("清除显示") }}</button></div></section>
        <McpConnectionHelp :origin="origin" @copy="copy" />
        <div class="mcp-row mcp-between"><button type="button" class="text-button" @click="navigate('upload', $event)"><PictureOutlined aria-hidden="true" />{{ $t("图片上传用法") }}</button><button type="button" class="primary" @click="navigate('overview')">{{ $t("已保存，返回列表") }}</button></div>
      </template>
      <McpUploadHelp v-if="view === 'upload'" class="mcp-card" :origin="origin" @copy="copy" />
    </div>
    <dialog ref="confirmation" class="workspace-dialog" aria-labelledby="mcp-revoke-title" @cancel.prevent="!saving && closeRevoke()">
      <h2 id="mcp-revoke-title">{{ $t("撤销 MCP Token") }}</h2><p>{{ $t("确认撤销「") }}{{ revokeTarget?.name }}{{ $t("」？使用它的 Agent 和 HTTP 上传将立即无法继续访问。") }}</p>
      <div class="actions"><button type="button" :disabled="saving" @click="closeRevoke">{{ $t("取消") }}</button><button type="button" class="primary" :disabled="saving" @click="revoke">{{ saving ? $t("正在撤销…") : $t("确认撤销") }}</button></div>
    </dialog>
  </section>
</template>
<style scoped>
.mcp-access { min-width: 0; max-width: 1160px; }
.mcp-settings { gap: 32px; }
.mcp-address-card { display: grid; gap: 18px; padding: 28px; }
.mcp-address-card h3 { font-size: 14px; }
.mcp-address-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
.mcp-address-row input { width: min(100%, 440px); min-width: 0; background: var(--soft); border-color: transparent; font: 12px var(--font-code); }
.mcp-guide-link { justify-self: start; color: var(--highlight); padding-inline: 0; }
.mcp-personal-tokens > header { margin-bottom: 16px; }
.mcp-personal-tokens > header h3 { font-size: 20px; }
.mcp-count { border: 1px solid var(--line); border-radius: 4px; background: var(--surface); padding: 2px 6px; }
.mcp-token-panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); overflow: hidden; }
.mcp-token-panel > p { margin: 24px; }
.mcp-token-list { margin: 0; }
.mcp-token-list > li { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 16px; padding: 4px 24px; }
.mcp-token { min-width: 0; }
.mcp-key { color: var(--highlight); background: var(--selected); border: 0; }
.mcp-status { padding: 4px 8px; background: var(--soft); border-radius: 4px; white-space: nowrap; }
.mcp-status::before { display: none; }
.mcp-detail-label { color: var(--muted); }
.mcp-revoke { margin-top: 18px; font-size: 12px; }
@media (max-width: 767px) {
  .mcp-address-card { padding: 20px; }
  .mcp-token-list > li { padding-inline: 20px; gap: 8px; }
}
@media (max-width: 480px) {
  .mcp-token-list > li { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .mcp-revoke { justify-self: end; margin: 0 0 12px; }
  .mcp-status { margin-left: 48px; }
  .mcp-detail-label { margin-left: 0; }
  .mcp-token-identity { flex-basis: calc(100% - 48px); }
}
</style>
