<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
import { PlusOutlined, SearchOutlined, ReloadOutlined } from "@antdv-next/icons";
import PageHeader from "../../shared/components/PageHeader.vue";
import ModalDialog from "../../shared/components/ModalDialog.vue";
import EmptyState from "../../shared/components/EmptyState.vue";
import ProjectCard from "./ProjectCard.vue";
const emit = defineEmits(["open"]);
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi("/projects"));
const creating = ref(false);
const search = ref("");
const form = reactive({ name: "", description: "", remoteUrl: "" });
const projects = computed(() => data.value?.projects || []);
const filtered = computed(() => projects.value.filter(project => `${project.name} ${project.description}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const administrator = computed(() => accountSession.user?.role === "admin");
function create() { return save("/projects", { name: form.name, description: form.description, remoteUrl: form.remoteUrl }, result => { creating.value = false; emit("open", result.project.id); }, "项目已创建。"); }
</script>
<template>
  <section class="page-layout project-page">
    <PageHeader :title="$t('项目')" :description="$t('将想法、协作与代码，放在同一个上下文里。')"><button v-if="data?.canCreateProjects" class="primary" :disabled="saving" @click="creating = true"><PlusOutlined aria-hidden="true" />{{ $t('新建项目') }}</button></PageHeader>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection v-if="data?.isAdmin && !projects.length" :title="$t(&quot;首次使用准备清单&quot;)">
      <p class="field-hint">{{ $t("管理员可以直接创建和管理项目。为参与者配置部门和项目分工后，再按需准备开发环境。") }}</p>
      <ol class="project-setup-list">
        <li>{{ data.setup?.hasDepartments ? $t("已配置部门") : $t("待配置部门") }}：<RouterLink to="/departments">{{ $t("设置部门可用功能") }}</RouterLink>{{ $t("，为负责人开放查看、配置和成员管理。") }}</li>
        <li><RouterLink to="/accounts">{{ $t("为参与者分配部门") }}</RouterLink>{{ $t("；管理员无需部门或额外授权即可开发。") }}</li>
        <li><RouterLink to="/system">{{ $t("检查成员目录基础路径") }}</RouterLink>{{ $t("，用于之后准备个人开发空间。") }}</li>
      </ol>
    </FormSection>
    <ModalDialog :open="creating" :title="$t('创建项目')" @close="!saving && (creating = false)">
      <form class="project-form" @submit.prevent="create"><label>{{ $t("项目名称") }}<input v-model="form.name" :disabled="saving" required maxlength="80" /></label><label>{{ $t("项目说明") }}<textarea v-model="form.description" :disabled="saving" rows="3" maxlength="8000" /></label>
        <label>{{ $t("Git 仓库地址") }}<input v-model="form.remoteUrl" :aria-label="$t(&quot;Git 仓库地址&quot;)" required :disabled="saving" placeholder="https://git.example.com/team/repository.git" aria-describedby="project-repository-hint" /><small id="project-repository-hint" class="field-hint">{{ $t("新建项目即引入一个 Git 仓库。支持 HTTP(S) 或 SSH 克隆地址，请勿填写密码或令牌；个人 Git 账号在开发空间中配置。") }}</small></label>
        <p class="field-hint">{{ administrator ? $t("管理员创建后拥有全部项目权限，可直接维护事项、资产并准备本人的开发空间。") : $t("创建者初始仅有查看项目、项目配置和成员管理权限。创建后请先到“成员”设置本人及参与者的工作内容组合，再维护事项或准备开发空间。") }}</p><div class="actions"><button type="submit" class="primary" :disabled="saving">{{ saving ? $t("正在创建…") : $t("保存项目") }}</button><button type="button" :disabled="saving" @click="creating = false">{{ $t("取消") }}</button></div>
      </form>
    </ModalDialog>
    <div class="ui-list-toolbar"><label class="ui-compact-search"><SearchOutlined aria-hidden="true" /><input v-model="search" type="search" :aria-label="$t('搜索项目')" :placeholder="$t('搜索项目')" /></label><span class="ui-toolbar-spacer" /><span v-if="data" class="muted small">{{ $t('{count} 个可访问项目', { count: projects.length }) }}</span><button class="ui-icon-button" :aria-label="$t('刷新')" :title="$t('刷新')" :disabled="loading" @click="reload"><ReloadOutlined aria-hidden="true" /></button></div>
    <p v-if="loading" role="status">{{ $t("正在读取项目…") }}</p>
    <div v-else-if="filtered.length" class="project-grid"><ProjectCard v-for="(project, index) in filtered" :key="project.id" :project="project" :index="index" @open="emit('open', $event)" /></div>
    <EmptyState v-else-if="search" :title="$t('暂无匹配项目')" :description="$t('试试其他关键词。')" />
    <div v-else-if="!error" class="project-empty"><h2>{{ data?.canCreateProjects ? $t("开始第一个项目") : $t("尚未分配项目") }}</h2><p>{{ data?.canCreateProjects ? $t("点击“创建项目”，填写项目信息和 Git 仓库地址后设置成员分工。") : $t("项目负责人添加你为成员并授予查看项目后，项目会显示在这里。") }}</p></div>
  </section>
</template>
