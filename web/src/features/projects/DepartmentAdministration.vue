<script setup>
import AppSelect from "../../shared/components/AppSelect.vue";
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
import ProjectPermissionEditor from "../../shared/components/ProjectPermissionEditor.vue";
defineProps({ embedded: Boolean });
const editing = ref(false);
const endpoint = "/admin/departments";
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi(endpoint));
const selected = ref(null);
const permissionEditorKey = ref(0);
const form = reactive({ name: "", status: "active", permissions: [] });
const rows = computed(() => data.value?.departments || []);
function edit(row) { editing.value = true; selected.value = row || null; Object.assign(form, { name: "", status: "active", permissions: [] }, row || {}); permissionEditorKey.value += 1; }
function submit() {
  const input = { name: form.name, status: form.status, permissions: form.permissions };
  if (selected.value) input.revision = selected.value.revision;
  return save(`${endpoint}${selected.value ? `/${selected.value.id}` : ""}`, input, () => { editing.value = false; selected.value = null; void reload(); });
}
</script>
<template>
  <section :class="embedded ? 'ui-department-settings' : 'page-layout project-page'"><header class="ui-settings-heading"><div><component :is="embedded ? 'h2' : 'h1'">{{ $t("部门可用功能") }}</component><p>{{ $t("系统管理员在此设定部门允许使用的功能上限；项目负责人再按工作内容分配本项目权限，最终只生效两者共同允许的功能。") }}</p></div><button class="primary" @click="edit()">{{ $t('新建部门') }}</button></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection v-if="editing" :title="selected ? $t('编辑') : $t('新增')"><form class="project-form" @submit.prevent="submit"><label>{{ $t("部门名称") }}<input v-model="form.name" required maxlength="80" /></label><label>{{ $t("状态") }}<AppSelect native-events :aria-label="$t('状态')" v-model="form.status"><option value="active">{{ $t("启用") }}</option><option value="disabled">{{ $t("停用") }}</option></AppSelect></label><ProjectPermissionEditor :key="permissionEditorKey" v-model="form.permissions" :baseline="selected?.permissions || []" department :disabled="saving" /><div class="actions"><button class="primary" type="submit" :disabled="saving">{{ $t("保存部门") }}</button><button type="button" :disabled="saving" @click="editing = false">{{ $t("取消编辑") }}</button></div></form></FormSection>
    <FormSection :title="$t('已配置部门')"><p v-if="loading" role="status">{{ $t("正在加载…") }}</p><p v-else-if="!rows.length" class="muted">{{ $t("暂无记录。") }}</p><ul v-else class="account-list"><li v-for="row in rows" :key="row.id" class="account-list-row"><div class="account-list-identity"><strong>{{ row.name }}</strong><span class="muted">{{ row.status === 'active' ? $t("启用") : $t("停用") }} · {{ row.permissions.length }} {{ $t("项权限") }}</span></div><button :disabled="saving" :aria-label="$t('编辑{p0}', { p0: row.name })" @click="edit(row)">{{ $t("编辑") }}</button></li></ul></FormSection>
  </section>
</template>
