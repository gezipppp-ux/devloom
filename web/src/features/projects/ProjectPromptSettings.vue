<script setup>
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
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
  <section class="project-prompt-settings" aria-labelledby="project-prompts-title">
    <header class="project-heading"><div><h2 id="project-prompts-title">{{ $t("提示词模板") }}</h2><p class="field-hint">{{ $t("Bug 和需求按事项类型生成开发指令；任务补充提示词使用补充模板。已保存的执行快照不受后续修改影响。") }}</p></div></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <p v-if="loading" role="status">{{ $t("正在加载提示词模板…") }}</p>
    <button v-if="!data && !loading" @click="reload">{{ $t("重新加载提示词模板") }}</button>
    <template v-if="data">
      <div class="prompt-scope-bar">
        <div class="ui-segmented" role="group" :aria-label="$t('提示词作用域')"><button :disabled="busy || Boolean(latest)" :aria-pressed="scope === 'project'" @click="scope = 'project'">{{ $t("项目默认") }}</button><button v-if="data.personalRevision" :disabled="busy || Boolean(latest)" :aria-pressed="scope === 'personal'" @click="scope = 'personal'">{{ $t("我的配置") }}</button></div>
        <p class="field-hint">{{ scope === 'personal' ? $t("仅用于你在此项目执行的任务，不影响其他成员。未自定义的类型始终跟随项目默认。") : $t("项目提供 Bug、需求和补充默认模板。修改后供未自定义该类型的成员使用。") }}</p>
      </div>
      <div class="project-prompt-layout">
        <aside class="prompt-type-nav" role="group" :aria-label="$t('提示词类型')">
          <p class="prompt-nav-label">{{ $t("模板类型") }}</p>
          <button v-for="(definition, name) in data.catalog" :key="name" :aria-pressed="type === name" @click="type = name"><span>{{ $t(definition.label) }}{{ $t("提示词") }}</span><small v-if="drafts[scope][name] !== baselines[scope][name]">{{ $t("未保存") }}</small></button>
        </aside>
        <div class="prompt-config-panel">
          <p v-if="!editable" class="field-hint">{{ $t("当前配置只读。") }}</p>
          <EditConflict v-if="latest" :key="`${scope}-${latest.revision}`" :base="baselines[scope]" :draft="drafts[scope]" :latest="latestFields" @resolve="resolve" @discard="resolve(latestFields)" />
          <form class="project-form" @submit.prevent="submit">
            <div v-if="scope === 'personal'" class="prompt-scope-note"><label class="prompt-override"><input type="checkbox" :checked="!inherited" :disabled="busy || !editable" @change="customize" />{{ $t("自定义此提示词，仅对我生效") }}</label><p v-if="inherited" class="field-hint">{{ $t("当前跟随项目默认；勾选后可独立编辑。") }}</p></div>
            <PromptTemplateEditor v-model="template" :definition="data.catalog[type]" :max-length="data.maxLength" :disabled="busy || !editable || inherited" />
            <div class="prompt-actions"><div class="actions"><button type="button" :disabled="busy || !editable" @click="reset">{{ scope === 'personal' ? $t("恢复跟随项目") : $t("恢复内置默认") }}</button><button type="button" class="release-quiet-button" :disabled="busy" @click="loadLatest">{{ $t("保留草稿，加载最新配置") }}</button></div><button type="submit" class="primary" :disabled="busy || !editable || !dirty || Boolean(latest)">{{ scope === 'personal' ? $t("保存我的提示词") : $t("保存项目提示词") }}</button></div>
          </form>
        </div>
      </div>
    </template>
  </section>
</template>
<style scoped>
.project-prompt-settings { max-width: 1120px; min-width: 0; }
.project-heading p { max-width: 840px; margin-bottom: 0; line-height: 1.8; }
.prompt-scope-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 16px 24px; margin-bottom: 24px; }
.prompt-scope-bar .field-hint { flex: 1 1 360px; margin: 0; line-height: 1.8; }
.project-prompt-layout { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 28px; align-items: start; }
.prompt-type-nav { display: grid; gap: 6px; min-width: 0; }
.prompt-nav-label { margin: 4px 12px 8px; color: var(--muted); font-size: 12px; }
.prompt-type-nav button { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; text-align: left; padding: 12px; border: 0; background: transparent; color: var(--muted); white-space: normal; }
.prompt-type-nav button[aria-pressed=true] { background: var(--selected); color: var(--highlight); }
.prompt-type-nav small { font-size: 12px; }
.prompt-config-panel { min-width: 0; padding: 28px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); }
.project-form { gap: 20px; }
.prompt-scope-note { padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.prompt-scope-note p { margin: 8px 0 0 24px; }
.project-form .prompt-override { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.prompt-override input { width: auto; }
.prompt-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding-top: 20px; border-top: 1px solid var(--line); }
.prompt-actions .actions { margin: 0; }
@media (max-width: 1199px) { .project-prompt-layout { grid-template-columns: minmax(0, 1fr); gap: 16px; } .prompt-type-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; } .prompt-nav-label { width: 100%; margin: 0 0 4px; } }
@media (max-width: 767px) { .prompt-config-panel { padding: 20px 16px; } .prompt-type-nav button { min-height: 44px; } .prompt-actions, .prompt-actions .actions { align-items: stretch; } .prompt-actions > button, .prompt-actions .actions { width: 100%; } .prompt-actions .actions button { flex: 1 1 180px; white-space: normal; } }
</style>
