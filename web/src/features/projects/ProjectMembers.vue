<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref, useId, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import ProjectPermissionEditor from "../../shared/components/ProjectPermissionEditor.vue";
import PersonAvatar from "../../shared/components/PersonAvatar.vue";
import { PlusOutlined } from "@antdv-next/icons";
import permissionCatalog from "../../../../shared/project-permissions.json";
import { translate } from "../../shared/i18n/index.js";
const emit = defineEmits(["saved"]);
const editorFormId = useId();
const props = defineProps({ projectId: { type: String, required: true }, canManage: Boolean, headerAction: Boolean });
const endpoint = `/projects/${props.projectId}/members`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint));
const selected = ref(null), form = reactive({ userId: "", permissions: [], status: "active" }), editorOpen = ref(false), editorTrigger = ref(null);
const candidate = computed(() => data.value?.candidates?.find(user => user.id === form.userId));
const administratorAccess = computed(() => Boolean(selected.value?.administratorAccess ?? candidate.value?.administratorAccess));
const ceiling = computed(() => selected.value?.grantablePermissions || candidate.value?.grantablePermissions || []);
const candidates = computed(() => (data.value?.candidates || []).filter(user => !(data.value?.members || []).some(member => member.userId === user.id)));
const canSave = computed(() => form.userId && (form.status === "disabled" || administratorAccess.value || (ceiling.value.includes("project.view") && form.permissions.includes("project.view"))));
function authorization(member) {
  if (member.administratorAccess) return translate("全部权限");
  const effective = member.effectivePermissions || [];
  const groups = new Set(permissionCatalog.filter(item => effective.includes(item.id)).map(item => item.group));
  const labels = { "项目": effective.some(id => ['project.configure', 'project.members.manage', 'project.archive'].includes(id)) ? '项目管理' : '查看项目', "需求与 Bug": '事项', "发布版本": '版本', "协作": '讨论与交付', "代码": '代码', "Agent": effective.includes('session.start') ? 'Agent 开发' : 'Agent 会话', "资产": '普通资产' };
  const categories = [...groups].map(group => ['代码', 'Agent'].includes(group) ? '开发' : group === '发布版本' ? '事项' : group === '协作' ? '交付' : group === '资产' ? '资产' : labels[group]);
  const result = [...new Set(categories)].map(label => translate(label));
  return result.join('、') || translate('暂无有效授权');
}
function chooseUser() { form.permissions = !administratorAccess.value && ceiling.value.includes("project.view") ? ["project.view"] : []; }
function restore(row, event) { edit(row, event); form.status = "active"; if (!administratorAccess.value && ceiling.value.includes("project.view") && !form.permissions.includes("project.view")) form.permissions.push("project.view"); }
function edit(row, event) { if (!props.canManage || saving.value) return; editorTrigger.value = event?.currentTarget || null; editorOpen.value = true; selected.value = row; Object.assign(form, { userId: row?.userId || "", permissions: [...(row?.permissions || [])], status: row?.status || "active" }); }
function submit() {
  const value = { permissions: form.permissions, status: form.status };
  if (selected.value) value.revision = selected.value.revision; else value.userId = form.userId;
  return save(`${endpoint}${selected.value ? `/${selected.value.userId}` : ""}`, value, () => { editorOpen.value = false; selected.value = null; emit("saved"); void reload(); });
}
function closeEditor() { if (saving.value) return; editorOpen.value = false; selected.value = null; }
watch(() => props.canManage, allowed => { if (!allowed) { editorOpen.value = false; selected.value = null; } });
const creationDisabled = computed(() => loading.value || saving.value || editorOpen.value);
defineExpose({ create: event => edit(null, event), creationDisabled });
</script>
<template>
  <section class="project-members" :aria-label="$t('项目成员')">
    <header v-if="!headerAction" class="project-heading"><div><h2 id="project-members-title">{{ $t('项目成员') }}</h2><p class="field-hint">{{ $t('围绕工作授权，让每位参与者都能顺畅协作。') }}</p></div><button v-if="canManage && !headerAction" class="primary" :disabled="creationDisabled" @click="edit(null, $event)"><PlusOutlined aria-hidden="true" />{{ $t('添加成员') }}</button></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" /><p v-if="loading" role="status">{{ $t('正在读取成员…') }}</p>
    <div v-if="data?.members.length" class="ui-table-wrap"><table class="ui-data-table ui-members-table">
      <thead><tr><th class="ui-table-title-column">{{ $t('参与者') }}</th><th>{{ $t('部门') }}</th><th>{{ $t('当前授权') }}</th><th><span class="sr-only">{{ $t('操作') }}</span></th></tr></thead>
      <tbody><tr v-for="member in data.members" :key="member.userId">
        <td class="ui-table-title"><div class="ui-member-person"><PersonAvatar :name="member.displayName" /><div><strong>{{ member.displayName }}</strong><p>{{ member.username }}<span v-if="member.status !== 'active'" class="ui-member-status"> · {{ $t('已移除') }}</span></p></div></div></td>
        <td :data-label="$t('部门')">{{ member.administratorAccess ? $t('无需部门') : member.departmentName || $t('未分配部门') }}</td>
        <td :data-label="$t('当前授权')"><span class="ui-member-authorization" :title="permissionCatalog.filter(item => member.effectivePermissions.includes(item.id)).map(item => $t(item.label)).join('、')">{{ authorization(member) }}</span></td>
        <td class="ui-table-action"><button v-if="canManage" :disabled="saving" :aria-label="member.status === 'active' ? $t('调整{p0}（{p1}）权限', { p0: member.displayName, p1: member.username }) : $t('恢复{p0}（{p1}）成员', { p0: member.displayName, p1: member.username })" @click="member.status === 'active' ? edit(member, $event) : restore(member, $event)">{{ member.status === 'active' ? $t('调整授权') : $t('恢复成员') }}</button></td>
      </tr></tbody>
    </table></div>
    <p v-else-if="data && !loading" class="project-empty">{{ $t('暂无成员') }}</p>
    <button v-if="error && !data && !loading" @click="reload">{{ $t('重新加载') }}</button>
    <ModalDialog class="project-member-dialog" :open="editorOpen && canManage" :return-focus="editorTrigger" @close="closeEditor" :title="selected ? (selected.status === 'disabled' ? $t('恢复成员') : $t('调整 {name} 的授权', { name: selected.displayName })) : $t('添加成员')">
      <FeedbackMessage :message="error" type="error" />
      <form :id="editorFormId" class="project-form" @submit.prevent="submit">
        <p v-if="!form.userId" class="field-hint">{{ $t('普通成员的权限由部门上限与项目授权共同决定。管理员自动拥有全部权限，无需分配。') }}</p>
        <label v-show="!selected">{{ $t('用户') }}<AppSelect native-events :aria-label="$t('用户')" v-model="form.userId" required :disabled="Boolean(selected) || saving" @change="chooseUser"><option value="" disabled>{{ $t('选择用户') }}</option><option v-for="user in (selected ? data?.candidates : candidates)" :key="user.id" :value="user.id">{{ user.displayName }}（{{ user.username }}） · {{ user.administratorAccess ? $t('无需部门') : user.departmentName || $t('未分配部门') }}</option></AppSelect></label>
        <p v-if="form.userId && !selected" class="field-hint">{{ $t('所属部门：') }}{{ selected?.departmentName || candidate?.departmentName || $t('未分配') }}。{{ administratorAccess ? $t('管理员自动拥有全部权限，无需分配部门或项目权限。') : $t('部门未开放的功能需由系统管理员在“部门可用功能”中调整。') }}</p>
        <p v-if="form.userId && !administratorAccess && !ceiling.includes('project.view')" class="error">{{ $t('该账号的部门未开放查看项目，无法添加或恢复为参与中的成员。') }}</p>
        <p v-if="administratorAccess" class="field-hint">{{ $t('管理员不属于任何部门，自动拥有全部权限，无需分配。') }}</p><ProjectPermissionEditor v-if="form.userId && !administratorAccess" compact :key="form.userId" v-model="form.permissions" :baseline="selected?.permissions || []" :ceiling="ceiling" :administrator-access="administratorAccess" :disabled="saving || !form.userId" />
        <details v-if="selected" class="member-access-details"><summary>{{ $t('成员状态与授权说明') }}</summary><p v-if="!administratorAccess" class="field-hint">{{ $t('部门允许') }} {{ selected.departmentPermissions?.length || 0 }} {{ $t('项 · 本项目授予') }} {{ selected.permissions.length }} {{ $t('项 · 当前有效') }} {{ selected.effectivePermissions.length }} {{ $t('项') }}</p><p v-if="selected.administratorAccess" class="field-hint">{{ $t('管理员全局管理权限持续生效，不受项目成员状态影响。') }}</p><label v-if="selected">{{ $t('成员状态') }}<AppSelect native-events :aria-label="$t('成员状态')" v-model="form.status" :disabled="saving"><option value="active">{{ $t('参与中') }}</option><option value="disabled">{{ $t('移出项目（保留历史）') }}</option></AppSelect></label></details>
        <p v-if="form.userId" class="field-hint">{{ $t('授予代码操作权限后自动分配开发空间。移除负责人前须在项目设置中指定接任人。') }}</p>
      </form>
      <template #footer><div class="actions"><button type="button" class="release-quiet-button" :disabled="saving" @click="closeEditor">{{ $t('取消') }}</button><button type="submit" :form="editorFormId" class="primary" :disabled="saving || !canSave">{{ $t('保存成员') }}</button></div></template>
    </ModalDialog>
  </section>
</template>
