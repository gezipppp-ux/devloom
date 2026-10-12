<script setup>
import { computed, reactive, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { useResource } from "../../shared/api/use-resource.js";
import FormSection from "../../shared/components/FormSection.vue";
const emit = defineEmits(["open"]);
const { data, loading, saving, error, notice, reload, save } = useResource(async () => {
  const result = await appApi("/projects");
  if (result.canCreateProjects) result.repositories = (await appApi("/project-repositories")).repositories;
  return result;
});
const creating = ref(false);
const form = reactive({ name: "", description: "", departmentId: "", repositoryId: "" });
watch(() => data.value?.departmentId, id => { if (!form.departmentId) form.departmentId = id || ""; });
const projects = computed(() => data.value?.projects || []);
function create() { return save("/projects", { ...form }, result => { creating.value = false; emit("open", result.project.id); }, "项目已创建。"); }
</script>
<template>
  <section class="project-page">
    <header class="project-heading"><div><div class="eyebrow">PROJECTS</div><h1>我的项目</h1><p class="muted">需求、Bug 和交付在项目中协作，开发空间按权限分配。</p></div><div class="actions"><button :disabled="loading" @click="reload">刷新</button><button v-if="data?.canCreateProjects" class="primary" @click="creating = !creating">创建项目</button></div></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="success" role="status">{{ notice }}</p>
    <FormSection v-if="data?.isAdmin && !projects.length" title="首次使用准备清单">
      <p class="field-hint">系统管理员负责配置可用功能；参与项目仍需本人所属部门和项目授权共同允许。</p>
      <ol class="project-setup-list">
        <li>{{ data.setup?.hasDepartments ? '已配置部门' : '待配置部门' }}：<RouterLink to="/departments">设置部门可用功能</RouterLink>，为负责人开放查看、配置和成员管理。</li>
        <li>{{ data.setup?.departmentAssigned ? '本人已分配部门' : '本人尚未分配有效部门' }}：<RouterLink to="/accounts">检查账号归属部门</RouterLink>。</li>
        <li>{{ data.setup?.hasRepositories ? '已有启用仓库' : '尚无启用仓库' }}：<RouterLink to="/repositories">登记项目仓库</RouterLink>。</li>
        <li><RouterLink to="/system">检查成员目录基础路径</RouterLink>，用于之后准备个人开发空间。</li>
      </ol>
    </FormSection>
    <div v-if="data?.isAdmin && !data.canCreateProjects" class="project-empty"><h2>创建项目的准备条件</h2><p v-for="reason in data.creationReadiness?.reasons" :key="reason">{{ reason }}</p><p v-if="!data.isAdmin">已有项目请联系项目负责人添加成员；创建资格由系统管理员配置。</p></div>
    <FormSection v-if="creating" title="创建项目">
      <form class="project-form" @submit.prevent="create"><label>项目名称<input v-model="form.name" required maxlength="80" /></label><label>项目说明<textarea v-model="form.description" rows="3" maxlength="8000" /></label>
        <div class="form-columns"><label>归属部门<select aria-label="归属部门" v-model="form.departmentId" required><option value="" disabled>选择部门</option><option v-for="d in data.departments" :key="d.id" :value="d.id">{{ d.name }}</option></select></label><label>项目仓库<select aria-label="项目仓库" v-model="form.repositoryId" required><option value="" disabled>选择仓库</option><option v-for="r in data.repositories" :key="r.id" :value="r.id">{{ r.name }}</option></select></label></div>
        <p class="field-hint">创建者初始仅有查看项目、项目配置和成员管理权限。创建后请先到“成员”设置本人及参与者的工作内容组合，再维护事项或准备开发空间。</p><p v-if="!data.repositories?.length" class="error">尚无启用仓库。{{ data.isAdmin ? '请先在仓库目录登记仓库。' : '请联系系统管理员登记仓库。' }}</p><div class="actions"><button type="submit" class="primary" :disabled="saving || !data.repositories?.length">{{ saving ? '正在创建…' : '保存项目' }}</button><button type="button" :disabled="saving" @click="creating = false">取消</button></div>
      </form>
    </FormSection>
    <p v-if="loading" role="status">正在读取项目…</p>
    <div v-else-if="projects.length" class="project-grid"><button v-for="project in projects" :key="project.id" class="project-card" @click="emit('open', project.id)"><span class="muted">{{ project.department?.name }} · {{ project.status === 'archived' ? '已归档' : '进行中' }}</span><strong>{{ project.name }}</strong><span>{{ project.description || '尚未填写项目说明' }}</span><small>{{ project.repository?.name }}</small></button></div>
    <div v-else-if="!error" class="project-empty"><h2>{{ data?.canCreateProjects ? '开始第一个项目' : '尚未分配项目' }}</h2><p>{{ data?.canCreateProjects ? '点击“创建项目”，选择部门和仓库后设置成员分工。' : '项目负责人添加你为成员并授予查看项目后，项目会显示在这里。' }}</p></div>
  </section>
</template>
