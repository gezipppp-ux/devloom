/* global document, getComputedStyle */
import { createApp, h } from "vue";
import { ConfigProvider, Form, FormItem } from "antdv-next";
import enUS from "antdv-next/locale/en_US";
import zhCN from "antdv-next/locale/zh_CN";
import "./shared/styles/style.css";
import App from "./app/App.vue";
import { router } from "./app/router.js";
import { i18n, setLocale } from "./shared/i18n/index.js";

const tokens = getComputedStyle(document.documentElement);
setLocale(i18n.global.locale.value);
const token = (name) => tokens.getPropertyValue(name).trim();
const theme = {
  token: {
    colorPrimary: token("--accent"),
    colorPrimaryHover: token("--accent-hover") || token("--accent"),
    colorPrimaryActive: token("--accent-active") || token("--accent"),
    colorText: token("--ink"),
    colorTextSecondary: token("--muted"),
    colorBorder: token("--field-border"),
    colorBgContainer: token("--surface"),
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

createApp({
  render: () => h(ConfigProvider, { theme, locale: i18n.global.locale.value === "en" ? enUS : zhCN }, { default: () => h(App) }),
})
  .use(router)
  .use(i18n)
  .component("AForm", Form)
  .component("AFormItem", FormItem)
  .mount("#app");
