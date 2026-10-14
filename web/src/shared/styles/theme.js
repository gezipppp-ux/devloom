/* global window, document */
import { readonly, ref } from "vue";

const storageKey = "web-coding.theme";
const preference = ref("system");
const resolved = ref("light");
let systemTheme;

export const themePreference = readonly(preference);
export const resolvedTheme = readonly(resolved);

function normalize(value) {
  return ["light", "dark"].includes(value) ? value : "system";
}

function applyTheme() {
  const value = preference.value === "system" ? (systemTheme?.matches ? "dark" : "light") : preference.value;
  document.documentElement.dataset.theme = value;
  resolved.value = value;
}

export function setThemePreference(value) {
  if (!["system", "light", "dark"].includes(value)) return;
  preference.value = value;
  applyTheme();
  try { window.localStorage.setItem(storageKey, value); } catch { /* Device storage is optional. */ }
}

// One subscription for the application lifetime, independent of route/account changes.
export function initializeTheme() {
  systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  try { preference.value = normalize(window.localStorage.getItem(storageKey)); } catch { preference.value = "system"; }
  applyTheme();
  const syncStorage = event => {
    if (event.key !== storageKey && event.key !== null) return;
    try { if (event.storageArea !== window.localStorage) return; } catch { return; }
    preference.value = normalize(event.newValue);
    applyTheme();
  };
  systemTheme.addEventListener("change", applyTheme);
  window.addEventListener("storage", syncStorage);
  return () => {
    systemTheme.removeEventListener("change", applyTheme);
    window.removeEventListener("storage", syncStorage);
  };
}
