<script setup>
import workflowEvents from "../../../../shared/workflow-events.json";
import AppSelect from "../../shared/components/AppSelect.vue";
import { computed, nextTick, ref, watch } from "vue";
import { createRequestId } from "../../shared/api/request-id.js";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import WorkflowGraph from "../../shared/components/WorkflowGraph.vue";
import { freeNodePosition, workflowNodes } from "../../shared/components/workflow-routing.js";

const actorLabels = { handler: "当前处理人", developer: "开发负责人", reviewer: "本轮验证人", assigner: "分派协调人" };
const assignmentLabels = { role: "目标节点职责", selection: "本次选择处理人", executor: "当前开发执行人", reviewer: "本轮验证人", submitter: "本轮交付提交人" };
const replacing = ref(false), previewing = ref(false);
const fieldLabels = { description: '描述', acceptanceCriteria: '验收标准', reproductionSteps: '复现步骤', expectedResult: '预期结果', actualResult: '实际结果', releaseId: '目标版本', qaOwnerId: '测试负责人', acceptanceOwnerId: '业务验收人' };
function preview() { simulationNode.value = selected.value || definition.value.nodes.find(node => node.kind === 'initial')?.id || ''; simulationEvent.value = 'manual'; previewing.value = true; }
const dirty = computed(() => data.value && JSON.stringify(definition.value) !== JSON.stringify(data.value.workflow.draft));
function loadRecommended() { definition.value = JSON.parse(JSON.stringify(data.value.recommendedDefinition)); clear(); replacing.value = false; }
const simulationNode = ref(""), simulationEvent = ref("manual");
const simulation = computed(() => definition.value.transitions.filter(item => item.from === simulationNode.value && item.trigger === simulationEvent.value));
const type = ref("requirement"), definition = ref({ nodes: [], transitions: [] });
const selected = ref(""), selectedEdge = ref(""), deleting = ref(false), editor = ref(), graph = ref();
const endpoint = () => `/system/workflows/${type.value}`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint()));
function clear() { selected.value = ""; selectedEdge.value = ""; deleting.value = false; }
function closeEditor() { clear(); graph.value?.focusCanvas(); }
function cancelDelete() { deleting.value = false; void focusName(); }
watch(data, value => { if (value) { definition.value = JSON.parse(JSON.stringify(value.workflow.draft)); clear(); } });
watch(type, () => { replacing.value = false; previewing.value = false; data.value = null; definition.value = { nodes: [], transitions: [] }; notice.value = ""; clear(); void reload(); });
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
  const value = { id: id('node'), name: "新状态", kind: "normal", allowDevelopment: false, allowAssignment: false, active: false, handler: "businessOwner", category: "work", ...freeNodePosition(position, workflowNodes(definition.value)) };
  definition.value.nodes.push(value); selectNode(value.id); void focusName();
}
function addEdge({ from, to }) {
  if (saving.value || from === to) return;
  if (definition.value.transitions.length >= 500) { error.value = '最多支持 500 条连线。'; return; }
  const value = { id: id('edge'), from, to, name: "流转", permission: "issue.transition", requiresReason: false, trigger: "manual", actor: "handler", assignment: "role" };
  definition.value.transitions.push(value); selectEdge(value.id); void focusName();
}
function moveNode(value) { if (!saving.value) Object.assign(definition.value.nodes.find(item => item.id === value.id), value); }
function changeKind() { if (terminal.value) { node.value.allowDevelopment = false; node.value.allowAssignment = false; node.value.active = false; } }
function changeTrigger() { edge.value.actor = workflowEvents[edge.value.trigger].actors[0]; edge.value.assignment = ["delivery.submitted", "verification.started"].includes(edge.value.trigger) ? "reviewer" : edge.value.trigger.startsWith("development.") ? "executor" : "role"; }
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
    <header class="ui-settings-heading"><div><h2>{{ $t("流程编排") }}</h2><p>{{ $t("系统统一维护需求和 Bug 两套流程，发布后用于所有项目的新事项。") }}</p></div><div v-show="!graph?.fullscreen" class="actions"><button :disabled="!data || loading || saving" @click="persist()">{{ $t('保存流程草稿') }}</button><button class="primary" :disabled="!data || loading || saving" @click="persist(true)">{{ saving ? $t('正在保存…') : $t('校验并发布流程') }}</button></div></header>
    <div class="workflow-page-toolbar"><div class="workflow-type-tabs" role="group" :aria-label="$t('流程类型')"><button type="button" :aria-pressed="type === 'requirement'" :disabled="saving" @click="type = 'requirement'">{{ $t("需求流程") }}</button><button type="button" :aria-pressed="type === 'bug'" :disabled="saving" @click="type = 'bug'">{{ $t("Bug 流程") }}</button></div><span v-if="data" class="workflow-version">{{ $t("已发布 v") }}{{ data.workflow.publishedVersion }}</span><span v-if="dirty" class="field-hint">{{ $t('草稿未保存') }}</span><div class="actions workflow-tools"><button :disabled="!data?.recommendedDefinition || saving || loading" @click="replacing = true">{{ $t('流程模板') }}</button><button :disabled="!data || saving || loading" @click="preview">{{ $t('交接预览') }}</button></div></div>
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
              <label>{{ $t('处理职责') }}<AppSelect v-model="node.handler" :aria-label="$t('处理职责')"><option v-for="[value, label] in [['businessOwner','业务负责人'], ['reporter','提报人'], ['developer','开发负责人'], ['qaOwner','测试负责人'], ['acceptanceOwner','业务验收人']]" :key="value" :value="value">{{ $t(label) }}</option></AppSelect></label>
              <label>{{ $t('工作类别') }}<AppSelect v-model="node.category" :aria-label="$t('工作类别')"><option v-for="[value, label] in [['planning','规划与评审'], ['work','一般处理'], ['development','开发'], ['verification','测试与验收']]" :key="value" :value="value">{{ $t(label) }}</option></AppSelect></label>
              <p class="field-hint">{{ $t('流程按职责分派当前处理人，工作类别决定个人工作台栏目。') }}</p>
              <label class="permission-choice"><input v-model="node.allowAssignment" type="checkbox" :disabled="terminal" />{{ $t("允许认领或指派") }}</label>
              <label class="permission-choice"><input v-model="node.active" type="checkbox" :disabled="terminal" />{{ $t("进入后为处理中") }}</label>
              <label class="permission-choice"><input v-model="node.allowDevelopment" type="checkbox" :disabled="terminal" />{{ $t("允许开始开发") }}</label>
              <p v-if="terminal" class="field-hint">{{ $t("完成、取消状态不允许开始开发。") }}</p>
            </template>
            <template v-else-if="edge">
              <header><h3>{{ $t("连线属性") }}</h3><span>{{ $t("即时修改草稿") }}</span></header>
              <label>{{ $t("操作名称") }}<input v-model="edge.name" maxlength="80" /></label>
              <label>{{ $t("来源状态") }}<AppSelect native-events v-model="edge.from" :aria-label="$t('来源状态')"><option v-for="item in definition.nodes" :key="item.id" :value="item.id" :disabled="item.id === edge.to">{{ item.name }}</option></AppSelect></label>
              <label>{{ $t("目标状态") }}<AppSelect native-events v-model="edge.to" :aria-label="$t('目标状态')"><option v-for="item in definition.nodes" :key="item.id" :value="item.id" :disabled="item.id === edge.from">{{ item.name }}</option></AppSelect></label>
              <label>{{ $t('触发事件') }}<AppSelect native-events v-model="edge.trigger" :aria-label="$t('触发事件')" @change="changeTrigger"><option v-for="(event, id) in workflowEvents" :key="id" :value="id">{{ $t(event.label) }}</option></AppSelect></label>
              <label>{{ $t('操作主体') }}<AppSelect v-model="edge.actor" :aria-label="$t('操作主体')"><option v-for="actor in workflowEvents[edge.trigger]?.actors || []" :key="actor" :value="actor">{{ $t(actorLabels[actor]) }}</option></AppSelect></label>
              <label>{{ $t('下一处理人规则') }}<AppSelect v-model="edge.assignment" :aria-label="$t('下一处理人规则')"><option v-for="(label, id) in assignmentLabels" :key="id" :value="id" :disabled="id === 'reviewer' && !['delivery.submitted', 'verification.started'].includes(edge.trigger) || id === 'submitter' && !['verification.returned', 'manual'].includes(edge.trigger)">{{ $t(label) }}</option></AppSelect></label>
              <label class="permission-choice"><input v-model="edge.requireDelivery" type="checkbox" />{{ $t('必须有有效交付') }}</label>
              <label>{{ $t("所需权限") }}<AppSelect native-events v-model="edge.permission" :aria-label="$t('所需权限')"><option value="issue.transition">{{ $t("事项流转") }}</option><option value="issue.accept">{{ $t("事项验收") }}</option></AppSelect></label>
              <label>{{ $t('流转必填资料') }}<AppSelect native-events multiple :aria-label="$t('流转必填资料')" @change="edge.requiredFields = [...$event.target.selectedOptions].map(option => option.value)"><option v-for="[value, label] in [['description','描述'], ['acceptanceCriteria','验收标准'], ['reproductionSteps','复现步骤'], ['expectedResult','预期结果'], ['actualResult','实际结果'], ['releaseId','目标版本'], ['qaOwnerId','测试负责人'], ['acceptanceOwnerId','业务验收人']]" :key="value" :value="value" :selected="edge.requiredFields?.includes(value)">{{ $t(label) }}</option></AppSelect></label>
              <label class="permission-choice"><input type="checkbox" v-model="edge.requireAcceptedDelivery" />{{ $t('必须已有通过验收的交付') }}</label>
              <label class="permission-choice"><input v-model="edge.requiresReason" type="checkbox" />{{ $t("必须填写原因") }}</label>
            </template>
            <div v-if="deleting" class="canvas-delete" role="alert">
              <p>{{ $t("删除「") }}{{ node?.name || edge?.name }}」{{ node && references ? $t('及其 {count} 条连线', { count: references }) : '' }}{{ $t("？保存草稿后生效，已发布版本不变。") }}</p>
              <div class="actions"><button data-cancel-delete @click="cancelDelete">{{ $t("取消删除") }}</button><button class="danger" @click="remove">{{ $t("确认删除") }}</button></div>
            </div>
            <button v-else class="canvas-remove" @click="requestDelete">{{ node ? $t("删除状态") : $t("删除连线") }}</button>
          </fieldset>
        </template>
        <template #actions="{ fullscreen }"><p v-if="fullscreen && (error || notice)" class="canvas-feedback" :class="{ 'is-error': error }" :role="error ? 'alert' : 'status'">{{ error || notice }}</p><div v-if="fullscreen" class="actions"><button :disabled="loading || saving" @click="persist()">{{ $t("保存流程草稿") }}</button><button class="primary" :disabled="loading || saving" @click="persist(true)">{{ saving ? $t("正在保存…") : $t("校验并发布流程") }}</button></div></template>
      </WorkflowGraph>
      <p class="field-hint">{{ $t("修改先保留为草稿；发布不会改变已有事项绑定的流程。") }}</p>
    </template>
    <ModalDialog v-if="replacing && data?.recommendedDefinition" open wide :title="$t('流程模板')" @close="replacing = false">
      <div class="workflow-template-summary"><h3>{{ $t('开发与线下处理') }}</h3><p>{{ $t('从待开发提交已有成果，送验、退回与再次提交沿用同一流程。') }}</p></div>
      <WorkflowGraph :definition="data.recommendedDefinition" />
      <div class="workflow-template-scope"><h3>{{ $t('替换范围') }}</h3><p>{{ $t('将替换当前未保存的流程草稿。保存或发布之前，已发布版本和现有事项保持原样。') }}</p><p class="field-hint">{{ $t('修改先保留为草稿；发布不会改变已有事项绑定的流程。') }}</p></div>
      <template #footer><button @click="replacing = false">{{ $t('取消') }}</button><button class="primary" @click="loadRecommended">{{ $t('确认载入草稿') }}</button></template>
    </ModalDialog>
    <ModalDialog v-if="previewing" open :title="$t('交接预览')" @close="previewing = false">
      <div class="project-form workflow-handoff-preview">
        <p class="field-hint">{{ $t('根据当前草稿预览交接规则。') }}</p>
        <label>{{ $t('来源状态') }}<AppSelect v-model="simulationNode" :aria-label="$t('来源状态')"><option v-for="item in definition.nodes" :key="item.id" :value="item.id">{{ item.name }}</option></AppSelect></label>
        <label>{{ $t('触发事件') }}<AppSelect v-model="simulationEvent" :aria-label="$t('触发事件')"><option v-for="(event, id) in workflowEvents" :key="id" :value="id">{{ $t(event.label) }}</option></AppSelect></label>
        <p v-if="!simulation.length" class="muted">{{ $t('此事件没有配置流转。') }}</p>
        <section v-for="item in simulation" :key="item.id" class="workflow-handoff-result"><h3>{{ item.name }}</h3><p>{{ definition.nodes.find(node => node.id === item.from)?.name }} → {{ definition.nodes.find(node => node.id === item.to)?.name }}</p>
          <dl><dt>{{ $t('操作主体') }}</dt><dd>{{ $t(actorLabels[item.actor]) }}</dd><dt>{{ $t('下一处理人规则') }}</dt><dd>{{ $t(assignmentLabels[item.assignment]) }}</dd></dl>
          <ul v-if="item.requiresReason || item.requiredFields?.length || item.requireDelivery || item.requireAcceptedDelivery"><li v-if="item.requiresReason">{{ $t('必须填写原因') }}</li><li v-for="field in item.requiredFields" :key="field">{{ $t(fieldLabels[field] || field) }}</li><li v-if="item.requireDelivery">{{ $t('必须有有效交付') }}</li><li v-if="item.requireAcceptedDelivery">{{ $t('必须已有通过验收的交付') }}</li></ul>
        </section>
        <p class="field-hint">{{ $t('仅预览规则，不执行开发或修改事项；实际提交仍校验资料和人员权限。') }}</p>
      </div><template #footer><button @click="previewing = false">{{ $t('关闭') }}</button></template>
    </ModalDialog>
  </section>
</template>

<style scoped>
.workflow-settings { min-width: 0; }
.workflow-settings > header { flex-wrap: wrap; gap: 16px; }
.workflow-tools { margin-left: auto; }
.workflow-template-summary, .workflow-template-scope { padding: 8px 0 20px; }
.workflow-template-summary h3, .workflow-template-scope h3, .workflow-handoff-result h3 { font-size: 16px; margin: 0 0 12px; }
.workflow-template-scope { margin-top: 20px; padding-bottom: 0; }
.workflow-handoff-result { border-top: 1px solid var(--line); padding-top: 20px; overflow-wrap: anywhere; }
.workflow-handoff-result dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px 20px; font-size: 13px; }
.workflow-handoff-result dt { color: var(--muted); }
.workflow-handoff-result dd { margin: 0; }
@media (max-width: 767px) { .workflow-tools { margin-left: 0; width: 100%; } }
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
