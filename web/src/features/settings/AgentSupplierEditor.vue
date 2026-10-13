<script setup>
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from "vue";
import { CloseOutlined, PlusOutlined, DeleteOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { supplierPayload } from "./use-agent-suppliers.js";

const props = defineProps({ draft: { type: Object, required: true } });
const emit = defineEmits(["close", "saved"]);
const form = ref(JSON.parse(JSON.stringify(props.draft)));
const dialog = ref(), saving = ref(false), fetching = ref(false), checking = ref(false);
const error = ref(""), result = ref(""), fetched = ref([]), selected = ref([]), checkModel = ref("");
let disposed = false, generation = 0;
const busy = computed(() => saving.value || fetching.value || checking.value);
watch(form, () => { generation++; result.value = ""; fetched.value = []; selected.value = []; }, { deep: true, flush: "sync" });
watch(checkModel, () => { generation++; result.value = ""; });
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
onUnmounted(() => { disposed = true; generation++; });
function close() { if (!saving.value) { dialog.value.close(); emit("close"); } }
function add(model = "") { form.value.models.push({ model, label: model, reasoningEfforts: [], defaultReasoningEffort: "" }); }
function addFetched() {
  const ids = [...selected.value];
  for (const id of ids) if (!form.value.models.some(entry => entry.model === id)) add(id);
  if (!form.value.defaultModel) form.value.defaultModel = form.value.models[0]?.model || "";
}
function efforts(entry, value) { entry.reasoningEfforts = [...new Set(value.split(/[,，\s]+/).filter(Boolean))]; }
async function request(kind) {
  if (busy.value) return;
  const expected = generation, state = kind === "models" ? fetching : checking;
  state.value = true; error.value = ""; result.value = "";
  try {
    const { id, revision, baseUrl, apiKey } = form.value;
    const response = await appApi(`/system/agent-suppliers/${kind}`, {
      agentType: "codex", baseUrl, ...(id ? { id, revision } : {}), ...(apiKey ? { apiKey } : {}),
      ...(kind === "check" ? { model: checkModel.value || form.value.defaultModel } : {}),
    });
    if (disposed || expected !== generation) return;
    if (kind === "models") { fetched.value = response.models.map(entry => entry.model); selected.value = []; result.value = `获取到 ${response.models.length} 个模型，请勾选后添加。`; }
    else result.value = `生成检测成功，耗时 ${response.elapsedMs} ms。`;
  } catch (e) { if (!disposed && expected === generation) error.value = e.message; }
  finally { if (!disposed) state.value = false; }
}
async function save() {
  if (busy.value) return;
  saving.value = true; error.value = "";
  try {
    await appApi(`/system/agent-suppliers${form.value.id ? `/${form.value.id}` : ""}`, supplierPayload(form.value));
    if (!disposed) { dialog.value.close(); emit("saved"); }
  } catch (e) { if (!disposed) error.value = e.message; }
  finally { if (!disposed) saving.value = false; }
}
</script>
<template>
  <dialog ref="dialog" class="supplier-dialog" aria-labelledby="supplier-editor-title" @cancel.prevent="close">
    <header class="supplier-dialog-heading"><div><div class="eyebrow">CODEX · API KEY</div><h2 id="supplier-editor-title">{{ form.id ? '编辑供应商' : '新增供应商' }}</h2></div><button type="button" aria-label="关闭供应商编辑" :disabled="saving" @click="close"><CloseOutlined aria-hidden="true" /></button></header>
    <form @submit.prevent="save">
      <fieldset :disabled="saving" class="supplier-fields">
        <h3>基础信息</h3>
        <label>供应商名称<input v-model="form.name" required maxlength="80" autocomplete="off" /></label>
        <label>备注<input v-model="form.notes" maxlength="1000" /></label>
        <label class="supplier-checkbox"><input v-model="form.enabled" type="checkbox" /> 启用供应商</label>
        <h3>连接信息</h3>
        <label>API 基础地址<input v-model="form.baseUrl" type="url" required placeholder="https://api.example.com/v1" /></label>
        <p class="field-hint">填写支持 Responses 的基础地址。请求直接由 Codex 发往该地址。</p>
        <label>API Key<input v-model="form.apiKey" type="password" :required="!form.id" autocomplete="new-password" :placeholder="form.id ? '留空保留已保存的 Key' : '填写 API Key'" /></label>
        <p class="field-hint">密钥加密保存，编辑时不回显；复制供应商需重新填写。</p>
        <div class="supplier-toolbar"><h3>模型配置</h3><div class="actions"><button type="button" :disabled="busy" @click="request('models')">{{ fetching ? '获取中…' : '获取模型' }}</button><button type="button" @click="add()"><PlusOutlined aria-hidden="true" /> 手动添加</button></div></div>
        <p class="field-hint">思考强度按供应商实际支持填写，以逗号分隔，例如 low, medium, high。默认强度留空时使用 Codex 模型默认值；无法识别的自定义模型需填写默认强度。</p>
        <div v-if="fetched.length" class="supplier-fetched"><label v-for="id in fetched" :key="id" class="supplier-checkbox"><input v-model="selected" type="checkbox" :value="id" />{{ id }}</label><button type="button" :disabled="!selected.length" @click="addFetched">添加所选模型</button></div>
        <p v-if="!form.models.length" class="muted">尚未添加模型，可手动填写或从接口获取。</p>
        <section v-for="(entry, index) in form.models" :key="index" class="supplier-model">
          <div class="supplier-toolbar"><strong>模型 {{ index + 1 }}</strong><button type="button" :aria-label="`删除模型 ${index + 1}`" @click="form.models.splice(index, 1)"><DeleteOutlined aria-hidden="true" /></button></div>
          <div class="supplier-field-grid"><label>模型 ID<input v-model="entry.model" required maxlength="100" /></label><label>显示名称<input v-model="entry.label" maxlength="200" placeholder="默认使用模型 ID" /></label>
          <label>支持的思考强度<input :value="entry.reasoningEfforts.join(', ')" @change="efforts(entry, $event.target.value)" /></label><label>默认思考强度<select v-model="entry.defaultReasoningEffort" aria-label="默认思考强度"><option value="">默认</option><option v-for="effort in entry.reasoningEfforts" :key="effort" :value="effort">{{ effort }}</option></select></label></div>
        </section>
        <label>默认模型<select v-model="form.defaultModel" aria-label="默认模型" required><option value="" disabled>请选择默认模型</option><option v-for="entry in form.models.filter(item => item.model)" :key="entry.model" :value="entry.model">{{ entry.label || entry.model }}</option></select></label>
        <h3>连通检测</h3>
        <label>检测模型<select v-model="checkModel" aria-label="检测模型"><option value="">使用默认模型</option><option v-for="entry in form.models.filter(item => item.model)" :key="entry.model" :value="entry.model">{{ entry.label || entry.model }}</option></select></label>
        <p class="field-hint">检测将发送最小生成请求，可能产生少量费用。获取模型与保存不会发起生成。</p>
        <button type="button" :disabled="busy || !(checkModel || form.defaultModel)" @click="request('check')">{{ checking ? '检测中…' : '发送检测请求' }}</button>
        <p v-if="result" class="supplier-result" role="status">{{ result }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </fieldset>
      <footer class="actions supplier-dialog-footer"><button type="button" :disabled="saving" @click="close">取消</button><button type="submit" class="primary" :disabled="busy">{{ saving ? '保存中…' : '保存供应商' }}</button></footer>
    </form>
  </dialog>
</template>
