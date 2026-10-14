<script setup>
import { computed, ref } from "vue";
import { CopyOutlined } from "@antdv-next/icons";
const props = defineProps({ origin: { type: String, required: true } });
defineEmits(["copy"]);
const language = ref("curl");
const shell = computed(() => [
  '# 在本地环境变量中配置 WEB_CODING_TOKEN，勿把真实 Token 写入示例文件。',
  '# PROJECT_ID 从 list_projects 获取；每个文件生成一个 UUIDv4 上传标识。',
  'curl --fail-with-body --request POST \\',
  '  "' + props.origin + '/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png" \\',
  '  --header "Authorization: Bearer $WEB_CODING_TOKEN" \\',
  '  --header "Idempotency-Key: <UPLOAD_UUID>" \\',
  '  --header "Content-Type: image/png" \\',
  '  --data-binary "@screenshot.png"',
].join("\n"));
const powershell = computed(() => [
  '$uploadId = [guid]::NewGuid().ToString() # 重试同一文件时保留这个值',
  '$uploadHeaders = @{',
  '  Authorization = "Bearer $env:WEB_CODING_TOKEN"',
  '  "Idempotency-Key" = $uploadId',
  '}',
  '$uploadUrl = "' + props.origin + '/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png"',
  'Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -ContentType "image/png" -InFile ".\\screenshot.png"',
].join("\n"));
const issueExample = JSON.stringify({ projectId: "<PROJECT_ID>", requestId: "<CREATE_UUID>", type: "bug", title: "登录后出现错误",
  description: "复现截图：\n![错误截图](attachment:<ATTACHMENT_ID>)", attachmentIds: ["<ATTACHMENT_ID>"],
  developerId: "<负责人用户ID>", watcherIds: ["<关注人用户ID>"] }, null, 2);
const uploadCommand = computed(() => language.value === "curl" ? shell.value : powershell.value);
</script>
<template>
  <section class="mcp-upload-help" :aria-label="$t('HTTP 上传说明')">
    <div><h3>{{ $t("1. 使用 Token 上传图片") }}</h3><p class="field-hint">{{ $t("通过") }} <code>list_projects</code> {{ $t("获取项目 ID。HTTP POST 上传原始二进制，使用同一枚 Token，需开启“上传图片附件”。") }}</p></div>
    <div class="mcp-row mcp-between"><div class="mcp-segments" role="group" :aria-label="$t('上传命令语言')"><button v-for="name in ['curl', 'PowerShell']" :key="name" type="button" :aria-pressed="language === name" @click="language = name">{{ name }}</button></div><button type="button" class="text-button" :aria-label="$t('复制上传示例')" @click="$emit('copy', uploadCommand)"><CopyOutlined aria-hidden="true" /></button></div>
    <pre class="mcp-code"><code>{{ uploadCommand }}</code></pre>
    <div><h3>{{ $t("2. 引用附件 ID，发布需求或 Bug") }}</h3><p class="field-hint">{{ $t("响应包含") }} <code>attachmentId</code> {{ $t("和") }} <code>markdown</code>{{ $t("。在正文引用图片，同时把 ID 放入") }} <code>attachmentIds</code>{{ $t("。调用") }} <code>create_issue</code> {{ $t("发布，或用") }} <code>update_issue</code> {{ $t("补充图片。") }}</p></div>
    <pre class="mcp-code"><code>![说明](attachment:&lt;ATTACHMENT_ID&gt;)</code></pre>
    <details><summary>{{ $t("发布 Bug 的完整 MCP 参数") }}</summary><pre class="mcp-code"><code>{{ issueExample }}</code></pre><p class="field-hint">{{ $t("没有负责人或关注人时可省略对应字段；需求使用 type: requirement，可另外填写 acceptanceCriteria。版本用 releaseId 指定。") }}</p></details>
    <p class="field-hint">{{ $t("支持 PNG、JPEG、WebP；单张最多 10 MiB，每次最多 20 张、合计 20 MiB。暂存图片 24 小时有效，每人暂存最多 100 MiB。文件名含中文或空格时需先做 URL 编码。") }}</p>
    <details><summary>{{ $t("上传重试与指派规则") }}</summary><p class="field-hint">{{ $t("每个文件生成一个 UUIDv4 作为 Idempotency-Key，上传超时后使用相同标识和相同文件重试。发布超时后保留 requestId 和全部原参数，可调用 get_request_result 查询。上传失败或已过期时先处理图片，不要省略后发布。") }}</p><p class="field-hint">{{ $t("一名开发负责人和多名关注人。负责人需有项目开发资格；创建与指派不会自动启动开发。") }}</p></details>
  </section>
</template>
