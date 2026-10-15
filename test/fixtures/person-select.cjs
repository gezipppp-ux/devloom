const permissions = ["project.view", "issue.view", "issue.edit", "issue.assign", "issue.transition", "session.start", "asset.view", "asset.edit", "deliverable.review"];
const people = [
  { id: "zhang", username: "dev-01", displayName: "张三" },
  { id: "li", username: "qa-02", displayName: "李四" },
  { id: "shan", username: "user-03", displayName: "单明" },
];
const members = people.map(person => ({ ...person, userId: person.id, status: "active", userStatus: "active", permissions, effectivePermissions: permissions }));
const issue = { id: "i", number: 1, type: "requirement", title: "测试事项", description: "人员搜索", revision: 1, priority: "normal", status: "ready", statusName: "规划中", watcherIds: ["li"], reporterId: "li", businessOwnerId: "li", people, attachments: [], processing: { category: "planning", handlerId: "li" }, availableTransitions: [{ id: "handoff", statusName: "处理中", name: "交接", permission: "issue.transition", assignment: "selection" }] };
const task = { id: "t", title: "测试开发任务", status: "planned", canEdit: true, revision: 1, executorId: "li", executor: people[1], issueIds: ["i"], issues: [issue], additions: [] };
const source = `
import { createApp, h, ref } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n, setLocale } from '/src/shared/i18n/index.js';
import IssueFields from '/src/features/projects/IssueFields.vue';
import Plan from '/src/features/projects/PlanDevelopmentDialog.vue';
import Settings from '/src/features/projects/ProjectSettings.vue';
import Members from '/src/features/projects/ProjectMembers.vue';
import Publish from '/src/features/projects/PublishDelivery.vue';
import Delivery from '/src/features/projects/DeliveryDetail.vue';
import Detail from '/src/features/projects/IssueDetail.vue';
import Assets from '/src/features/projects/ProjectAssets.vue';
import Task from '/src/features/projects/DevelopmentTaskDetail.vue';
import '/src/shared/styles/style.css';
import '/src/shared/styles/workbench.css';
const kind = new URLSearchParams(location.search).get('kind');
const router = createRouter({ history: createWebHistory(), routes: [{ path: '/:pathMatch(.*)*', name: 'project', component: { render: () => null } }] });
await router.push(location.pathname + location.search); await router.isReady();
const model = ref(${JSON.stringify(issue)}), disabled = ref(false);
const props = { projectId: 'p', issueId: 'i', taskId: 't', deliveryId: 'd', permissions: ${JSON.stringify(permissions)}, canAssign: true, canManage: true, assign: true, issueIds: ['i'], project: { id: 'p', name: '测试项目', description: '', ownerUserId: 'li', revision: 1, settings: {} } };
createApp({ render: () => kind === 'fields'
  ? h('main', { style: 'max-width: 720px; padding: 16px' }, [h('button', { onClick: () => { disabled.value = !disabled.value; } }, '切换禁用'), h('button', { onClick: () => setLocale('en') }, 'English'), h(IssueFields, { modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value; }, type: 'requirement', canAssign: true, disabled: disabled.value, contextKey: 'fixture', members: ${JSON.stringify(members)} }), h('output', JSON.stringify(model.value))])
  : h({ plan: Plan, settings: Settings, members: Members, publish: Publish, delivery: Delivery, detail: Detail, assets: Assets, task: Task }[kind], props)
}).use(router).use(i18n).mount('#app');
`;

module.exports = { source, people, members, issue, task, permissions };
