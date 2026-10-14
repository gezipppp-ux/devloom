<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed, nextTick, ref, watch } from "vue";
import { createRequestId } from "../../shared/api/request-id.js";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import WorkflowGraph from "../../shared/components/WorkflowGraph.vue";
import { freeNodePosition, workflowNodes } from "../../shared/components/workflow-routing.js";

const type = ref("requirement"), definition = ref({ nodes: [], transitions: [] });
const selected = ref(""), selectedEdge = ref(""), deleting = ref(false), editor = ref(), graph = ref();
const endpoint = () => `/system/workflows/${type.value}`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint()));
function clear() { selected.value = ""; selectedEdge.value = ""; deleting.value = false; }
function closeEditor() { clear(); graph.value?.focusCanvas(); }
function cancelDelete() { deleting.value = false; void focusName(); }
watch(data, value => { if (value) { definition.value = JSON.parse(JSON.stringify(value.workflow.draft)); clear(); } });
watch(type, () => { data.value = null; definition.value = { nodes: [], transitions: [] }; notice.value = ""; clear(); void reload(); });
watch(definition, value => {
  if (data.value && JSON.stringify(value) !== JSON.stringify(data.value.workflow.draft)) notice.value = "";
}, { deep: true });
const node = computed(() => definition.value.nodes.find(item => item.id === selected.value));
const edge = computed(() => definition.value.transitions.find(item => item.id === selectedEdge.value));
const terminal = computed(() => ['completed', 'cancelled'].includes(node.value?.kind));
const references = computed(() => definition.value.transitions.filter(item => item.from === selected.value || item.to === selected.value).length);
const id = prefix => `${prefix}_${createRequestId().replaceAll('-', '').slice(0, 12)}`;
function selectNode(value) { if (saving.value) return; clear(); selected.value = value; }
function selectEdge(value) { if (saving.value) return; clear(); selectedEdge.value = value; }
async function focusName() { await nextTick(); editor.value?.querySelector('input')?.focus(); }
function addNode(position) {
  if (saving.value || loading.value) return;
  if (definition.value.nodes.length >= 100) { error.value = '最多支持 100 个状态。'; return; }
  const value = { id: id('node'), name: "新状态", kind: "normal", allowDevelopment: false, ...freeNodePosition(position, workflowNodes(definition.value)) };
  definition.value.nodes.push(value); selectNode(value.id); void focusName();
}
function addEdge({ from, to }) {
  if (saving.value || from === to) return;
  if (definition.value.transitions.length >= 500) { error.value = '最多支持 500 条连线。'; return; }
  const value = { id: id('edge'), from, to, name: "流转", permission: "issue.transition", requiresReason: false };
  definition.value.transitions.push(value); selectEdge(value.id); void focusName();
}
function moveNode(value) { if (!saving.value) Object.assign(definition.value.nodes.find(item => item.id === value.id), value); }
function changeKind() { if (terminal.value) node.value.allowDevelopment = false; }
async function requestDelete() {
  if (saving.value) return;
  deleting.value = true;
  await nextTick(); editor.value?.querySelector('[data-cancel-delete]')?.focus();
}
function remove() {
  if (saving.value) return;
  if (node.value) {
    definition.value.transitions = definition.value.transitions.filter(item => item.from !== selected.value && item.to !== selected.value);
    definition.value.nodes = definition.value.nodes.filter(item => item.id !== selected.value);
  } else definition.value.transitions = definition.value.transitions.filter(item => item.id !== selectedEdge.value);
  closeEditor();
}
async function persist(publish = false) {
  if (loading.value || !data.value) return;
  const path = endpoint(), draft = JSON.parse(JSON.stringify(definition.value)), revision = data.value.workflow.revision;
  const result = await save(path, { revision, definition: draft }, result => { data.value = result; }, "流程草稿已保存。");
  if (result && publish) await save(`${path}/publish`, { revision: result.workflow.revision }, result => { data.value = result; }, "流程已发布，新事项将使用此版本。");
}
</script>

