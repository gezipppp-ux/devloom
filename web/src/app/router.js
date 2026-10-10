import { createRouter, createWebHistory } from "vue-router";
import { accountSession, loadAccountSession } from "../shared/api/account-session.js";
import LoginPage from "../features/accounts/LoginPage.vue";
import PasswordPage from "../features/accounts/PasswordPage.vue";
import WorkbenchApp from "./WorkbenchApp.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginPage },
    { path: "/password", name: "password", component: PasswordPage },
    { path: "/", name: "workspace", component: WorkbenchApp },
    { path: "/personal", name: "personal", component: WorkbenchApp },
    { path: "/system", name: "system", component: WorkbenchApp, meta: { admin: true } },
    { path: "/environment", redirect: to => ({ name: "system", query: { ...to.query, tab: "environment" }, hash: to.hash }) },
    { path: "/accounts", name: "accounts", component: WorkbenchApp, meta: { admin: true } },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
router.beforeEach(async (to) => {
  if (!accountSession.ready) {
    try { await loadAccountSession(); } catch { /* Login provides a retry. */ }
  }
  if (!accountSession.user)
    return to.name === "login" ? true : { name: "login", query: { redirect: to.fullPath } };
  if (accountSession.user.mustChangePassword)
    return to.name === "password" ? true : { name: "password" };
  if (to.name === "login" || to.name === "password") return { name: "workspace" };
  if (to.meta.admin && accountSession.user.role !== "admin") return { name: "personal" };
  return true;
});
