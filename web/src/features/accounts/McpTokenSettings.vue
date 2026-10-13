<script setup>
/* global window, navigator */
import { computed, nextTick, onUnmounted, reactive, ref } from "vue";
import { ArrowLeftOutlined, ArrowRightOutlined, DownOutlined, KeyOutlined, PictureOutlined, PlusOutlined, ReloadOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import McpConnectionHelp from "./McpConnectionHelp.vue";
import McpUploadHelp from "./McpUploadHelp.vue";

const expanded = ref(false), view = ref("overview"), showAll = ref(false), secret = ref("");
const revokeTarget = ref(null), confirmation = ref(null), nameInput = ref(null), secretInput = ref(null), createButton = ref(null), manageButton = ref(null), backButton = ref(null);
const form = reactive({ name: "", expiresInDays: 30, allProjects: true, projectIds: [], scopes: ["read", "issues.write", "issues.assign", "releases.write", "files.upload"] });
const { data, loading, saving, error, notice, reload, perform } = useResource(() => appApi("/account/mcp-tokens"), { immediate: false });
const origin = window.location.origin;
const canCreate = computed(() => form.name.trim() && (form.allProjects || form.projectIds.length) && data.value && !loading.value && !saving.value);
const visibleTokens = computed(() => showAll.value ? data.value?.tokens || [] : (data.value?.tokens || []).slice(0, 2));
const title = computed(() => ({ overview: "MCP 接入", create: "创建 MCP Token", created: "Token 已创建", upload: "图片上传与发布" })[view.value]);
const description = computed(() => ({ overview: "让 Agent 访问项目，发布图文需求与 Bug。", create: "按 Agent 或设备区分凭证，方便管理与撤销。", created: "保存凭证后，将它配置到你的客户端。", upload: "使用受鉴权 HTTP 上传，在正文中引用附件 ID。" })[view.value]);
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
function date(value) { return value ? new Date(value).toLocaleString() : "尚未使用"; }
function projectLabel(token) { return token.allProjects ? "全部可访问项目" : token.projectIds.length + " 个指定项目"; }
onUnmounted(() => { alive = false; secret.value = ""; copyGeneration++; });
</script>
<template>
  <FormSection :title="title" :description="description" class="mcp-access" :class="{ 'mcp-access-expanded': expanded }">
    <template v-if="expanded" #action>
      <div class="mcp-row">
        <button v-if="view === 'overview'" ref="createButton" type="button" class="primary" :disabled="!data || loading || saving" @click="navigate('create', $event)"><PlusOutlined aria-hidden="true" />创建 Token</button>
        <button type="button" class="text-button" :disabled="saving" @click="close">收起 MCP 接入</button>
      </div>
    </template>
    <button v-if="!expanded" ref="manageButton" type="button" @click="open">管理 MCP Token</button>
    <div v-else class="mcp-settings">
      <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
      <button v-if="view !== 'overview'" ref="backButton" type="button" class="text-button mcp-back" :disabled="saving" @click="navigate('overview')"><ArrowLeftOutlined aria-hidden="true" />返回 MCP 接入</button>
      <template v-if="view === 'overview'">
        <McpConnectionHelp :origin="origin" @copy="copy" />
        <section class="mcp-card" aria-label="我的 Token">
          <header class="mcp-row mcp-between"><h3>我的 Token <span v-if="data" class="mcp-count">{{ data.tokens.length }}</span></h3><div class="mcp-row"><button v-if="data?.tokens.length > 2" type="button" class="text-button" @click="showAll = !showAll">{{ showAll ? '收起列表' : '查看全部' }}</button><button type="button" class="text-button" :disabled="loading || saving" @click="reload"><ReloadOutlined aria-hidden="true" />刷新</button></div></header>
          <p v-if="loading" class="muted" role="status">正在读取 MCP Token…</p>
          <p v-else-if="!data" class="field-hint">Token 列表读取失败，请刷新重试。</p>
          <div v-else-if="!data.tokens.length" class="mcp-empty"><KeyOutlined aria-hidden="true" /><h3>尚未创建 Token</h3><p>为你的 Agent 创建一枚专属访问凭证。</p><button type="button" @click="navigate('create', $event)">创建第一枚 Token</button></div>
          <ul v-if="data?.tokens.length" class="mcp-token-list">
            <li v-for="token in visibleTokens" :key="token.id">
              <details class="mcp-token">
                <summary><span class="mcp-key"><KeyOutlined aria-hidden="true" /></span><span class="mcp-token-identity"><span class="mcp-row"><strong>{{ token.name }}</strong><span class="mcp-status" :class="{ 'is-active': token.status === 'active' }">{{ statusLabel(token) }}</span></span><span class="field-hint">{{ projectLabel(token) }} · {{ date(token.expiresAt) }} 到期</span></span><span class="mcp-detail-label">详情 <DownOutlined aria-hidden="true" /></span></summary>
                <div class="mcp-token-details"><code>{{ token.prefix }}…</code><p class="field-hint">最近使用：{{ date(token.lastUsedAt) }}</p><p v-if="!token.allProjects" class="field-hint">项目：{{ token.projectIds.map(id => data.projects.find(project => project.id === id)?.name || id).join('、') }}</p><div class="mcp-scope-tags"><span v-for="id in token.scopes" :key="id">{{ data.scopes.find(scope => scope.id === id)?.label || id }}</span></div><button v-if="!token.revokedAt" type="button" class="danger" :disabled="saving" @click="requestRevoke(token, $event)">撤销 {{ token.name }}</button></div>
              </details>
            </li>
          </ul>
        </section>
        <section class="mcp-upload-entry"><PictureOutlined aria-hidden="true" /><div><h3>上传图片，发布完整需求</h3><p>HTTP 上传 → 获取附件 ID → MCP 发布</p></div><button type="button" class="text-button" @click="navigate('upload', $event)">查看用法 <ArrowRightOutlined aria-hidden="true" /></button></section>
      </template>
      <form v-if="view === 'create' && data" class="mcp-card mcp-create-form" @submit.prevent="create">
        <div class="mcp-form-fields"><label>Token 名称<input ref="nameInput" v-model="form.name" required maxlength="100" placeholder="例如：工作电脑 Codex" :disabled="saving" /></label><label>有效期<select v-model.number="form.expiresInDays" :disabled="saving"><option :value="7">7 天</option><option :value="30">30 天</option><option :value="90">90 天</option><option :value="365">365 天</option></select></label></div>
        <fieldset :disabled="saving"><legend>允许的操作</legend><div class="mcp-permissions"><label v-for="scope in data.scopes" :key="scope.id" class="mcp-choice"><input v-model="form.scopes" type="checkbox" :value="scope.id" :disabled="scope.id === 'read'" />{{ scope.label }}<span v-if="scope.id === 'read'" class="muted">（必选）</span></label></div></fieldset>
        <fieldset :disabled="saving"><legend>项目范围</legend><div class="mcp-row"><label class="mcp-choice"><input v-model="form.allProjects" type="radio" :value="true" name="mcp-project-range" />全部可访问项目</label><label class="mcp-choice"><input v-model="form.allProjects" type="radio" :value="false" name="mcp-project-range" />指定项目</label></div><p class="field-hint">{{ form.allProjects ? '包含当前及以后可访问的项目，实际权限受项目授权限制。' : '至少选择一个项目，实际权限受项目授权限制。' }}</p><div v-if="!form.allProjects" class="mcp-project-choices"><label v-for="project in data.projects" :key="project.id" class="mcp-choice"><input v-model="form.projectIds" type="checkbox" :value="project.id" />{{ project.name }}</label><p v-if="!data.projects.length" class="muted">暂无可授权的项目。</p></div></fieldset>
        <div class="mcp-upload-hint"><h3><PictureOutlined aria-hidden="true" />需要在需求中附上图片？</h3><p>使用同一 Token 通过 HTTP 上传，再在正文引用附件 ID。</p><details><summary>查看 HTTP 上传示例</summary><McpUploadHelp :origin="origin" @copy="copy" /></details></div>
        <p class="field-hint">指派采用一名开发负责人和多名参与人。负责人需有项目开发资格；创建与指派不会自动启动开发。</p>
        <footer class="mcp-form-footer"><p class="field-hint">完整 Token 仅在创建成功时显示一次。</p><button class="primary" :disabled="!canCreate">{{ saving ? '正在提交…' : '创建 MCP Token' }}</button></footer>
      </form>
      <template v-if="view === 'created'">
        <section v-if="secret" class="mcp-card mcp-secret" aria-label="Token 保存提示"><p class="mcp-warning">请保存完整 Token，离开此页面后无法再次查看。</p><label>新建 Token<input ref="secretInput" :value="secret" readonly autocomplete="off" spellcheck="false" /></label><div class="mcp-row"><button type="button" @click="copy(secret)">复制 Token</button><button type="button" class="text-button" @click="navigate('overview')">清除显示</button></div></section>
        <McpConnectionHelp :origin="origin" @copy="copy" />
        <div class="mcp-row mcp-between"><button type="button" class="text-button" @click="navigate('upload', $event)"><PictureOutlined aria-hidden="true" />图片上传用法</button><button type="button" class="primary" @click="navigate('overview')">已保存，返回列表</button></div>
      </template>
      <McpUploadHelp v-if="view === 'upload'" class="mcp-card" :origin="origin" @copy="copy" />
    </div>
    <dialog ref="confirmation" class="workspace-dialog" aria-labelledby="mcp-revoke-title" @cancel.prevent="!saving && closeRevoke()">
      <h2 id="mcp-revoke-title">撤销 MCP Token</h2><p>确认撤销「{{ revokeTarget?.name }}」？使用它的 Agent 和 HTTP 上传将立即无法继续访问。</p>
      <div class="actions"><button type="button" :disabled="saving" @click="closeRevoke">取消</button><button type="button" class="primary" :disabled="saving" @click="revoke">{{ saving ? '正在撤销…' : '确认撤销' }}</button></div>
    </dialog>
  </FormSection>
</template>
