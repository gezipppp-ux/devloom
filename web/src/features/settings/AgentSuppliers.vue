<script setup>
import { nextTick, ref, watch } from "vue";
import { PlusOutlined, ReloadOutlined, ApiOutlined } from "@antdv-next/icons";
import AgentSupplierEditor from "./AgentSupplierEditor.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { useAgentSuppliers } from "./use-agent-suppliers.js";
import "./agent-suppliers.css";
const { suppliers, currentId, loading, busy, error, notice, editor, confirmation, load, edit, duplicate, confirm, applyConfirmation, saved } = useAgentSuppliers();
const confirmationDialog = ref();
watch(confirmation, async value => {
  if (value) { await nextTick(); confirmationDialog.value?.showModal(); }
  else confirmationDialog.value?.close();
});
const actionLabel = pending => pending.action === 'activate' ? '设为默认' : pending.action === 'delete' ? '删除供应商' : pending.row.enabled ? '停用供应商' : '启用供应商';
</script>
<template>
  <section :aria-label="$t('Agent 供应商')">
    <div class="supplier-toolbar supplier-page-heading"><div><h2><ApiOutlined aria-hidden="true" /> {{ $t("Agent 供应商") }}</h2><p class="muted">{{ $t("系统统一配置 · Codex") }}</p></div><div class="actions"><button :disabled="loading || busy" @click="load"><ReloadOutlined aria-hidden="true" /> {{ $t("刷新") }}</button><button class="primary" :disabled="busy" @click="edit()"><PlusOutlined aria-hidden="true" /> {{ $t("新增供应商") }}</button></div></div>
    <p class="supplier-banner">{{ $t("所有会话的新轮次使用系统默认供应商。切换后，正在执行的轮次和审批继续使用原配置。") }}</p>
    <p v-if="loading" role="status">{{ $t("正在加载供应商…") }}</p>
    <p v-else-if="!suppliers.length" class="muted">{{ $t("暂无可显示的供应商。请刷新重试。") }}</p>
    <div class="supplier-grid" :aria-busy="loading">
      <article v-for="row in suppliers" :key="row.id" class="supplier-card" :class="{ 'supplier-current': row.id === currentId }">
        <div class="supplier-identity"><span class="supplier-symbol" aria-hidden="true"><ApiOutlined /></span><div><div class="supplier-name"><h3>{{ row.name }}</h3><span class="supplier-tag" :class="{ 'supplier-disabled': !row.enabled }">{{ row.id === currentId ? $t("当前默认") : row.enabled ? $t("已启用") : $t("已停用") }}</span></div><p class="supplier-address">{{ row.builtin ? $t("使用服务账号原有 Codex 配置与认证") : row.baseUrl }}</p></div></div>
        <dl><dt>{{ $t("默认模型") }}</dt><dd>{{ row.builtin ? $t("跟随服务器配置") : row.defaultModel }}</dd><dt>{{ $t("认证") }}</dt><dd>{{ row.builtin ? $t("服务器现有认证") : row.hasApiKey ? $t("Key 已配置") : $t("未配置") }}</dd></dl>
        <p v-if="row.notes" class="supplier-notes">{{ row.notes }}</p>
        <div class="supplier-card-footer"><span class="supplier-tag supplier-auth-type">{{ row.builtin ? $t("服务器配置") : 'API Key' }}</span>
          <button :class="{ primary: row.id !== currentId }" :disabled="busy || loading || !row.enabled || row.id === currentId" @click="confirm(row, 'activate')">{{ row.id === currentId ? $t("正在使用") : $t("设为默认") }}</button>
          <div v-if="!row.builtin" class="supplier-card-actions"><button :disabled="busy" @click="edit(row)">{{ $t("编辑 / 检测") }}</button><button :disabled="busy" @click="duplicate(row)">{{ $t("复制") }}</button><button :disabled="busy || row.id === currentId" @click="confirm(row, 'toggle')">{{ row.enabled ? $t("停用") : $t("启用") }}</button><button class="danger" :disabled="busy || row.id === currentId" @click="confirm(row, 'delete')">{{ $t("删除") }}</button></div>
          <p v-else class="field-hint">{{ $t("在环境检测中查看服务器认证状态。") }}</p>
        </div>
      </article>
    </div>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <AgentSupplierEditor v-if="editor" :draft="editor" @close="editor = null" @saved="saved" />
    <dialog v-if="confirmation" ref="confirmationDialog" class="supplier-dialog supplier-confirm" aria-labelledby="supplier-confirm-title" @cancel.prevent="!busy && (confirmation = null)">
      <h2 id="supplier-confirm-title">{{ $t(actionLabel(confirmation)) }}</h2><p>{{ $t("供应商：") }}{{ confirmation.row.name }}</p>
      <p>{{ confirmation.action === 'activate' ? $t("新建及已有会话的下一轮将使用此供应商，当前轮次继续执行。") : confirmation.action === 'delete' ? $t("删除后无法恢复此配置。历史轮次记录会保留；仍被运行中或状态不明确的轮次使用时，服务器将阻止删除。") : $t("已开始的轮次继续执行；停用后不能再选为默认供应商。") }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p><footer class="actions"><button :disabled="busy" @click="confirmation = null">{{ $t("取消") }}</button><button class="primary" :disabled="busy" @click="applyConfirmation">{{ busy ? $t("处理中…") : actionLabel(confirmation) }}</button></footer>
    </dialog>
  </section>
</template>
