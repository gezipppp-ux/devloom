<script setup>
import FeedbackMessage from "../../shared/components/FeedbackMessage.vue";
import { computed, reactive, ref } from "vue";
import { appApi } from "../../shared/api/api.js";
import { accountSession } from "../../shared/api/account-session.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
const emit = defineEmits(["open"]);
const { data, loading, saving, error, notice, reload, save } = useResource(() => appApi("/projects"));
const creating = ref(false);
const form = reactive({ name: "", description: "", remoteUrl: "" });
const projects = computed(() => data.value?.projects || []);
const administrator = computed(() => accountSession.user?.role === "admin");
function create() { return save("/projects", { name: form.name, description: form.description, remoteUrl: form.remoteUrl }, result => { creating.value = false; emit("open", result.project.id); }, "项目已创建。"); }
</script>
<template>
  <section class="page-layout project-page">
    <header class="page-heading project-heading"><div><div class="eyebrow">PROJECTS</div><h1>{{ administrator ? '全部项目' : '我的项目' }}</h1><p class="muted">{{ administrator ? '管理全部项目的成员、配置和协作内容；开发操作按项目授权开放。' : '需求、Bug 和交付在项目中协作，开发空间按权限分配。' }}</p></div><div class="actions"><button :disabled="loading" @click="reload">刷新</button><button v-if="data?.canCreateProjects" class="primary" :disabled="saving" @click="creating = !creating">创建项目</button></div></header>
    <FeedbackMessage :message="error" type="error" /><FeedbackMessage :message="notice" type="success" />
    <FormSection v-if="data?.isAdmin && !projects.length" title="首次使用准备清单">
      <p class="field-hint">管理员可以直接创建和管理项目。为参与者配置部门和项目分工后，再按需准备开发环境。</p>
      <ol class="project-setup-list">
        <li>{{ data.setup?.hasDepartments ? '已配置部门' : '待配置部门' }}：<RouterLink to="/departments">设置部门可用功能</RouterLink>，为负责人开放查看、配置和成员管理。</li>
        <li><RouterLink to="/accounts">为参与者分配部门</RouterLink>；管理员本人需要开发时，也需分配有效部门并获得项目开发权限。</li>
        <li><RouterLink to="/system">检查成员目录基础路径</RouterLink>，用于之后准备个人开发空间。</li>
      </ol>
    </FormSection>
    <FormSection v-if="creating" title="创建项目">
      <form class="project-form" @submit.prevent="create"><label>项目名称<input v-model="form.name" :disabled="saving" required maxlength="80" /></label><label>项目说明<textarea v-model="form.description" :disabled="saving" rows="3" maxlength="8000" /></label>
        <label>Git 仓库地址<input v-model="form.remoteUrl" aria-label="Git 仓库地址" required :disabled="saving" placeholder="https://git.example.com/team/repository.git" aria-describedby="project-repository-hint" /><small id="project-repository-hint" class="field-hint">新建项目即引入一个 Git 仓库。支持 HTTP(S) 或 SSH 克隆地址，请勿填写密码或令牌；个人 Git 账号在开发空间中配置。</small></label>
        <p class="field-hint">{{ administrator ? '创建后可直接维护需求、Bug 和普通资产。请到“成员”分配参与者；本人需要开发时也须取得相应部门和项目权限。' : '创建者初始仅有查看项目、项目配置和成员管理权限。创建后请先到“成员”设置本人及参与者的工作内容组合，再维护事项或准备开发空间。' }}</p><div class="actions"><button type="submit" class="primary" :disabled="saving">{{ saving ? '正在创建…' : '保存项目' }}</button><button type="button" :disabled="saving" @click="creating = false">取消</button></div>
      </form>
    </FormSection>
    <p v-if="loading" role="status">正在读取项目…</p>
    <div v-else-if="projects.length" class="project-grid"><button v-for="project in projects" :key="project.id" class="project-card" @click="emit('open', project.id)"><span class="muted">{{ project.status === 'archived' ? '已归档' : '进行中' }}</span><strong>{{ project.name }}</strong><span>{{ project.description || '尚未填写项目说明' }}</span><small>{{ project.remoteUrl }}</small></button></div>
    <div v-else-if="!error" class="project-empty"><h2>{{ data?.canCreateProjects ? '开始第一个项目' : '尚未分配项目' }}</h2><p>{{ data?.canCreateProjects ? '点击“创建项目”，填写项目信息和 Git 仓库地址后设置成员分工。' : '项目负责人添加你为成员并授予查看项目后，项目会显示在这里。' }}</p></div>
  </section>
</template>
