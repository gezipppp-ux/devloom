<script setup>
import {computed, watch} from "vue";
import {RouterView, useRoute, useRouter} from "vue-router";
import {accountSession} from "../shared/api/account-session.js";
import OperationMessages from "../shared/components/OperationMessages.vue";
import {clearMessages} from "../shared/components/operation-messages.js";
import {provideDocumentTitle} from "../shared/components/page-title.js";
import {translate} from "../shared/i18n/index.js";

const route = useRoute();
const router = useRouter();
watch(() => accountSession.generation, clearMessages, {flush: "sync"});
// Remove protected components before asynchronous navigation finishes. A fresh
// instance must never issue requests using the next account's generation.
const canRender = computed(() => route.meta.notFound || route.name === "login" || route.name === "setup" && accountSession.setup?.needsAdmin || Boolean(
    accountSession.user &&
    (!accountSession.setup?.required || ["setup", "password"].includes(route.name)) &&
    (!accountSession.user.mustChangePassword || route.name === "password") &&
    (!route.meta.admin || accountSession.user.role === "admin"),
));
const pageNames = {
  login: "登录", setup: "初始化", password: "设置你的新密码",
  workspace: "工作台", projects: "项目", project: "项目概览", work: "待推进",
  issues: "事项", development: "开发", deliveries: "交付", personal: "个人设置",
  system: "管理中心", accounts: "账号管理", departments: "部门可用功能",
  "not-found": "页面不存在", "unknown-page": "页面不存在",
};
provideDocumentTitle(() => canRender.value ? [translate(
  route.name === "workspace" && route.query.workspace ? "开发" : pageNames[route.name] || "工作台",
)] : [], () => canRender.value);
watch(() => accountSession.user, (user) => {
  if (route.meta.notFound) return;
  if (!user && route.name !== "login" && !(route.name === "setup" && accountSession.setup?.needsAdmin)) void router.replace({name: accountSession.setup?.needsAdmin ? "setup" : "login"});
  else if (user?.mustChangePassword && route.name !== "password")
    void router.replace({name: "password"});
  else if (user && user.role !== "admin" && route.meta.admin)
    void router.replace({name: "personal"});
});
watch(() => accountSession.setup?.required, required => {
  if (route.meta.notFound) return;
  if (required && !accountSession.user?.mustChangePassword && route.name !== "setup") void router.replace({name: "setup"});
});
</script>
<template>
  <OperationMessages/>
  <RouterView v-slot="{ Component }">
    <component :is="Component" v-if="canRender" :key="accountSession.generation"/>
  </RouterView>
</template>
