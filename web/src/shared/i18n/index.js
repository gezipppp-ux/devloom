/* global localStorage, document, navigator, window */
import { readonly, ref } from "vue";
import {createI18n} from "vue-i18n";
import {en} from "./en.js";

const key = "web-coding.locale";
// Literal message functions keep URLs, @ and code examples intact. Only named
// placeholders in our UI messages are interpolated; user content is never compiled.
const messages = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, context => value.replace(/(?<![{$])\{([a-zA-Z]\w*)\}(?!})/g, (match, name) => String(context.named(name) ?? match))]));

function normalizePreference(value) {
    return ["zh-CN", "en"].includes(value) ? value : "auto";
}

function savedLocale() {
    try {
        return normalizePreference(localStorage.getItem(key));
    } catch {
        return "auto";
    }
}

function browserLocale() {
    const language = typeof navigator === "undefined" ? "en" : navigator.languages?.[0] || navigator.language || "en";
    return /^zh(?:[-_]|$)/i.test(language) ? "zh-CN" : "en";
}

const preference = ref(savedLocale());
export const localePreference = readonly(preference);
const resolvedLocale = () => preference.value === "auto" ? browserLocale() : preference.value;

export const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: resolvedLocale(),
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
    if (!["auto", "zh-CN", "en"].includes(value)) return;
    preference.value = value;
    applyLocale();
    try {
        localStorage.setItem(key, value);
    } catch { /* Device preference is optional. */
    }
}

function applyLocale() {
    const locale = resolvedLocale();
    i18n.global.locale.value = locale;
    document.documentElement.lang = locale;
}

export function initializeLocale() {
    setLocale(preference.value);
    const languageChanged = () => { if (preference.value === "auto") applyLocale(); };
    const storageChanged = event => {
        if (event.key !== key && event.key !== null) return;
        try { if (event.storageArea !== localStorage) return; } catch { return; }
        preference.value = normalizePreference(event.newValue);
        applyLocale();
    };
    window.addEventListener("languagechange", languageChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
        window.removeEventListener("languagechange", languageChanged);
        window.removeEventListener("storage", storageChanged);
    };
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
