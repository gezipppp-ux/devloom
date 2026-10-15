<script>
/* global document */
import {
  defineComponent,
  Fragment,
  h,
  onMounted,
  onUnmounted,
  onUpdated,
  ref,
} from "vue";
import { Select } from "antdv-next";
import { CheckOutlined } from "@antdv-next/icons";
import { translate } from "../i18n/index.js";
import { filterPinyinOption } from "./pinyin-search.js";
import "../styles/select.css";

function textOf(children) {
  if (Array.isArray(children))
    return children
      .map((child) =>
        typeof child === "object" ? textOf(child.children) : child,
      )
      .join("");
  return typeof children === "string" || typeof children === "number"
    ? String(children)
    : "";
}
function slotOptions(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === Fragment) return slotOptions(node.children || []);
    if (node.type === "optgroup")
      return [
        { label: node.props?.label, options: slotOptions(node.children || []) },
      ];
    if (node.type !== "option") return [];
    const label = textOf(node.children).replace(/\s+/g, " ").trim();
    return [
      {
        value: Object.hasOwn(node.props || {}, "value")
          ? node.props.value
          : label,
        label,
        disabled: node.props?.disabled === "" || Boolean(node.props?.disabled),
        selected: Boolean(node.props?.selected),
      },
    ];
  });
}

