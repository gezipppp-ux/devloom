/* global localStorage, document */
import {createI18n} from "vue-i18n";
import {en} from "./en.js";

const key = "web-coding.locale";
// Literal message functions keep URLs, @ and code examples intact. Only named
// placeholders in our UI messages are interpolated; user content is never compiled.
const messages = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, context => value.replace(/(?<![{$])\{([a-zA-Z]\w*)\}(?!})/g, (match, name) => String(context.named(name) ?? match))]));

function savedLocale() {
    try {
        return localStorage.getItem(key) === "en" ? "en" : "zh-CN";
    } catch {
        return "zh-CN";
    }
}

export const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: savedLocale(),
    fallbackLocale: "zh-CN",
    missingWarn: false,
    fallbackWarn: false,
    messages: {en: messages(en), "zh-CN": messages(Object.fromEntries(Object.keys(en).map(key => [key, key])))},
    messageResolver: (messages, path) => messages[path] ?? null,
});

export function translate(value, params) {
    return typeof value === "string" && i18n.global.te(value) ? i18n.global.t(value, params || {}) : value;
}

export function setLocale(value) {
    if (!["zh-CN", "en"].includes(value)) return;
    i18n.global.locale.value = value;
    document.documentElement.lang = value;
    try {
        localStorage.setItem(key, value);
    } catch { /* Device preference is optional. */
    }
}

export function formatDate(value, options = {}) {
    if (!value) return "—";
    const date = new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(i18n.global.locale.value, {
        year: "numeric",
        month: "short",
        day: "numeric", ...options
    }).format(date);
}

export function formatNumber(value) {
    return new Intl.NumberFormat(i18n.global.locale.value).format(value);
}
