<script setup>
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import FormSection from "../../shared/components/FormSection.vue";
import PromptTemplateEditor from "../../shared/components/PromptTemplateEditor.vue";
import EditConflict from "./EditConflict.vue";
import { sameValue } from "./project-records.js";
const props = defineProps({ projectId: { type: String, required: true } });
const emit = defineEmits(["saved"]);
const endpoint = () => `/projects/${props.projectId}/prompts`;
const { data, loading, saving, error, notice, reload, save, perform } = useResource(() => appApi(endpoint()));
const scope = ref("personal"), type = ref("bug"), latest = ref(null);
const drafts = reactive({ project: {}, personal: {} }), baselines = reactive({ project: {}, personal: {} }), revisions = reactive({});
const values = (result, target) => target === "project" ? { ...result.projectTemplates } : Object.fromEntries(Object.keys(result.catalog).map(name => [name, result.overrides[name] ?? null]));
function accept(result, target) {
  drafts[target] = values(result, target); baselines[target] = { ...drafts[target] };
  revisions[target] = result[target === "project" ? "projectRevision" : "personalRevision"];
}
watch(data, result => {
  if (!result || revisions.project) return;
  accept(result, "project"); accept(result, "personal");
  if (!result.canPersonalize) scope.value = "project";
});
const editable = computed(() => scope.value === "project" ? data.value?.canConfigure : data.value?.canPersonalize);
const busy = computed(() => loading.value || saving.value);
const inherited = computed(() => scope.value === "personal" && drafts.personal[type.value] === null);
const template = computed({ get: () => drafts[scope.value][type.value] ?? data.value.projectTemplates[type.value], set: value => { drafts[scope.value][type.value] = value; } });
const dirty = computed(() => !sameValue(drafts[scope.value], baselines[scope.value]));
function customize(event) { drafts.personal[type.value] = event.target.checked ? data.value.projectTemplates[type.value] : null; }
function reset() { drafts[scope.value][type.value] = scope.value === "personal" ? null : data.value.catalog[type.value].defaultTemplate; }
function submit() {
  const target = scope.value;
  return save(endpoint(), { scope: target, revision: revisions[target], templates: { ...drafts[target] } }, result => {
    data.value = result; accept(result, target); latest.value = null; emit("saved");
  }, target === "personal" ? "个人提示词已保存，仅对你在此项目的新任务和新追加资料生效。" : "项目提示词已保存，对未使用个人覆盖的成员生效。");
}
function loadLatest() { return perform(() => appApi(endpoint()), result => { latest.value = { ...values(result, scope.value), revision: result[scope.value === "project" ? "projectRevision" : "personalRevision"], result }; }, ""); }
const latestFields = computed(() => latest.value && { ...values(latest.value.result, scope.value), revision: latest.value.revision });
function resolve(merged) {
  const target = scope.value, result = latest.value.result;
  data.value = result; accept(result, target);
  drafts[target] = Object.fromEntries(Object.keys(result.catalog).map(name => [name, merged[name]]));
  latest.value = null; error.value = "";
}
</script>
<template>
  <FormSection title="提示词模板" description="按事项类型生成开发指令。混合任务逐条使用对应模板，已保存的任务资料不受后续修改影响。">
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <p v-if="loading" role="status">正在加载提示词模板…</p>
    <button v-if="!data && !loading" @click="reload">重新加载提示词模板</button>
    <template v-if="data">
      <div class="page-tabs" role="group" aria-label="提示词作用域"><button :disabled="busy || Boolean(latest)" :class="{ active: scope === 'project' }" :aria-pressed="scope === 'project'" @click="scope = 'project'">项目默认</button><button v-if="data.personalRevision" :disabled="busy || Boolean(latest)" :class="{ active: scope === 'personal' }" :aria-pressed="scope === 'personal'" @click="scope = 'personal'">我的配置</button></div>
      <p class="field-hint">{{ scope === 'personal' ? '仅用于你在此项目执行的任务，不影响其他成员。未自定义的类型始终跟随项目默认。' : '项目新建时已提供 Bug 和需求默认模板。修改后供未自定义该类型的成员使用。' }}</p>
      <p v-if="!editable" class="field-hint">当前配置只读。</p>
      <div class="page-tabs" role="group" aria-label="提示词类型"><button v-for="(definition, name) in data.catalog" :key="name" :class="{ active: type === name }" :aria-pressed="type === name" @click="type = name">{{ definition.label }}提示词{{ drafts[scope][name] !== baselines[scope][name] ? ' · 未保存' : '' }}</button></div>
      <EditConflict v-if="latest" :key="`${scope}-${latest.revision}`" :base="baselines[scope]" :draft="drafts[scope]" :latest="latestFields" @resolve="resolve" @discard="resolve(latestFields)" />
      <form class="project-form" @submit.prevent="submit">
        <label v-if="scope === 'personal'" class="prompt-override"><input type="checkbox" :checked="!inherited" :disabled="busy || !editable" @change="customize" />自定义此提示词，仅对我生效</label>
        <p v-if="inherited" class="field-hint">当前跟随项目默认；勾选后可独立编辑。</p>
        <PromptTemplateEditor v-model="template" :definition="data.catalog[type]" :max-length="data.maxLength" :disabled="busy || !editable || inherited" />
        <div class="actions prompt-actions"><button type="button" :disabled="busy || !editable" @click="reset">{{ scope === 'personal' ? '恢复跟随项目' : '恢复内置默认' }}</button><button type="button" :disabled="busy" @click="loadLatest">保留草稿，加载最新配置</button><button type="submit" class="primary" :disabled="busy || !editable || !dirty || Boolean(latest)">{{ scope === 'personal' ? '保存我的提示词' : '保存项目提示词' }}</button></div>
      </form>
    </template>
  </FormSection>
</template>
<style scoped>
.project-form .prompt-override { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.prompt-override input { width: auto; }
.prompt-actions { flex-wrap: wrap; }
@media (max-width: 480px) { .prompt-actions button { width: 100%; } }
</style>
