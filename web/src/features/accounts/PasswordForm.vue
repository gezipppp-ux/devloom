<script setup>
import { onUnmounted, reactive, ref } from "vue";
import { changeAccountPassword } from "../../shared/api/account-session.js";
const emit = defineEmits(["saved"]);
const form = reactive({ currentPassword: "", password: "", confirmation: "" });
const busy = ref(false), error = ref(""), saved = ref(false);
let disposed = false;
onUnmounted(() => { disposed = true; form.currentPassword = ""; form.password = ""; form.confirmation = ""; });
async function save() {
  if (busy.value) return;
  error.value = ""; saved.value = false;
  if (form.password !== form.confirmation) { error.value = "两次输入的新密码不一致。"; return; }
  busy.value = true;
  try {
    await changeAccountPassword({ currentPassword: form.currentPassword, password: form.password });
    if (!disposed) { form.currentPassword = ""; form.password = ""; form.confirmation = ""; saved.value = true; emit("saved"); }
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) busy.value = false; }
}
</script>
<template>
  <a-form :model="form" layout="vertical" @finish="save">
    <a-form-item label="当前密码"><input v-model="form.currentPassword" type="password" autocomplete="current-password" aria-label="当前密码" required :disabled="busy" /></a-form-item>
    <a-form-item label="新密码"><input v-model="form.password" type="password" autocomplete="new-password" aria-label="新密码" required minlength="12" :disabled="busy" /><p class="field-hint">至少 12 个字符。</p></a-form-item>
    <a-form-item label="确认新密码"><input v-model="form.confirmation" type="password" autocomplete="new-password" aria-label="确认新密码" required minlength="12" :disabled="busy" /></a-form-item>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="saved" class="success" role="status">密码已更新。</p>
    <button class="primary" type="submit" :disabled="busy">{{ busy ? "正在保存…" : "修改密码" }}</button>
  </a-form>
</template>
