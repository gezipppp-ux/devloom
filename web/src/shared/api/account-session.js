/* global window */
import { reactive } from "vue";
import { appApi, onAuthenticationFailure, resetApiSession, setAuthenticationToken } from "./api.js";

export const accountSession = reactive({ ready: false, user: null, settings: {}, setup: null, generation: 0, error: "" });
let initialization;
let settingsQueue = Promise.resolve();
let settingsRevision = 0;
let profileRevision = 0;
let signoutRequest = Promise.resolve();
const logoutKey = "web-coding-account-signout";
function broadcastIdentityChange() {
  try { window.localStorage.setItem(logoutKey, `${Date.now()}:${Math.random()}`); }
  catch { /* Cross-tab delivery is unavailable when browser storage is disabled. */ }
}

function applySession(result) {
  if (accountSession.user?.id !== result.user?.id) {
    resetApiSession();
    accountSession.generation++;
  }
  setAuthenticationToken(result.token);
  accountSession.user = result.user || null;
  accountSession.settings = result.settings || {};
  accountSession.setup = result.setup || null;
  accountSession.ready = true;
  accountSession.error = "";
}

export function clearAccountSession() {
  resetApiSession();
  accountSession.generation++;
  accountSession.user = null;
  accountSession.settings = {};
  accountSession.setup = null;
  accountSession.ready = true;
  initialization = null;
  settingsQueue = Promise.resolve();
}

export async function loadAccountSession() {
  if (!initialization) {
    initialization = appApi("/auth/session").then(applySession).catch((error) => {
      accountSession.error = error.message;
      accountSession.ready = true;
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export async function revalidateAccountSession() {
  const revision = settingsRevision;
  const userRevision = profileRevision;
  const result = await appApi("/auth/session");
  if (accountSession.user?.id === result.user?.id && revision !== settingsRevision)
    result.settings = accountSession.settings;
  if (accountSession.user?.id === result.user?.id && userRevision !== profileRevision)
    result.user = { ...result.user, displayName: accountSession.user.displayName };
  applySession(result);
}

export async function loginAccount(credentials) {
  await signoutRequest.catch(() => {});
  initialization = null;
  await loadAccountSession();
  applySession(await appApi("/auth/login", credentials));
  broadcastIdentityChange();
}

export async function createInitialAccount(credentials) {
  applySession(await appApi("/setup/admin", credentials));
  broadcastIdentityChange();
}

export async function logoutAccount() {
  signoutRequest = appApi("/auth/logout", {}).catch((error) => {
    if (error.name !== "AbortError") throw error;
  });
  clearAccountSession();
  broadcastIdentityChange();
  try { await signoutRequest; }
  catch (error) {
    accountSession.error = `退出登录未能确认，请重试登录后再退出：${error.message}`;
    throw error;
  }
}

export async function changeAccountPassword(input) {
  applySession(await appApi("/auth/password", input));
}

export async function saveAccountProfile(patch) {
  const generation = accountSession.generation;
  const userId = accountSession.user?.id;
  profileRevision++;
  const result = await appApi("/account/profile", patch);
  if (generation !== accountSession.generation || userId !== accountSession.user?.id)
    throw Object.assign(new Error("账号已切换。"), { name: "AbortError" });
  profileRevision++;
  accountSession.user = { ...accountSession.user, displayName: result.user.displayName };
  return accountSession.user;
}

export function saveAccountSettings(patch) {
  settingsRevision++;
  const generation = accountSession.generation;
  const operation = settingsQueue.catch(() => {}).then(async () => {
    if (generation !== accountSession.generation)
      throw Object.assign(new Error("账号已切换。"), { name: "AbortError" });
    const result = await appApi("/account/settings", patch);
    if (generation === accountSession.generation) {
      // A session read started during this save must not restore its older snapshot.
      settingsRevision++;
      accountSession.settings = result.settings;
    }
    return result.settings;
  });
  settingsQueue = operation;
  return operation;
}

onAuthenticationFailure(clearAccountSession);
window.addEventListener("storage", (event) => {
  if (event.key === logoutKey && event.newValue) clearAccountSession();
});
