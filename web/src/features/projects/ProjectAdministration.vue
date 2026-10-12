<script setup>
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
import ProjectPermissionEditor from "../../shared/components/ProjectPermissionEditor.vue";
const props = defineProps({ kind: { type: String, required: true } });
const department = computed(() => props.kind === "departments");
const endpoint = `/admin/${props.kind}`;
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint));
const selected = ref(null);
const form = reactive({ name: "", description: "", remoteUrl: "", status: "active", permissions: [] });
const rows = computed(() => data.value?.[props.kind] || []);
function edit(row) { selected.value = row || null; Object.assign(form, { name: "", description: "", remoteUrl: "", status: "active", permissions: [] }, row || {}); }
function submit() {
  const input = department.value ? { name: form.name, status: form.status, permissions: form.permissions } : { name: form.name, description: form.description, remoteUrl: form.remoteUrl, status: form.status };
  if (selected.value) input.revision = selected.value.revision;
  return save(`${endpoint}${selected.value ? `/${selected.value.id}` : ""}`, input, () => { edit(); void reload(); });
}
</script>
<template>
  <section class="project-page"><header class="page-heading"><div class="eyebrow">ADMINISTRATION</div><h1>{{ department ? '部门可用功能' : '仓库目录' }}</h1><p>{{ department ? '系统管理员在此设定部门允许使用的功能上限；项目负责人再按工作内容分配本项目权限，最终只生效两者共同允许的功能。' : '系统维护仓库地址，成员为自己的开发空间绑定个人 Git 账号。' }}</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <FormSection :title="selected ? '编辑' : '新增'"><form class="project-form" @submit.prevent="submit"><label>{{ department ? '部门名称' : '仓库名称' }}<input v-model="form.name" required maxlength="80" /></label><template v-if="!department"><label>仓库地址<input v-model="form.remoteUrl" required placeholder="https://git.example.com/team/repository.git" /></label><label>说明<textarea v-model="form.description" rows="3" maxlength="4000" /></label></template><label>状态<select aria-label="状态" v-model="form.status"><option value="active">启用</option><option value="disabled">停用</option></select></label><ProjectPermissionEditor v-if="department" v-model="form.permissions" department :disabled="saving" /><div class="actions"><button class="primary" type="submit" :disabled="saving">保存{{ department ? '部门' : '仓库' }}</button><button v-if="selected" type="button" :disabled="saving" @click="edit()">取消编辑</button></div></form></FormSection>
    <FormSection :title="department ? '已配置部门' : '已配置仓库'"><p v-if="loading" role="status">正在加载…</p><p v-else-if="!rows.length" class="muted">暂无记录。</p><ul v-else class="account-list"><li v-for="row in rows" :key="row.id" class="account-list-row"><div class="account-list-identity"><strong>{{ row.name }}</strong><span class="muted">{{ row.status === 'active' ? '启用' : '停用' }} {{ department ? `· ${row.permissions.length} 项权限` : row.remoteUrl }}</span></div><button :disabled="saving" :aria-label="`编辑${row.name}`" @click="edit(row)">编辑</button></li></ul></FormSection>
  </section>
</template>
