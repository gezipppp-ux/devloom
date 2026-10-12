<script setup>
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
const ceiling = computed(() => selected.value?.departmentPermissions || candidate.value?.permissions || []);
const candidates = computed(() => (data.value?.candidates || []).filter(user => !(data.value?.members || []).some(member => member.userId === user.id)));
const canSave = computed(() => form.userId && (form.status === "disabled" || (ceiling.value.includes("project.view") && form.permissions.includes("project.view"))));
function chooseUser() { form.permissions = ceiling.value.includes("project.view") ? ["project.view"] : []; }
function restore(row) { edit(row); form.status = "active"; if (ceiling.value.includes("project.view") && !form.permissions.includes("project.view")) form.permissions.push("project.view"); }
function edit(row) { selected.value = row; Object.assign(form, { userId: row?.userId || "", permissions: [...(row?.permissions || [])], status: row?.status || "active" }); }
function submit() {
  const value = { permissions: form.permissions, status: form.status };
  if (selected.value) value.revision = selected.value.revision; else value.userId = form.userId;
  return save(`${endpoint}${selected.value ? `/${selected.value.userId}` : ""}`, value, () => { edit(null); emit("saved"); void reload(); });
}
</script>
<template>
  <div><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <FormSection title="项目分工与授权"><p class="field-hint">部门可用功能是系统管理员设定的上限；这里决定成员在本项目承担哪些工作。两者都允许的功能才会生效。</p><p v-if="loading" role="status">正在读取成员…</p><ul class="account-list"><li v-for="member in data?.members" :key="member.userId" class="account-list-row"><div class="account-list-identity"><strong>{{ member.username }}</strong><span class="muted">{{ member.departmentName }} · {{ member.status === 'active' ? '参与中' : '已移除' }} · 部门允许 {{ member.departmentPermissions?.length || 0 }} 项 → 本项目授予 {{ member.permissions.length }} 项 → 当前有效 {{ member.effectivePermissions.length }} 项</span></div><button v-if="canManage" :disabled="saving" :aria-label="member.status === 'active' ? `调整${member.username}权限` : `恢复${member.username}成员`" @click="member.status === 'active' ? edit(member) : restore(member)">{{ member.status === 'active' ? '调整分工' : '恢复成员' }}</button></li></ul></FormSection>
    <FormSection v-if="canManage" :title="selected ? (selected.status === 'disabled' ? '恢复成员' : '调整成员分工') : '添加成员'"><form class="project-form" @submit.prevent="submit"><label>用户<select aria-label="用户" v-model="form.userId" required :disabled="Boolean(selected) || saving" @change="chooseUser"><option value="" disabled>选择用户</option><option v-for="user in (selected ? data?.candidates : candidates)" :key="user.id" :value="user.id">{{ user.username }} · {{ user.departmentName }}</option></select></label><p v-if="form.userId" class="field-hint">所属部门：{{ selected?.departmentName || candidate?.departmentName || '未分配' }}。部门未开放的功能需由系统管理员在“部门可用功能”中调整。</p><p v-if="form.userId && !ceiling.includes('project.view')" class="error">该账号的部门未开放查看项目，无法添加或恢复为参与中的成员。</p><ProjectPermissionEditor v-model="form.permissions" :ceiling="ceiling" :disabled="saving || !form.userId" /><label v-if="selected">成员状态<select aria-label="成员状态" v-model="form.status"><option value="active">参与中</option><option value="disabled">移出项目（保留历史）</option></select></label><p class="field-hint">授予代码操作权限后自动分配开发空间。移除负责人前须在项目设置中指定接任人。</p><div class="actions"><button type="submit" class="primary" :disabled="saving || !canSave">保存成员</button><button v-if="selected" type="button" @click="edit(null)">取消</button></div></form></FormSection>
  </div>
</template>
