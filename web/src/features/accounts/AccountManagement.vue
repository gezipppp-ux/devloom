<script setup>
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { TeamOutlined } from "@antdv-next/icons";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import FormSection from "../../shared/components/FormSection.vue";
const users = ref([]), busy = ref(false), loading = ref(true), error = ref(""), notice = ref("");
const form = reactive({ username: "", password: "", role: "member" });
const selected = ref(null), resetPassword = ref("");
let disposed = false;
onUnmounted(() => { disposed = true; form.password = ""; resetPassword.value = ""; });
async function load() {
  loading.value = true;
  try { const result = await appApi("/admin/accounts"); if (!disposed) users.value = result.users; }
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
    form.password = ""; resetPassword.value = ""; selected.value = null;
    notice.value = message;
    await load();
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
function create() { return mutate("/admin/accounts", { ...form }, "账号已创建，首次登录需要修改密码。"); }
function update(user, patch) { return mutate(`/admin/accounts/${encodeURIComponent(user.id)}`, patch, "账号已更新。"); }
</script>
<template>
  <section class="system-settings-panel">
    <header class="page-heading"><div class="eyebrow">ACCOUNTS</div><h1><TeamOutlined aria-hidden="true" /> 账号管理</h1><p>创建账号、调整管理员角色或停用登录。每个账号的工作区保持私有。</p></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <FormSection title="创建账号">
      <a-form :model="form" layout="vertical" @finish="create">
        <div class="form-columns"><a-form-item label="新账号"><input v-model="form.username" aria-label="新账号" autocomplete="off" required maxlength="80" :disabled="busy" /></a-form-item><a-form-item label="账号角色"><select v-model="form.role" aria-label="账号角色" :disabled="busy"><option value="member">普通成员</option><option value="admin">管理员</option></select></a-form-item></div>
        <a-form-item label="临时密码"><input v-model="form.password" type="password" aria-label="临时密码" autocomplete="new-password" required minlength="6" :disabled="busy" /><p class="field-hint">至少 6 个字符；首次登录强制修改。</p></a-form-item>
        <button class="primary" type="submit" :disabled="busy">创建账号</button>
      </a-form>
    </FormSection>
    <FormSection title="账号列表">
      <p v-if="loading" role="status">正在读取账号…</p>
      <ul v-else class="account-list">
        <li v-for="user in users" :key="user.id" class="account-list-row">
          <div class="account-list-identity"><strong>{{ user.username }}<span v-if="user.id === accountSession.user.id">（当前账号）</span></strong><span class="muted">{{ user.role === 'admin' ? '管理员' : '普通成员' }} · {{ user.status === 'disabled' ? '已停用' : '正常' }}</span></div>
          <div class="account-row-actions">
            <button :disabled="busy" :aria-label="`${user.username}：${user.role === 'admin' ? '设为普通成员' : '设为管理员'}`" @click="update(user, { role: user.role === 'admin' ? 'member' : 'admin' })">{{ user.role === 'admin' ? '设为普通成员' : '设为管理员' }}</button>
            <button :disabled="busy || user.id === accountSession.user.id" :aria-label="`${user.username}：${user.status === 'disabled' ? '启用账号' : '停用账号'}`" @click="update(user, { status: user.status === 'disabled' ? 'active' : 'disabled' })">{{ user.status === 'disabled' ? '启用账号' : '停用账号' }}</button>
            <button :disabled="busy" :aria-label="`${user.username}：重置密码`" @click="selected = user; resetPassword = ''">重置密码</button>
          </div>
          <form v-if="selected?.id === user.id" class="account-reset-form" @submit.prevent="update(user, { password: resetPassword })"><label :for="`reset-${user.id}`">{{ user.username }} 的新临时密码</label><input :id="`reset-${user.id}`" v-model="resetPassword" type="password" autocomplete="new-password" required minlength="6" :disabled="busy" /><div class="actions"><button type="submit" :disabled="busy">确认重置密码</button><button type="button" :disabled="busy" @click="selected = null; resetPassword = ''">取消</button></div></form>
        </li>
      </ul>
    </FormSection>
  </section>
</template>
