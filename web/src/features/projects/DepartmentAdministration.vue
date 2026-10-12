<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
import ProjectPermissionEditor from "../../shared/components/ProjectPermissionEditor.vue";
const endpoint = "/admin/departments";
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint));
const selected = ref(null);
const form = reactive({ name: "", status: "active", permissions: [] });
const rows = computed(() => data.value?.departments || []);
function edit(row) { selected.value = row || null; Object.assign(form, { name: "", status: "active", permissions: [] }, row || {}); }
function submit() {
  const input = { name: form.name, status: form.status, permissions: form.permissions };
  if (selected.value) input.revision = selected.value.revision;
  return save(`${endpoint}${selected.value ? `/${selected.value.id}` : ""}`, input, () => { edit(); void reload(); });
}
</script>
<template>
  <section class="project-page"><header class="page-heading"><div class="eyebrow">ADMINISTRATION</div><h1>部门可用功能</h1><p>系统管理员在此设定部门允许使用的功能上限；项目负责人再按工作内容分配本项目权限，最终只生效两者共同允许的功能。</p></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection :title="selected ? '编辑' : '新增'"><form class="project-form" @submit.prevent="submit"><label>部门名称<input v-model="form.name" required maxlength="80" /></label><label>状态<select aria-label="状态" v-model="form.status"><option value="active">启用</option><option value="disabled">停用</option></select></label><ProjectPermissionEditor v-model="form.permissions" department :disabled="saving" /><div class="actions"><button class="primary" type="submit" :disabled="saving">保存部门</button><button v-if="selected" type="button" :disabled="saving" @click="edit()">取消编辑</button></div></form></FormSection>
    <FormSection title="已配置部门"><p v-if="loading" role="status">正在加载…</p><p v-else-if="!rows.length" class="muted">暂无记录。</p><ul v-else class="account-list"><li v-for="row in rows" :key="row.id" class="account-list-row"><div class="account-list-identity"><strong>{{ row.name }}</strong><span class="muted">{{ row.status === 'active' ? '启用' : '停用' }} · {{ row.permissions.length }} 项权限</span></div><button :disabled="saving" :aria-label="`编辑${row.name}`" @click="edit(row)">编辑</button></li></ul></FormSection>
  </section>
</template>
