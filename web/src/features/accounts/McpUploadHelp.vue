<script setup>
import { computed, ref } from "vue";
import { CopyOutlined } from "@antdv-next/icons";
const props = defineProps({ origin: { type: String, required: true } });
defineEmits(["copy"]);
const language = ref("curl");
const shell = computed(() => [
  '# 将 create_upload_token 返回的 uploadToken 放入临时环境变量 DEVLOOM_UPLOAD_TOKEN。',
  '# PROJECT_ID 从 list_projects 获取；每个文件生成一个 UUIDv4 上传标识。',
  'curl --fail-with-body --request POST \\',
  '  "' + props.origin + '/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png" \\',
  '  --header "Authorization: Bearer $DEVLOOM_UPLOAD_TOKEN" \\',
  '  --header "Idempotency-Key: <UPLOAD_UUID>" \\',
  '  --header "Content-Type: image/png" \\',
  '  --data-binary "@screenshot.png"',
].join("\n"));
const powershell = computed(() => [
  '$uploadId = [guid]::NewGuid().ToString() # 重试同一文件时保留这个值',
  '$uploadHeaders = @{',
  '  Authorization = "Bearer $env:DEVLOOM_UPLOAD_TOKEN"',
  '  "Idempotency-Key" = $uploadId',
  '}',
  '$uploadUrl = "' + props.origin + '/api/mcp/projects/<PROJECT_ID>/uploads?name=screenshot.png"',
  'Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -ContentType "image/png" -InFile ".\\screenshot.png"',
].join("\n"));
const issueExample = JSON.stringify({ projectId: "<PROJECT_ID>", requestId: "<CREATE_UUID>", type: "bug", title: "登录后出现错误",
  description: "复现截图：\n![错误截图](attachment:<ATTACHMENT_ID>)", attachmentIds: ["<ATTACHMENT_ID>"],
  businessOwnerId: "<业务负责人ID>", qaOwnerId: "<测试负责人ID>", acceptanceOwnerId: "<业务验收人ID>", acceptanceCriteria: ["错误不再出现", "登录成功后进入首页"], developerId: "<开发负责人ID>", watcherIds: ["<关注人用户ID>"] }, null, 2);
const uploadCommand = computed(() => language.value === "curl" ? shell.value : powershell.value);
</script>
<template>
  <section class="mcp-upload-help" :aria-label="$t('HTTP 上传说明')">
    <div><h3>{{ $t("1. 通过 MCP 申请临时上传 Token") }}</h3><p class="field-hint">{{ $t("先用 list_projects 获取项目 ID，再调用 create_upload_token。MCP Token 需拥有 files.upload 权限。") }}</p><pre class="mcp-code"><code>{{ JSON.stringify({ projectId: "&lt;PROJECT_ID&gt;" }, null, 2) }}</code></pre><p class="field-hint">{{ $t("返回 uploadToken、uploadPath 和 expiresAt。临时 Token 仅限指定项目上传，最长有效 24 小时，不晚于 MCP Token 到期；原 Token 撤销后同步失效。") }}</p></div>
    <div><h3>{{ $t("2. 使用临时 Token 上传附件") }}</h3><p class="field-hint">{{ $t("附件上传接口只接受临时上传 Token。将 uploadToken 放入 DEVLOOM_UPLOAD_TOKEN，使用 HTTP POST 上传文件原始二进制。") }}</p></div>
    <div class="mcp-row mcp-between"><div class="mcp-segments" role="group" :aria-label="$t('上传命令语言')"><button v-for="name in ['curl', 'PowerShell']" :key="name" type="button" :aria-pressed="language === name" @click="language = name">{{ name }}</button></div><button type="button" class="text-button" :aria-label="$t('复制上传示例')" @click="$emit('copy', uploadCommand)"><CopyOutlined aria-hidden="true" /></button></div>
    <pre class="mcp-code"><code>{{ uploadCommand }}</code></pre>
    <div><h3>{{ $t("3. 引用附件，发布需求或 Bug") }}</h3><p class="field-hint">{{ $t("响应包含") }} <code>attachmentId</code> {{ $t("和") }} <code>markdown</code>{{ $t("。在正文引用附件，同时把 ID 放入") }} <code>attachmentIds</code>{{ $t("。调用") }} <code>create_issue</code> {{ $t("发布，或用") }} <code>update_issue</code> {{ $t("补充附件。") }}</p></div>
    <pre class="mcp-code"><code>[附件说明](attachment:&lt;ATTACHMENT_ID&gt;)</code></pre>
    <details><summary>{{ $t("发布 Bug 的完整 MCP 参数") }}</summary><pre class="mcp-code"><code>{{ issueExample }}</code></pre><p class="field-hint">{{ $t("业务负责人、测试负责人和业务验收人必填；验收标准以数组逐条填写。版本用 releaseId 指定。") }}</p></details>
    <p class="field-hint">{{ $t("支持图片、文本、PDF、Office 等文件；单个最多 10 MiB，每次最多 20 个、合计 20 MiB。暂存附件 24 小时有效，每人暂存最多 100 MiB。文件名需 URL 编码。") }}</p>
    <p class="field-hint">{{ $t("PNG、JPEG、WebP 直接作为图片输入；其他附件向 Codex 提供本地路径，是否能解析取决于运行环境中的工具。") }}</p>
    <details><summary>{{ $t("上传重试与指派规则") }}</summary><p class="field-hint">{{ $t("每个文件生成一个 UUIDv4 作为 Idempotency-Key，上传超时后使用相同标识和相同文件重试。发布超时后保留 requestId 和全部原参数，可调用 get_request_result 查询。上传失败或已过期时先处理附件，不要省略后发布。") }}</p><p class="field-hint">{{ $t("一名开发负责人和多名关注人。负责人需有项目开发资格；创建与指派不会自动启动开发。") }}</p></details>
  </section>
</template>
