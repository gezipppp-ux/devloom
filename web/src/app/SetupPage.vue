<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { FolderOpenOutlined } from "@antdv-next/icons";
import { accountSession, logoutAccount, revalidateAccountSession } from "../shared/api/account-session.js";
import FeedbackMessage from "../shared/components/FeedbackMessage.vue";
import InitialAdminForm from "../features/accounts/InitialAdminForm.vue";
import SetupFrame from "../features/setup/SetupFrame.vue";
import SetupWizard from "../features/setup/SetupWizard.vue";
import SetupEnvironment from "../features/settings/SetupEnvironment.vue";
import ServerDirectoryPicker from "../features/settings/ServerDirectoryPicker.vue";
import LocaleSelect from "../shared/components/LocaleSelect.vue";
const picker = ref(), error = ref("");
const router = useRouter();
async function exit() { try { await logoutAccount(); await router.replace({ name: "login" }); } catch (failure) { error.value = failure.message; } }
async function complete(projectId) {
  try { await revalidateAccountSession(); await router.replace(projectId ? { name: "project", params: { projectId } } : { name: "workspace" }); }
  catch (failure) { error.value = failure.message; }
}
async function refresh() { try { await revalidateAccountSession(); if (!accountSession.setup?.required) await router.replace({ name: "workspace" }); } catch (failure) { error.value = failure.message; } }
</script>
<template>
  <FeedbackMessage :message="error" type="error" />
  <SetupFrame v-if="!accountSession.user" step="admin"><h2>{{ $t("先创建管理员账号") }}</h2><InitialAdminForm /></SetupFrame>
  <SetupWizard v-else-if="accountSession.user.role === 'admin'" @exit="exit" @complete="complete">
    <template #environment="{ update, disabled }"><SetupEnvironment :disabled="disabled" @status="update" /></template>
    <template #directory-picker="{ path, select, disabled }"><button type="button" :disabled="disabled" @click="picker.open(path)"><FolderOpenOutlined aria-hidden="true" />{{ $t("浏览服务器目录") }}</button><ServerDirectoryPicker ref="picker" :save-label="$t('保存并继续')" @select="select" /></template>
  </SetupWizard>
  <main v-else class="page-layout"><LocaleSelect /><header class="page-heading"><h1>{{ $t("管理员正在完成初始化") }}</h1><p>{{ $t("完成后即可进入工作台。你的账号与权限会保持不变。") }}</p></header><div class="actions"><button class="primary" @click="refresh">{{ $t("检查初始化状态") }}</button><button @click="exit">{{ $t("退出登录") }}</button></div></main>
</template>
