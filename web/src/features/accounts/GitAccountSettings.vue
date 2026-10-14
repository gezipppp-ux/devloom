<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { ReloadOutlined } from "@antdv-next/icons";
import FormSection from "../../shared/components/FormSection.vue";
import { useGitAccounts } from "./use-git-accounts.js";
const {
  accounts,
  form,
  loading,
  saving,
  checking,
  provider,
  generating,
  deleting,
  busy,
  ready,
  error,
  notice,
  deleteId,
  edit,
  load,
  save,
  verify,
  generate,
  remove,
  changeAuthType,
} = useGitAccounts();
</script>

<template>
  <FormSection
    id="git-accounts"
    class="git-account-settings"
    :title="$t(&quot;Git 账号&quot;)"
    :description="$t(&quot;维护个人 Git 账号，可直接验证主机登录，无需选择项目。开发空间准备时检测项目仓库的实际访问权限。&quot;)"
  >
    <template #action
      ><button type="button" class="text-button" :disabled="busy" @click="load">
        <ReloadOutlined aria-hidden="true" />{{ $t("刷新账号") }}
      </button></template
    >
    <p v-if="loading" class="muted" role="status">{{ $t("正在加载 Git 账号…") }}</p>
    <div
      v-else-if="accounts.length"
      class="account-list"
      :aria-label="$t(&quot;已保存 Git 账号&quot;)"
    >
      <div
        v-for="account in accounts"
        :key="account.id"
        class="account-list-row"
      >
        <div class="account-list-identity">
          <strong>{{ account.name }}</strong
          ><span class="muted">{{
            account.authType === "ssh" ? $t("SSH 密钥") : $t("HTTP/HTTPS 凭据")
          }}</span>
        </div>
        <div class="account-row-actions">
          <button
            type="button"
            :disabled="busy"
            :aria-label="$t(&quot;编辑 Git 账号：{p0}&quot;, { p0: account.name })"
            @click="edit(account)"
          >
            {{ $t("编辑") }}</button
          ><button
            type="button"
            :disabled="busy"
            :aria-label="$t(&quot;删除 Git 账号：{p0}&quot;, { p0: account.name })"
            @click="deleteId = account.id"
          >
            {{ $t("删除") }}
          </button>
        </div>
      </div>
    </div>
    <p v-else class="muted">{{ $t("尚未添加 Git 账号。") }}</p>
    <div
      v-if="deleteId"
      class="notice"
      role="group"
      :aria-label="$t(&quot;确认删除 Git 账号&quot;)"
    >
      <p>
        {{ $t("确认删除「") }}{{
          accounts.find((account) => account.id === deleteId)?.name
        }}{{ $t("」？工作区正在使用的账号不能删除。") }}
      </p>
      <div class="actions">
        <button type="button" :disabled="busy" @click="deleteId = ''">
          {{ $t("取消删除") }}</button
        ><button type="button" class="danger" :disabled="busy" @click="remove">
          {{ deleting ? $t("正在删除…") : $t("确认删除 Git 账号") }}
        </button>
      </div>
    </div>
    <a-form :model="form" layout="vertical" @finish="save">
      <a-form-item :label="$t(&quot;账号名称&quot;)" html-for="git-account-name"
        ><input
          id="git-account-name"
          v-model="form.name"
          maxlength="80"
          required
          :disabled="busy"
          :placeholder="$t(&quot;例如：公司 Git&quot;)"
      /></a-form-item>
      <a-form-item :label="$t(&quot;认证方式&quot;)" html-for="git-account-auth-type"
        ><select
          id="git-account-auth-type"
          v-model="form.authType"
          :disabled="busy"
          @change="changeAuthType"
        >
          <option value="http">{{ $t("HTTP/HTTPS · 账号密码或令牌") }}</option>
          <option value="ssh">{{ $t("SSH · 系统生成密钥") }}</option>
        </select></a-form-item
      >
      <a-form-item :label="$t(&quot;Git 主机&quot;)" html-for="git-account-host"
        ><input
          id="git-account-host"
          v-model="form.host"
          required
          :disabled="busy"
          :placeholder="form.authType === 'ssh' ? $t(&quot;例如：gitee.com&quot;) : $t(&quot;例如：https://gitee.com&quot;)"
          aria-describedby="git-account-host-hint"
        />
        <p id="git-account-host-hint" class="field-hint">
          {{ form.authType === 'ssh' ? $t("填写主机名和可选端口，例如 gitee.com，不要填写 git@gitee.com 或仓库路径。") : $t("填写完整主机地址，例如 https://gitee.com，不包含仓库路径。") }}{{ $t("项目仓库由管理员单独维护。") }}
        </p>
        </a-form-item
      >
      <template v-if="form.authType === 'http'">
        <a-form-item :label="$t(&quot;用户名&quot;)" html-for="git-account-user"
          ><input
            id="git-account-user"
            v-model="form.username"
            required
            :disabled="busy"
            autocomplete="off"
        /></a-form-item>
        <a-form-item :label="$t(&quot;密码或访问令牌&quot;)" html-for="git-account-password"
          ><input
            id="git-account-password"
            v-model="form.password"
            type="password"
            :required="!form.id"
            :disabled="busy"
            autocomplete="new-password"
          />
          <p class="field-hint">
            {{ $t("支持普通账号密码或个人访问令牌，具体由 Git 服务决定。") }}{{
              form.id
                ? $t("留空保留已保存密码。")
                : $t("凭据加密保存，不会回显。")
            }}
          </p></a-form-item
        >
      </template>
      <a-form-item v-else :label="$t(&quot;SSH 公钥&quot;)" html-for="git-account-public-key">
        <textarea
          v-if="form.publicKey"
          id="git-account-public-key"
          :value="form.publicKey"
          readonly
          rows="4"
          :aria-label="$t(&quot;SSH 公钥&quot;)"
          spellcheck="false"
          @focus="$event.target.select()"
        />
        <p class="field-hint">
          系统生成 Ed25519 密钥。请复制公钥到 Git 服务的 SSH
          密钥设置；私钥仅在服务端加密保管，不会显示或下载。替换密钥保存后生效。
        </p>
        <button type="button" :disabled="busy" @click="generate">
          {{
            generating
              ? $t("正在生成密钥…")
              : form.publicKey
                ? $t("重新生成 SSH 密钥")
                : $t("生成 SSH 密钥")
          }}
        </button>
      </a-form-item>
      <a-form-item v-if="form.authType === 'http'" :label="$t(&quot;登录验证服务&quot;)" html-for="git-login-provider">
        <select id="git-login-provider" v-model="provider" :disabled="busy" aria-describedby="git-login-hint">
          <option value="auto">{{ $t("自动识别 Gitee / GitHub / GitLab 官方主机") }}</option>
          <option value="gitee">Gitee</option>
          <option value="github">GitHub / GitHub Enterprise</option>
          <option value="gitlab">{{ $t("GitLab / 自建 GitLab") }}</option>
        </select>
        <p id="git-login-hint" class="field-hint">{{ $t("主机登录验证使用个人访问令牌，需允许读取本人资料；不支持普通密码。自建服务请选择对应类型，其他服务请在准备开发空间时验证。此选项仅用于本次验证。") }}</p>
        <p v-if="/^http:\/\//i.test(form.host.trim())" class="field-hint">{{ $t("HTTP 会以明文传输凭据，建议使用 HTTPS。") }}</p>
      </a-form-item>
      <p v-else class="field-hint">{{ $t("验证登录会使用当前公钥连接 Git 主机的 git 用户。请先将公钥添加到 Git 服务；验证不会保存或替换账号密钥。") }}</p>
      <div class="form-columns"><a-form-item :label="$t(&quot;提交作者姓名&quot;)" html-for="git-author-name"><input id="git-author-name" v-model="form.authorName" :disabled="busy" /></a-form-item><a-form-item :label="$t(&quot;提交作者邮箱&quot;)" html-for="git-author-email"><input id="git-author-email" v-model="form.authorEmail" type="email" :disabled="busy" /></a-form-item></div>
      <p class="field-hint">{{ $t("提交作者身份与 Git 登录凭据独立；不填写时沿用服务端已配置的 Git 作者身份。") }}</p>
      <FeedbackMessage :message="error" type="error" />
      <FeedbackMessage :message="notice" type="success" />
      <div class="actions">
        <button type="button" :disabled="busy" @click="edit()">{{ $t("新建账号") }}</button
        ><button type="button" :disabled="busy || !ready" @click="verify">
          {{ checking ? $t("正在验证登录…") : $t("验证登录") }}
        </button
        ><button type="submit" class="primary" :disabled="busy || !ready">
          {{ saving ? $t("正在保存…") : $t("保存 Git 账号") }}
        </button>
      </div>
    </a-form>
  </FormSection>
</template>
