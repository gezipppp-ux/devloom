<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { TeamOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import FormSection from "../../shared/components/FormSection.vue";
const users = ref([]), busy = ref(false), loading = ref(true), error = ref(""), notice = ref("");
const departments = ref([]);
const form = reactive({ username: "", displayName: "", password: "", role: "member", departmentId: "", canCreateProjects: false });
const selected = ref(null), resetPassword = ref("");
const editingName = ref(null), displayName = ref("");
let disposed = false;
onUnmounted(() => { disposed = true; form.password = ""; resetPassword.value = ""; });
async function load() {
  loading.value = true;
  try { const [result, organization] = await Promise.all([appApi("/admin/accounts"), appApi("/admin/departments")]); if (!disposed) { users.value = result.users; departments.value = organization.departments; } }
  catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) loading.value = false; }
}
onMounted(load);
async function mutate(url, data, message) {
  if (busy.value) return;
  busy.value = true; error.value = ""; notice.value = "";
  try {
    const result = await appApi(url, data);
    if (disposed) return;
    if (result.user?.id === accountSession.user?.id) accountSession.user = result.user;
    form.password = ""; resetPassword.value = ""; selected.value = null; editingName.value = null;
    notice.value = message;
    await load();
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
function create() { if (!form.displayName.trim()) return; return mutate("/admin/accounts", { ...form }, "账号已创建，首次登录需要修改密码。"); }
function update(user, patch) { return mutate(`/admin/accounts/${encodeURIComponent(user.id)}`, patch, "账号已更新。"); }
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">ACCOUNTS</div><h1><TeamOutlined aria-hidden="true" /> {{ $t("账号管理") }}</h1><p>{{ $t("维护登录账号、显示名称、部门和创建项目资格。管理员可管理全部项目；开发操作仍按原授权。") }}</p></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection :title="$t(&quot;创建账号&quot;)">
      <a-form :model="form" layout="vertical" @finish="create">
        <div class="form-columns"><a-form-item :label="$t(&quot;新账号&quot;)"><input v-model="form.username" :aria-label="$t(&quot;新账号&quot;)" autocomplete="off" required maxlength="80" :disabled="busy" /></a-form-item><a-form-item :label="$t(&quot;账号角色&quot;)"><select v-model="form.role" :aria-label="$t(&quot;账号角色&quot;)" :disabled="busy"><option value="member">{{ $t("普通成员") }}</option><option value="admin">{{ $t("管理员") }}</option></select></a-form-item></div>
        <a-form-item :label="$t(&quot;显示名称&quot;)"><input v-model="form.displayName" :aria-label="$t(&quot;显示名称&quot;)" required maxlength="80" :disabled="busy" /><p class="field-hint">{{ $t("用于成员、评论和负责人展示；登录仍使用账号。") }}</p></a-form-item>
        <a-form-item :label="$t(&quot;临时密码&quot;)"><input v-model="form.password" type="password" :aria-label="$t(&quot;临时密码&quot;)" autocomplete="new-password" required minlength="6" :disabled="busy" /><p class="field-hint">{{ $t("至少 6 个字符；首次登录强制修改。") }}</p></a-form-item>
        <a-form-item :label="$t(&quot;所属部门&quot;)"><select v-model="form.departmentId" :aria-label="$t(&quot;所属部门&quot;)" required :disabled="busy"><option value="" disabled>{{ $t("选择部门") }}</option><option v-for="department in departments.filter(d => d.status === 'active')" :key="department.id" :value="department.id">{{ department.name }}</option></select><p v-if="!departments.length" class="field-hint">{{ $t("请先在「部门与权限」中创建部门。") }}</p></a-form-item>
        <a-form-item><label class="permission-choice"><input v-model="form.canCreateProjects" type="checkbox" :disabled="busy" />{{ $t("允许创建项目（仍受部门权限上限限制）") }}</label></a-form-item>
        <button class="primary" type="submit" :disabled="busy || !form.displayName.trim()">{{ $t("创建账号") }}</button>
      </a-form>
    </FormSection>
    <FormSection :title="$t(&quot;账号列表&quot;)">
      <p v-if="loading" role="status">{{ $t("正在读取账号…") }}</p>
      <ul v-else class="account-list">
        <li v-for="user in users" :key="user.id" class="account-list-row">
          <div class="account-list-identity"><strong>{{ user.displayName }}<span v-if="user.id === accountSession.user.id">{{ $t("（当前账号）") }}</span></strong><span class="muted">{{ user.username }} · {{ user.role === 'admin' ? $t("管理员") : $t("普通成员") }} · {{ user.status === 'disabled' ? $t("已停用") : $t("正常") }}</span></div>
          <div class="account-row-actions">
            <button :disabled="busy" :aria-label="$t(&quot;{p0}：编辑显示名称&quot;, { p0: user.username })" @click="editingName = user; displayName = user.displayName; selected = null">{{ $t("编辑显示名称") }}</button>
            <select :value="user.departmentId || ''" :aria-label="$t(&quot;{p0}：所属部门&quot;, { p0: user.username })" :disabled="busy" @change="update(user, { departmentId: $event.target.value })"><option value="" disabled>{{ $t("尚未分配部门") }}</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></select>
            <button v-if="user.role !== 'admin'" :disabled="busy" @click="update(user, { canCreateProjects: !user.canCreateProjects })">{{ user.canCreateProjects ? $t("取消创建项目资格") : $t("授予创建项目资格") }}</button>
            <button :disabled="busy" :aria-label="`${user.username}：${user.role === 'admin' ? $t(&quot;设为普通成员&quot;) : $t(&quot;设为管理员&quot;)}`" @click="update(user, { role: user.role === 'admin' ? 'member' : 'admin' })">{{ user.role === 'admin' ? $t("设为普通成员") : $t("设为管理员") }}</button>
            <button :disabled="busy || user.id === accountSession.user.id" :aria-label="`${user.username}：${user.status === 'disabled' ? $t(&quot;启用账号&quot;) : $t(&quot;停用账号&quot;)}`" @click="update(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })">{{ user.status === 'disabled' ? $t("启用账号") : $t("停用账号") }}</button>
            <button :disabled="busy" :aria-label="$t(&quot;{p0}：重置密码&quot;, { p0: user.username })" @click="selected = user; resetPassword = ''; editingName = null">{{ $t("重置密码") }}</button>
          </div>
          <form v-if="editingName?.id === user.id" class="account-reset-form" @submit.prevent="displayName.trim() && update(user, { displayName: displayName.trim() })"><label :for="`name-${user.id}`">{{ user.username }} {{ $t("的显示名称") }}</label><input :id="`name-${user.id}`" v-model="displayName" required maxlength="80" :disabled="busy" /><div class="actions"><button type="submit" :disabled="busy || !displayName.trim()">{{ $t("保存显示名称") }}</button><button type="button" :disabled="busy" @click="editingName = null">{{ $t("取消") }}</button></div></form>
          <form v-if="selected?.id === user.id" class="account-reset-form" @submit.prevent="update(user, { password: resetPassword })"><label :for="`reset-${user.id}`">{{ user.username }} {{ $t("的新临时密码") }}</label><input :id="`reset-${user.id}`" v-model="resetPassword" type="password" autocomplete="new-password" required minlength="6" :disabled="busy" /><div class="actions"><button type="submit" :disabled="busy">{{ $t("确认重置密码") }}</button><button type="button" :disabled="busy" @click="selected = null; resetPassword = ''">{{ $t("取消") }}</button></div></form>
        </li>
      </ul>
    </FormSection>
  </section>
</template>