<template>
  <section class="workflow-settings" :aria-label="$t('流程编排')">
    <header class="ui-settings-heading"><div><h2>{{ $t("流程编排") }}</h2><p>{{ $t("系统统一维护需求和 Bug 两套流程，发布后用于所有项目的新事项。") }}</p></div></header>
    <div class="workflow-page-toolbar"><div class="workflow-type-tabs" role="group" :aria-label="$t('流程类型')"><button type="button" :aria-pressed="type === 'requirement'" :disabled="saving" @click="type = 'requirement'">{{ $t("需求流程") }}</button><button type="button" :aria-pressed="type === 'bug'" :disabled="saving" @click="type = 'bug'">{{ $t("Bug 流程") }}</button></div><span v-if="data" class="workflow-version">{{ $t("已发布 v") }}{{ data.workflow.publishedVersion }}</span></div>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <p v-if="loading" role="status">{{ $t("正在读取流程…") }}</p>
    <button v-if="error" :disabled="loading || saving" @click="reload">{{ $t("重新读取流程") }}</button>
    <template v-if="data">
      <WorkflowGraph :key="type" ref="graph" :definition="definition" :selected="selected" :selected-edge="selectedEdge" :editable="!saving && !loading" @select="selectNode" @select-edge="selectEdge" @move="moveNode" @add="addNode" @connect="addEdge" @clear="clear" @delete="requestDelete">
        <template #inspector>
          <fieldset ref="editor" :disabled="saving || loading" class="canvas-properties" @keydown.esc.stop.prevent="deleting ? cancelDelete() : closeEditor()">
            <template v-if="node">
              <header><h3>{{ $t("状态属性") }}</h3><span>{{ $t("即时修改草稿") }}</span></header>
              <label>{{ $t("状态名称") }}<input v-model="node.name" maxlength="80" /></label>
              <label>{{ $t("状态类型") }}<AppSelect native-events v-model="node.kind" :aria-label="$t('状态类型')" @change="changeKind"><option value="initial">{{ $t("初始") }}</option><option value="normal">{{ $t("普通") }}</option><option value="completed">{{ $t("完成") }}</option><option value="cancelled">{{ $t("取消") }}</option></AppSelect></label>
              <label class="permission-choice"><input v-model="node.allowDevelopment" type="checkbox" :disabled="terminal" />{{ $t("允许开始开发") }}</label>
              <p v-if="terminal" class="field-hint">{{ $t("完成、取消状态不允许开始开发。") }}</p>
            </template>
            <template v-else-if="edge">
              <header><h3>{{ $t("连线属性") }}</h3><span>{{ $t("即时修改草稿") }}</span></header>
              <label>{{ $t("操作名称") }}<input v-model="edge.name" maxlength="80" /></label>
              <label>{{ $t("来源状态") }}<AppSelect native-events v-model="edge.from" :aria-label="$t('来源状态')"><option v-for="item in definition.nodes" :key="item.id" :value="item.id" :disabled="item.id === edge.to">{{ item.name }}</option></AppSelect></label>
              <label>{{ $t("目标状态") }}<AppSelect native-events v-model="edge.to" :aria-label="$t('目标状态')"><option v-for="item in definition.nodes" :key="item.id" :value="item.id" :disabled="item.id === edge.from">{{ item.name }}</option></AppSelect></label>
              <label>{{ $t("所需权限") }}<AppSelect native-events v-model="edge.permission" :aria-label="$t('所需权限')"><option value="issue.transition">{{ $t("事项流转") }}</option><option value="issue.accept">{{ $t("事项验收") }}</option></AppSelect></label>
              <label class="permission-choice"><input v-model="edge.requiresReason" type="checkbox" />{{ $t("必须填写原因") }}</label>
            </template>
            <div v-if="deleting" class="canvas-delete" role="alert">
              <p>{{ $t("删除「") }}{{ node?.name || edge?.name }}」{{ node && references ? $t('及其 {count} 条连线', { count: references }) : '' }}{{ $t("？保存草稿后生效，已发布版本不变。") }}</p>
              <div class="actions"><button data-cancel-delete @click="cancelDelete">{{ $t("取消删除") }}</button><button class="danger" @click="remove">{{ $t("确认删除") }}</button></div>
            </div>
            <button v-else class="canvas-remove" @click="requestDelete">{{ node ? $t("删除状态") : $t("删除连线") }}</button>
          </fieldset>
        </template>
        <template #actions="{ fullscreen }"><p v-if="fullscreen && (error || notice)" class="canvas-feedback" :class="{ 'is-error': error }" :role="error ? 'alert' : 'status'">{{ error || notice }}</p><div class="actions"><button :disabled="loading || saving" @click="persist()">{{ $t("保存流程草稿") }}</button><button class="primary" :disabled="loading || saving" @click="persist(true)">{{ saving ? $t("正在保存…") : $t("校验并发布流程") }}</button></div></template>
      </WorkflowGraph>
      <p class="field-hint">{{ $t("修改先保留为草稿；发布不会改变已有事项绑定的流程。") }}</p>
    </template>
  </section>
</template>

<style scoped>
.workflow-settings { min-width: 0; }
.workflow-page-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
.workflow-type-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
.workflow-type-tabs button { border: 0; background: transparent; color: var(--muted); }
.workflow-type-tabs button[aria-pressed="true"] { background: var(--selected); color: var(--highlight); }
.workflow-version { padding: 4px 8px; border-radius: 4px; background: var(--soft); font-size: 12px; color: var(--muted); }
.canvas-properties { display: grid; gap: 16px; padding: 0; margin: 0; border: 0; min-width: 0; }
.canvas-properties header { display: grid; gap: 4px; }
.canvas-properties h3 { font-size: 15px; margin: 0; }
.canvas-properties header span { font-size: 12px; color: var(--muted); }
.canvas-properties label { display: grid; gap: 8px; min-width: 0; font-size: 13px; }
.canvas-properties input:not([type="checkbox"]), .canvas-properties select { width: 100%; min-width: 0; }
.canvas-properties .permission-choice { display: flex; align-items: center; gap: 8px; }
.canvas-properties .field-hint { margin: 0; }
.canvas-remove { color: var(--danger); justify-self: start; }
.canvas-feedback { flex: 1 1 180px; margin: 0; font-size: 13px; color: var(--success); overflow-wrap: anywhere; }
.canvas-feedback.is-error { color: var(--danger); }
.canvas-delete { padding: 12px; border: 1px solid var(--danger); border-radius: var(--radius-control); background: var(--danger-soft); font-size: 13px; overflow-wrap: anywhere; }
.canvas-delete p { margin: 0 0 12px; }
@media (max-width: 480px) { .canvas-properties input:not([type="checkbox"]), .canvas-properties select { font-size: 16px; } }
</style>