export default defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { default: undefined },
    value: { default: undefined },
    options: { type: Array, default: undefined },
    multiple: Boolean,
    disabled: Boolean,
    required: Boolean,
    nativeEvents: Boolean,
    toolbar: Boolean,
    iconOnly: Boolean,
    searchPinyin: Boolean,
  },
  emits: ["update:modelValue", "update:value", "change"],
  setup(props, { attrs, slots, emit, expose }) {
    const root = ref(),
      select = ref(),
      invalid = ref(false),
      fieldsetDisabled = ref(false),
      expanded = ref(false);
    let observer;
    function escape(event) {
      if (event.key !== "Escape" || !expanded.value) return;
      event.preventDefault();
      event.stopPropagation();
      expanded.value = false;
      select.value?.focus();
    }
    function openWithKeyboard(event) {
      if (
        expanded.value ||
        props.disabled ||
        fieldsetDisabled.value ||
        !["ArrowDown", "ArrowUp"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      expanded.value = true;
    }
    // The library forwards ARIA attributes to its outer div, not its input.
    // Keep the actual combobox labelled without replacing the library input.
    function syncInputAttributes() {
      const input = root.value?.querySelector("input[role=combobox]");
      if (!input) return;
      for (const name of [
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "aria-required",
        "aria-invalid",
      ]) {
        const value =
          name === "aria-required"
            ? props.required || attrs[name]
            : name === "aria-invalid"
              ? invalid.value || attrs[name]
              : attrs[name];
        if (value === undefined || value === false) input.removeAttribute(name);
        else input.setAttribute(name, String(value));
      }
    }
    onMounted(syncInputAttributes);
    onUpdated(syncInputAttributes);
    onMounted(() => {
      document.addEventListener("keydown", escape, true);
      const fieldsets = [];
      for (
        let parent = root.value?.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.tagName === "FIELDSET") fieldsets.push(parent);
      const sync = () => {
        fieldsetDisabled.value = fieldsets.some(
          (fieldset) => fieldset.disabled,
        );
      };
      sync();
      if (fieldsets.length) {
        observer = new document.defaultView.MutationObserver(sync);
        for (const fieldset of fieldsets)
          observer.observe(fieldset, {
            attributes: true,
            attributeFilter: ["disabled"],
          });
      }
    });
    onUnmounted(() => {
      observer?.disconnect();
      document.removeEventListener("keydown", escape, true);
    });
    expose({
      focus: () => select.value?.focus(),
      blur: () => select.value?.blur(),
    });
    return () => {
      const options = props.options || slotOptions(slots.default?.() || []);
      const flat = options.flatMap((option) => option.options || [option]);
      const multiple = props.multiple || attrs.mode === "multiple";
      const selected =
        props.modelValue !== undefined
          ? props.modelValue
          : props.value !== undefined
            ? props.value
            : multiple
              ? flat
                  .filter((option) => option.selected)
                  .map((option) => option.value)
              : props.nativeEvents
                ? flat[0]?.value
                : undefined;
      const values = multiple ? selected || [] : [selected];
      const disabled = props.disabled || fieldsetDisabled.value;
      const change = (value, option) => {
        if (disabled || root.value?.closest("fieldset:disabled")) return;
        invalid.value = false;
        emit("update:modelValue", value);
        emit("update:value", value);
        emit(
          "change",
          props.nativeEvents
            ? {
                target: {
                  value,
                  selectedOptions: (Array.isArray(value) ? value : [value]).map(
                    (value) => ({ value }),
                  ),
                },
              }
            : value,
          option,
        );
      };
      const renderOption = ({ option }) => {
        const entry = option.data;
        return h(
          "span",
          {
            class: "app-select-option",
            "data-value": String(entry.value ?? ""),
          },
          [
            entry.icon ? h(entry.icon, { "aria-hidden": true }) : null,
            h("span", { class: "app-select-option-copy" }, [
              h("span", entry.label),
              entry.description ? h("small", entry.description) : null,
            ]),
            h(CheckOutlined, {
              class: [
                "app-select-check",
                { "is-selected": values.includes(entry.value) },
              ],
              "aria-hidden": true,
            }),
          ],
        );
      };
      const hasValue = multiple
        ? values.length > 0
        : selected !== undefined && selected !== null && selected !== "";
      const selectAttributes = Object.fromEntries(
        Object.entries(attrs).filter(([name]) => !name.startsWith("aria-")),
      );
      return h(
        "span",
        {
          ref: root,
          onKeydownCapture: openWithKeyboard,
          "data-value": JSON.stringify(selected ?? ""),
          class: [
            "app-select",
            attrs.class,
            {
              "app-select-toolbar": props.toolbar,
              "app-select-icon": props.iconOnly,
            },
          ],
          style: attrs.style,
        },
        [
          h(
            Select,
            {
              ...selectAttributes,
              ...(props.searchPinyin
                ? {
                    showSearch: { filterOption: filterPinyinOption },
                    notFoundContent: translate("没有匹配选项"),
                  }
                : {}),
              ref: select,
              class: "app-select-control",
              style: undefined,
              value: selected,
              options: options.filter(
                (option) => option.value !== undefined || option.options,
              ),
              mode: multiple ? "multiple" : attrs.mode,
              disabled,
              virtual: false,
              open: !disabled && expanded.value,
              onOpenChange: (value) => {
                expanded.value = value;
                attrs.onOpenChange?.(value);
              },
              variant: props.toolbar ? "borderless" : attrs.variant,
              popupMatchSelectWidth: false,
              classes: { popup: { root: "app-select-popup" } },
              getPopupContainer: (trigger) =>
                trigger.closest("dialog[open], [popover]:popover-open") || document.body,
              placeholder:
                attrs.placeholder ||
                flat.find((option) => option.value === undefined)?.label,
              onChange: change,
              popupRender: (originNode) =>
                h("div", [
                  originNode,
                  slots.footer
                    ? h("div", { class: "app-select-footer" }, slots.footer())
                    : props.searchPinyin
                      ? h("div", { class: "app-select-footer app-select-search-hint" }, translate("输入姓名、用户名、拼音或首字母搜索"))
                      : null,
                ]),
              ...(props.iconOnly
                ? {
                    suffixIcon: null,
                    labelRender: () => {
                      const option = flat.find(
                        (option) => option.value === selected,
                      );
                      return option?.icon
                        ? h(option.icon, { "aria-hidden": true })
                        : option?.label;
                    },
                  }
                : {}),
            },
            {
              ...slots,
              default: undefined,
              optionRender: slots.optionRender || renderOption,
            },
          ),
          props.required
            ? h("input", {
                class: "app-select-validation",
                tabindex: -1,
                "aria-hidden": true,
                required: true,
                disabled,
                value: hasValue ? "selected" : "",
                onInvalid: (event) => {
                  event.preventDefault();
                  invalid.value = true;
                  select.value?.focus();
                },
              })
            : null,
          invalid.value
            ? h(
                "span",
                { class: "field-hint error", role: "alert" },
                translate("请选择"),
              )
            : null,
        ],
      );
    };
  },
});
</script>
