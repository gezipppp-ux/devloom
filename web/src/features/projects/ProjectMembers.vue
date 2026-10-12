<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
import ProjectPermissionEditor from "../../shared/components/ProjectPermissionEditor.vue";
const emit = defineEmits(["saved"]);
const props = defineProps({ projectId: { type: String, required: true }, canManage: Boolean });
const endpoint = `/projects/${props.projectId}/members`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint));
const selected = ref(null), form = reactive({ userId: "", permissions: [], status: "active" });
const candidate = computed(() => data.value?.candidates?.find(user => user.id === form.userId));
const administratorAccess = computed(() => Boolean(selected.value?.administratorAccess ?? candidate.value?.administratorAccess));
const ceiling = computed(() => selected.value?.grantablePermissions || candidate.value?.grantablePermissions || []);
const candidates = computed(() => (data.value?.candidates || []).filter(user => !(data.value?.members || []).some(member => member.userId === user.id)));
const canSave = computed(() => form.userId && (form.status === "disabled" || administratorAccess.value || (ceiling.value.includes("project.view") && form.permissions.includes("project.view"))));
function chooseUser() { form.permissions = !administratorAccess.value && ceiling.value.includes("project.view") ? ["project.view"] : []; }
function restore(row) { edit(row); form.status = "active"; if (!administratorAccess.value && ceiling.value.includes("project.view") && !form.permissions.includes("project.view")) form.permissions.push("project.view"); }
function edit(row) { selected.value = row; Object.assign(form, { userId: row?.userId || "", permissions: [...(row?.permissions || [])], status: row?.status || "active" }); }
function submit() {
  const value = { permissions: form.permissions, status: form.status };
  if (selected.value) value.revision = selected.value.revision; else value.userId = form.userId;
  return save(`${endpoint}${selected.value ? `/${selected.value.userId}` : ""}`, value, () => { edit(null); emit("saved"); void reload(); });
}
</script>
<template>
  <div><FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection title="项目分工与授权"><p class="field-hint">普通成员的权限由部门上限与项目授权共同决定。管理员可管理全部项目的成员、配置及协作内容；开发和敏感资产权限仍需部门与项目共同授权。</p><p v-if="loading" role="status">正在读取成员…</p><ul class="account-list"><li v-for="member in data?.members" :key="member.userId" class="account-list-row"><div class="account-list-identity"><strong>{{ member.displayName }}（{{ member.username }}）</strong><span class="muted">{{ member.departmentName || '未分配部门' }} · {{ member.status === 'active' ? '参与中' : '已移除' }} · 部门允许 {{ member.departmentPermissions?.length || 0 }} 项 · 本项目授予 {{ member.permissions.length }} 项 · 当前有效 {{ member.effectivePermissions.length }} 项</span><span v-if="member.administratorAccess" class="field-hint">管理员全局管理权限持续生效，不受项目成员状态影响。</span></div><button v-if="canManage" :disabled="saving" :aria-label="member.status === 'active' ? `调整${member.displayName}（${member.username}）权限` : `恢复${member.displayName}（${member.username}）成员`" @click="member.status === 'active' ? edit(member) : restore(member)">{{ member.status === 'active' ? '调整分工' : '恢复成员' }}</button></li></ul></FormSection>
    <FormSection v-if="canManage" :title="selected ? (selected.status === 'disabled' ? '恢复成员' : '调整成员分工') : '添加成员'"><form class="project-form" @submit.prevent="submit"><label>用户<select aria-label="用户" v-model="form.userId" required :disabled="Boolean(selected) || saving" @change="chooseUser"><option value="" disabled>选择用户</option><option v-for="user in (selected ? data?.candidates : candidates)" :key="user.id" :value="user.id">{{ user.displayName }}（{{ user.username }}） · {{ user.departmentName || '未分配部门' }}</option></select></label><p v-if="form.userId" class="field-hint">所属部门：{{ selected?.departmentName || candidate?.departmentName || '未分配' }}。{{ administratorAccess ? '管理员已有全局协作管理权限，可不额外勾选项目授权；开发和敏感资产权限仍受部门上限限制。' : '部门未开放的功能需由系统管理员在“部门可用功能”中调整。' }}</p><p v-if="form.userId && !administratorAccess && !ceiling.includes('project.view')" class="error">该账号的部门未开放查看项目，无法添加或恢复为参与中的成员。</p><ProjectPermissionEditor v-model="form.permissions" :ceiling="ceiling" :administrator-access="administratorAccess" :disabled="saving || !form.userId" /><label v-if="selected">成员状态<select aria-label="成员状态" v-model="form.status"><option value="active">参与中</option><option value="disabled">移出项目（保留历史）</option></select></label><p class="field-hint">授予代码操作权限后自动分配开发空间。移除负责人前须在项目设置中指定接任人。</p><div class="actions"><button type="submit" class="primary" :disabled="saving || !canSave">保存成员</button><button v-if="selected" type="button" @click="edit(null)">取消</button></div></form></FormSection>
  </div>
</template>
