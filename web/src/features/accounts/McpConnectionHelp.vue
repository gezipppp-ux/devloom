<script setup>
import { computed, ref } from "vue";
import { CopyOutlined, LinkOutlined } from "@antdv-next/icons";
const props = defineProps({ origin: { type: String, required: true } });
defineEmits(["copy"]);
const client = ref("Codex"), endpoint = computed(() => new URL("/mcp", props.origin).href);
const configuration = computed(() => {
  if (client.value === "Codex") return '[mcp_servers.web_coding]\nurl = "' + endpoint.value + '"\nbearer_token_env_var = "WEB_CODING_TOKEN"';
  if (client.value === "Claude Code") return JSON.stringify({ mcpServers: { web_coding: { type: "http", url: endpoint.value, headers: { Authorization: "Bearer $" + "{WEB_CODING_TOKEN}" } } } }, null, 2);
  return '传输协议：Streamable HTTP\n服务地址：' + endpoint.value + '\n认证请求头：Authorization: Bearer <TOKEN>';
});
const verify = computed(() => 'curl --fail-with-body "' + props.origin + '/api/mcp/whoami" --header "Authorization: Bearer $WEB_CODING_TOKEN"');
</script>
<template>
  <section class="mcp-card mcp-connection" :aria-label="$t('连接你的 Agent')">
    <header class="mcp-row mcp-between"><h3>{{ $t("连接你的 Agent") }}</h3><span class="field-hint">Streamable HTTP</span></header>
    <div class="mcp-endpoint"><LinkOutlined aria-hidden="true" /><input :value="endpoint" :aria-label="$t('MCP 地址')" readonly /><button type="button" class="text-button" :aria-label="$t('复制 MCP 地址')" @click="$emit('copy', endpoint)"><CopyOutlined aria-hidden="true" /></button></div>
    <div class="mcp-row mcp-between"><div class="mcp-segments" role="group" :aria-label="$t('客户端配置')"><button v-for="name in ['Codex', 'Claude Code', 'Pi']" :key="name" type="button" :aria-pressed="client === name" @click="client = name">{{ name }}</button></div><button type="button" class="text-button" :aria-label="$t('复制客户端配置')" @click="$emit('copy', configuration)"><CopyOutlined aria-hidden="true" /></button></div>
    <pre class="mcp-code"><code>{{ configuration }}</code></pre>
    <p v-if="client === 'Pi'" class="field-hint">{{ $t("在 Pi 使用的 MCP 扩展中配置以上连接参数；配置字段和环境变量写法以该扩展为准。") }}</p>
    <p v-else class="field-hint">{{ $t("放入客户端个人配置，并让客户端进程读取环境变量") }} <code>WEB_CODING_TOKEN</code>。</p>
    <details><summary>{{ $t("验证身份与凭证说明") }}</summary><p class="field-hint">{{ $t("所有用户使用同一地址，通过个人 Token 识别身份。连接后调用") }} <code>whoami</code> {{ $t("验证，或使用下方 HTTP 请求。") }}</p><pre class="mcp-code"><code>{{ verify }}</code></pre><p class="field-hint">{{ $t("Token 只在创建时完整显示。可复制完整配置提示词给你选择的 Agent，让它保存到客户端凭据配置或本地环境变量。不要写入项目文件、Skills、日志或 URL。") }}</p></details>
  </section>
</template>
