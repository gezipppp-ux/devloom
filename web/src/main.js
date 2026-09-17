/* global document, getComputedStyle */
import { createApp, h } from "vue";
import { ConfigProvider, Form, FormItem } from "antdv-next";
import App from "./app/App.vue";
import "./shared/styles/style.css";

const tokens = getComputedStyle(document.documentElement);
const token = (name) => tokens.getPropertyValue(name).trim();
const theme = {
  token: {
    colorPrimary: token("--accent"),
    colorText: token("--ink"),
    colorTextSecondary: token("--muted"),
    colorBorder: token("--field-border"),
    colorBgContainer: token("--surface"),
    colorError: token("--danger"),
    borderRadius: Number.parseInt(token("--radius-control"), 10),
    controlHeight: Number.parseInt(token("--control-height"), 10),
    fontSize: 14,
    fontFamily: token("--font-ui"),
  },
};

createApp({
  render: () => h(ConfigProvider, { theme }, { default: () => h(App) }),
})
  .component("AForm", Form)
  .component("AFormItem", FormItem)
  .mount("#app");
