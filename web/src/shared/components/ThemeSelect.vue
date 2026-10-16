<script setup>
import { DesktopOutlined, MoonOutlined, SunOutlined } from "@antdv-next/icons";
import { themePreference, setThemePreference } from "../styles/theme.js";
import ToolbarSelect from "./ToolbarSelect.vue";
defineProps({ iconOnly: { type: Boolean, default: true } });

const options = [
  { value: "system", label: "跟随系统", icon: DesktopOutlined },
  { value: "light", label: "浅色模式", icon: SunOutlined },
  { value: "dark", label: "暗色模式", icon: MoonOutlined },
];
</script>

<template>
  <ToolbarSelect
    class="ui-theme-select"
    :label="$t('外观主题')"
    :model-value="themePreference"
    :options="options.map((option) => ({ ...option, label: $t(option.label) }))"
    :icon-only="iconOnly"
    align-end
    @update:model-value="setThemePreference"
  />
</template>
