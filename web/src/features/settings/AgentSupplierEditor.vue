<script setup>
import { computed, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { CloseOutlined, PlusOutlined, DeleteOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { supplierPayload } from "./use-agent-suppliers.js";
import { useSupplierModelCatalog } from "./use-supplier-model-catalog.js";

const props = defineProps({ draft: { type: Object, required: true } });
const emit = defineEmits(["close", "saved"]);
const form = ref(JSON.parse(JSON.stringify(props.draft)));
const catalog = useSupplierModelCatalog(form);
const effortDrafts = reactive(new WeakMap());
const dialog = ref(), saving = ref(false), fetching = ref(false), checking = ref(false);
const error = ref(""), result = ref(""), fetched = ref([]), selected = ref([]), checkModel = ref("");
const modelSearch = ref("");
const modelOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const modelInitial = model => /^[a-z]/i.test(model) ? model[0].toUpperCase() : "#";
const sortedModels = computed(() => [...fetched.value].sort((left, right) => {
  const a = modelInitial(left.model), b = modelInitial(right.model);
  if (a !== b) return a === "#" ? 1 : b === "#" ? -1 : modelOrder.compare(a, b);
  return modelOrder.compare(left.model, right.model) || left.model.localeCompare(right.model, "en");
}));
const matchingModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase();
  return sortedModels.value.filter(entry => !query || [entry.model, entry.label].some(value => value?.toLowerCase().includes(query)));
});
const modelGroups = computed(() => {
  const groups = new Map();
  for (const entry of matchingModels.value) {
    const initial = modelInitial(entry.model);
    if (!groups.has(initial)) groups.set(initial, { initial, models: [] });
    groups.get(initial).models.push(entry);
  }
  return [...groups.values()];
});
let disposed = false, generation = 0;
const busy = computed(() => saving.value || fetching.value || checking.value);
watch(form, () => { generation++; result.value = ""; }, { deep: true, flush: "sync" });
watch(connection, () => { fetched.value = []; selected.value = []; modelSearch.value = ""; }, { flush: "sync" });
watch(checkModel, () => { generation++; result.value = ""; });
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
onUnmounted(() => { disposed = true; generation++; });
function close() { if (!saving.value) { dialog.value.close(); emit("close"); } }
function add(model = "", label = model) { form.value.models.push({ model, label, reasoningEfforts: [], defaultReasoningEffort: "" }); }
function addFetched() {
  const entries = sortedModels.value.filter(entry => selected.value.includes(entry.model));
  for (const entry of entries) if (!form.value.models.some(model => model.model === entry.model)) add(entry.model, entry.label);
  if (!form.value.defaultModel) form.value.defaultModel = form.value.models[0]?.model || "";
}
function efforts(entry, value) {
  effortDrafts.set(entry, value); catalog.custom(entry);
  entry.reasoningEfforts = [...new Set(value.split(/[,，\s]+/).filter(Boolean))];
  if (!entry.reasoningEfforts.includes(entry.defaultReasoningEffort)) entry.defaultReasoningEffort = "";
}
function toggleEfforts(entry) {
  effortDrafts.delete(entry);
  if (entry.reasoningSource === "codex") catalog.custom(entry);
  else catalog.restore(entry);
}
function connection() { const { agentType, id, revision, baseUrl, apiKey } = form.value; return JSON.stringify({ agentType, id, revision, baseUrl, apiKey }); }
async function request(kind) {
  if (busy.value) return;
  const expected = generation, originalConnection = connection(), state = kind === "models" ? fetching : checking;
  state.value = true; error.value = ""; result.value = "";
  try {
    const { id, revision, baseUrl, apiKey } = form.value;
    const response = await appApi(`/system/agent-suppliers/${kind}`, {
      agentType: "codex", baseUrl, ...(id ? { id, revision } : {}), ...(apiKey ? { apiKey } : {}),
      ...(kind === "check" ? { model: checkModel.value || form.value.defaultModel } : {}),
    });
    if (disposed || originalConnection !== connection() || (kind !== "models" && expected !== generation)) return;
    if (kind === "models") { fetched.value = response.models; selected.value = []; result.value = `获取到 ${response.models.length} 个模型，请勾选后添加。`; }
    else result.value = `生成检测成功，耗时 ${response.elapsedMs} ms。`;
  } catch (e) { if (!disposed && originalConnection === connection() && (kind === "models" || expected === generation)) error.value = e.message; }
  finally { if (!disposed) state.value = false; }
}
async function save() {
  if (busy.value || catalog.loading.value) return;
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
    <header class="supplier-dialog-heading"><div><div class="eyebrow">CODEX · API KEY</div><h2 id="supplier-editor-title">{{ form.id ? $t("编辑供应商") : $t("新增供应商") }}</h2></div><button type="button" :aria-label="$t(&quot;关闭供应商编辑&quot;)" :disabled="saving" @click="close"><CloseOutlined aria-hidden="true" /></button></header>
    <form @submit.prevent="save">
      <fieldset :disabled="saving" class="supplier-fields">
        <h3>{{ $t("基础信息") }}</h3>
        <label>{{ $t("供应商名称") }}<input v-model="form.name" required maxlength="80" autocomplete="off" /></label>
        <label>{{ $t("备注") }}<input v-model="form.notes" maxlength="1000" /></label>
        <label class="supplier-checkbox"><input v-model="form.enabled" type="checkbox" /> {{ $t("启用供应商") }}</label>
        <h3>{{ $t("连接信息") }}</h3>
        <label>{{ $t("API 基础地址") }}<input v-model="form.baseUrl" type="url" required placeholder="https://api.example.com/v1" /></label>
        <p class="field-hint">{{ $t("填写支持 Responses 的基础地址。请求直接由 Codex 发往该地址。") }}</p>
        <label>API Key<input v-model="form.apiKey" type="password" :required="!form.id" autocomplete="new-password" :placeholder="form.id ? $t(&quot;留空保留已保存的 Key&quot;) : $t(&quot;填写 API Key&quot;)" /></label>
        <p class="field-hint">{{ $t("密钥加密保存，编辑时不回显；复制供应商需重新填写。") }}</p>
        <div class="supplier-toolbar"><h3>{{ $t("模型配置") }}</h3><div class="actions"><button type="button" :disabled="busy" @click="request('models')">{{ fetching ? $t("获取中…") : $t("获取模型") }}</button><button type="button" @click="add()"><PlusOutlined aria-hidden="true" /> {{ $t("手动添加") }}</button></div></div>
        <p class="field-hint">{{ $t("匹配 Codex 内置目录的模型自动加载思考强度和默认值，也可自定义。内置标记表示模型 ID 匹配，具体能力以上游实际支持为准。") }}</p>
        <p v-if="catalog.loading.value" class="muted" role="status">{{ $t("正在读取 Codex 内置模型目录…") }}</p>
        <div v-if="catalog.error.value" class="supplier-catalog-error" role="alert"><span>{{ catalog.error.value }} {{ $t("获取上游模型和手动配置仍可使用。") }}</span><button type="button" :disabled="catalog.loading.value" @click="catalog.refresh">{{ $t("重试读取内置目录") }}</button></div>
        <section v-if="fetched.length" class="supplier-fetched" :aria-label="$t(&quot;模型候选列表&quot;)">
          <div class="supplier-model-search"><label>{{ $t("搜索模型") }}<input v-model="modelSearch" type="search" :placeholder="$t(&quot;模型 ID 或显示名称&quot;)" @keydown.enter.prevent /></label><button type="button" :disabled="!modelSearch" @click="modelSearch = ''">{{ $t("清空搜索") }}</button></div>
          <div class="supplier-toolbar supplier-model-summary"><span role="status">{{ matchingModels.length }} / {{ fetched.length }} {{ $t("个模型 · A–Z") }}</span><span>{{ $t("已选") }} {{ selected.length }} {{ $t("个") }}</span></div>
          <div class="supplier-model-results" tabindex="0" role="region" :aria-label="$t(&quot;按首字母分组的模型&quot;)">
            <section v-for="group in modelGroups" :key="group.initial" class="supplier-model-group" :aria-label="group.initial === '#' ? $t(&quot;其他模型&quot;) : $t(&quot;{p0} 开头的模型&quot;, { p0: group.initial })">
              <h4 class="supplier-group-heading"><span>{{ group.initial === '#' ? $t("其他") : group.initial }}</span><span>{{ group.models.length }}</span></h4>
              <label v-for="entry in group.models" :key="entry.model" class="supplier-checkbox"><input v-model="selected" type="checkbox" :value="entry.model" :aria-label="entry.model" /><span class="supplier-model-info"><span class="supplier-model-id">{{ entry.model }}</span><span v-if="entry.label && entry.label !== entry.model" class="supplier-model-label">{{ $t(entry.label) }}</span></span><span class="supplier-tag" :class="{ 'supplier-disabled': !catalog.match(entry.model) }">{{ $t(catalog.status(entry.model)) }}</span></label>
            </section>
            <p v-if="!matchingModels.length" class="supplier-model-empty" role="status">{{ $t("没有匹配的模型，请调整搜索条件。") }}</p>
          </div>
          <div class="supplier-picker-footer"><span class="field-hint">{{ $t("搜索只筛选显示，已勾选项会保留。") }}</span><button type="button" :disabled="!selected.length" @click="addFetched">{{ $t("添加所选模型") }}</button></div>
        </section>
        <p v-if="!form.models.length" class="muted">{{ $t("尚未添加模型，可手动填写或从接口获取。") }}</p>
        <section v-for="(entry, index) in form.models" :key="index" class="supplier-model">
          <div class="supplier-toolbar"><div class="supplier-model-heading"><strong>{{ $t("模型") }} {{ index + 1 }}</strong><span v-if="entry.model" class="supplier-tag" :class="{ 'supplier-disabled': !catalog.match(entry.model) }">{{ $t(catalog.status(entry.model)) }}</span></div><button type="button" :aria-label="$t(&quot;删除模型 {p0}&quot;, { p0: index + 1 })" @click="form.models.splice(index, 1)"><DeleteOutlined aria-hidden="true" /></button></div>
          <div class="supplier-field-grid"><label>{{ $t("模型 ID") }}<input v-model="entry.model" required maxlength="100" /></label><label>{{ $t("显示名称") }}<input v-model="entry.label" maxlength="200" :placeholder="$t(&quot;默认使用模型 ID&quot;)" /></label>
          <div class="supplier-effort-field"><div class="supplier-toolbar"><span>{{ $t("支持的思考强度") }}</span><button v-if="catalog.match(entry.model) || entry.reasoningSource === 'codex'" type="button" class="supplier-model-action" @click="toggleEfforts(entry)">{{ entry.reasoningSource === 'codex' ? $t("自定义") : $t("使用内置配置") }}</button></div>
            <div v-if="entry.reasoningSource === 'codex'" class="supplier-effort-chips" :aria-label="$t(&quot;支持的思考强度&quot;)"><span v-for="effort in entry.reasoningEfforts" :key="effort">{{ effort }}</span><span v-if="!entry.reasoningEfforts.length" class="muted">{{ $t("目录未提供可选强度") }}</span></div>
            <input v-else :aria-label="$t(&quot;支持的思考强度&quot;)" :value="effortDrafts.get(entry) ?? entry.reasoningEfforts.join(', ')" :placeholder="$t(&quot;例如 low, medium, high&quot;)" @input="efforts(entry, $event.target.value)" />
            <p class="field-hint">{{ entry.reasoningSource === 'codex' ? (catalog.match(entry.model) ? $t("已加载 Codex 内置配置；保存后生效。") : $t("保留已保存的内置配置，也可切换为自定义。")) : $t("自定义配置；按上游支持范围填写，已有设置不会被自动覆盖。") }}</p>
          </div><label>{{ $t("默认思考强度") }}<select v-model="entry.defaultReasoningEffort" :aria-label="$t(&quot;默认思考强度&quot;)" @change="catalog.custom(entry)"><option value="">{{ $t("默认") }}</option><option v-for="effort in entry.reasoningEfforts" :key="effort" :value="effort">{{ effort }}{{ effort === catalog.match(entry.model)?.defaultReasoningEffort ? $t(" · Codex 默认") : '' }}</option></select></label></div>
        </section>
        <label>{{ $t("默认模型") }}<select v-model="form.defaultModel" :aria-label="$t(&quot;默认模型&quot;)" required><option value="" disabled>{{ $t("请选择默认模型") }}</option><option v-for="entry in form.models.filter(item => item.model)" :key="entry.model" :value="entry.model">{{ entry.label || entry.model }}</option></select></label>
        <h3>{{ $t("连通检测") }}</h3>
        <label>{{ $t("检测模型") }}<select v-model="checkModel" :aria-label="$t(&quot;检测模型&quot;)"><option value="">{{ $t("使用默认模型") }}</option><option v-for="entry in form.models.filter(item => item.model)" :key="entry.model" :value="entry.model">{{ entry.label || entry.model }}</option></select></label>
        <p class="field-hint">{{ $t("检测将发送最小生成请求，可能产生少量费用。获取模型与保存不会发起生成。") }}</p>
        <button type="button" :disabled="busy || !(checkModel || form.defaultModel)" @click="request('check')">{{ checking ? $t("检测中…") : $t("发送检测请求") }}</button>
        <p v-if="result" class="supplier-result" role="status">{{ result }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </fieldset>
      <footer class="actions supplier-dialog-footer"><button type="button" :disabled="saving" @click="close">{{ $t("取消") }}</button><button type="submit" class="primary" :disabled="busy || catalog.loading.value">{{ saving ? $t("保存中…") : $t("保存供应商") }}</button></footer>
    </form>
  </dialog>
</template>
