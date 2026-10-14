/* global document, getComputedStyle */
import { computed, createApp, h, onUnmounted } from "vue";
import { ConfigProvider, Form, FormItem, theme as antdTheme } from "antdv-next";
import enUS from "antdv-next/locale/en_US";
import zhCN from "antdv-next/locale/zh_CN";
import "./shared/styles/style.css";
import App from "./app/App.vue";
import { router } from "./app/router.js";
import { i18n, setLocale } from "./shared/i18n/index.js";
import { initializeTheme, resolvedTheme } from "./shared/styles/theme.js";

const disposeTheme = initializeTheme();
if (import.meta.hot) import.meta.hot.dispose(disposeTheme);
setLocale(i18n.global.locale.value);
const theme = computed(() => {
  const algorithm = resolvedTheme.value === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;
  const tokens = getComputedStyle(document.documentElement);
  const token = name => tokens.getPropertyValue(name).trim();
  return {
    algorithm,
    token: {
      colorPrimary: token("--accent"),
      colorPrimaryHover: token("--accent-hover") || token("--accent"),
      colorPrimaryActive: token("--accent-active") || token("--accent"),
      colorText: token("--ink"),
      colorTextSecondary: token("--muted"),
      colorBorder: token("--field-border"),
      colorBgContainer: token("--surface"),
      colorBgElevated: token("--surface"),
      colorBgLayout: token("--canvas"),
      colorError: token("--danger"),
      colorSuccess: token("--success"),
      colorWarning: token("--warning"),
      colorSplit: token("--line"),
      controlItemBgHover: token("--soft"),
      controlItemBgActive: token("--selected"),
      borderRadius: Number.parseInt(token("--radius-control"), 10),
      controlHeight: Number.parseInt(token("--control-height"), 10),
      fontSize: 14,
      fontFamily: token("--font-ui"),
    },
  };
});

createApp({
  setup() {
    onUnmounted(disposeTheme);
    return () => h(ConfigProvider, { theme: theme.value, locale: i18n.global.locale.value === "en" ? enUS : zhCN }, { default: () => h(App) });
  },
})
  .use(router)
  .use(i18n)
  .component("AForm", Form)
  .component("AFormItem", FormItem)
  .mount("#app");
