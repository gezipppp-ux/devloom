const { projectPermissionCatalog } = require('../../src/domain/project-permissions.cjs');

function projectVisual(workspaceId) {
  const permissions = projectPermissionCatalog.filter(p => p.scope === 'project').map(p => p.id);
  const department = { id: 'product', name: '产品研发部', status: 'active', permissions };
  const project = { id: '00000000-0000-4000-8000-000000000001', name: '客户管理系统', description: '统一管理客户搜索、业务交付和测试环境资料，让产品与研发在同一个项目中协作。', remoteUrl: 'https://git.example.test/team/customer.git', repositoryEditable: false, status: 'active', ownerUserId: 'visual-admin', revision: 1, settings: { initCommands: ['npm ci', 'npm run build'], prompts: {} } };
  const members = ['演示管理员', '张明', '李欣'].map((displayName, i) => ({ userId: i ? `member-${i}` : 'visual-admin', username: i ? `member-${i}` : 'visual-admin', displayName, departmentName: department.name, status: 'active', userStatus: 'active', permissions, departmentPermissions: permissions, grantablePermissions: permissions, administratorAccess: !i, effectivePermissions: permissions, revision: 1 }));
  const people = members.map(m => ({ id: m.userId, username: m.username, displayName: m.displayName }));
  const release = { id: 'release-1', name: 'v0.2', description: '优化客户搜索与筛选体验。\n补充空结果提示，完善移动端交互与验收流程。', revision: 1, status: 'active', createdAt: '2026-10-08T08:00:00Z', updatedAt: '2026-10-12T08:00:00Z' };
  const releases = [release, { ...release, id: 'release-2', name: 'v0.1', description: '项目首个迭代版本。', updatedAt: '2026-10-08T08:00:00Z' }, { ...release, id: 'release-archived', name: 'v0.0.9', status: 'archived', description: '早期验证版本，保留历史记录。' }];
  const issues = [
    { id: 'search', number: 1, type: 'requirement', title: '优化客户搜索体验', status: 'planned', description: '支持按姓名和手机号搜索客户，输入后实时筛选。无匹配结果时显示清晰提示，并保留现有分页行为。', acceptanceCriteria: '支持组合筛选；清空关键词后恢复完整列表；手机上输入与清除按钮均可直接操作。' },
    { id: 'export', number: 2, type: 'bug', title: '修复导出结果与筛选条件不一致', status: 'pending', description: '筛选客户后导出的结果仍包含其他客户。', reproductionSteps: '输入客户姓名，点击导出并检查文件内容。', expectedResult: '仅导出筛选后的客户。', actualResult: '导出了全部客户。' },
    { id: 'empty', number: 3, type: 'requirement', title: '补充列表空结果提示与移动端交互验收', status: 'developing', description: '补齐异常、空结果及移动端交互状态。', acceptanceCriteria: '提示文案清晰，并可恢复完整列表。' },
  ].map(issue => ({ ...issue, releaseId: release.id, release, statusName: { planned: '规划中', pending: '待处理', developing: '开发中' }[issue.status], workflow: { id: 'workflow-1', version: 1, definition: require('../../src/domain/issue-workflows.cjs').defaultWorkflow(issue.type) }, priority: 'high', severity: 'normal', revision: 1, assigneeId: 'member-1', participantIds: ['member-2'], people, availableTransitions: require('../../src/domain/issue-workflows.cjs').defaultWorkflow(issue.type).transitions.filter(t => t.from === issue.status).map(t => ({ ...t, status: t.to })) }));
  const assets = [
    { id: 'guide', title: '联调与验收说明', type: 'document', content: '测试环境已准备完成。请使用测试客户完成搜索、清空和导出验收。', environment: 'test', category: '验收资料', tags: ['客户搜索', '联调'], hasSecret: false },
    { id: 'credential', title: '测试环境演示账号', type: 'credential', content: '仅供项目测试与联调。', environment: 'test', category: '环境账号', tags: ['测试'], username: 'demo-user', url: 'https://test.example.test/customer', hasSecret: true },
  ].map(asset => ({ ...asset, revision: 1, issueIds: ['search'], ownerId: 'member-1', expiresAt: null }));
  const task = { id: 'search-task', revision: 1, releaseId: release.id, release, executorId: 'visual-admin', executor: { id: 'visual-admin', displayName: '演示管理员' }, issueIds: ['search'], canStart: false, canEdit: false, canComplete: true, canCancel: true, baseBranch: 'main', baseCommit: '1234567890abcdef1234567890abcdef12345678', fetchedAt: '2026-10-12T08:00:00Z', title: '客户搜索与空结果提示', status: 'started', canOpenSession: true, workspaceId, runKey: '1-1', execution: { status: 'completed', sessionId: 'fixture-session' }, issues: [issues[0]], additions: [{ requestId: 'append-fixture', status: 'ready', issues: [issues[2]] }] };
  function response(url) {
    const endpoint = url.pathname;
    if (endpoint === '/api/projects') return { projects: [project, { ...project, id: 'operations', name: '运营后台', description: '运营指标、客户跟进与业务配置。' }], canCreateProjects: true };
    if (endpoint === '/api/admin/departments') return { departments: [department] };
    if (endpoint === '/api/projects/00000000-0000-4000-8000-000000000001') return { project, permissions, space: { status: 'ready', workspaceId, gitAccountId: 'fixture-account' } };
    if (endpoint.endsWith('/releases')) return { items: releases.filter(item => url.searchParams.get('includeArchived') === 'true' || item.status !== 'archived') };
    if (/^\/api\/system\/workflows\/(requirement|bug)$/.test(endpoint) || /\/issue-workflows\/(requirement|bug)$/.test(endpoint)) { const workflowDefinition = require('../../src/domain/issue-workflows.cjs').defaultWorkflow(endpoint.split('/').at(-1)); return { workflow: { id: 'workflow-1', publishedVersion: 1, versions: [{ version: 1, definition: workflowDefinition }], ...(endpoint.startsWith('/api/system/') ? { revision: 1, draft: workflowDefinition } : {}) } }; }
    if (endpoint.endsWith('/branches')) return { branches: [{ name: 'main', commit: 'a'.repeat(40) }], fetchedAt: '2026-10-12T08:00:00Z' };
    if (endpoint.endsWith('/members')) return { members, candidates: members.map(m => ({ id: m.userId, ...m })) };
    if (endpoint === '/api/projects/00000000-0000-4000-8000-000000000001/issues') return { items: issues.filter(i => !url.searchParams.get('type') || i.type === url.searchParams.get('type')), nextOffset: null };
    if (/\/issues\/(search|export|empty)$/.test(endpoint)) return issues.find(i => endpoint.endsWith('/' + i.id));
    if (endpoint.endsWith('/assets')) return { items: assets, nextOffset: null };
    if (/\/assets\/(guide|credential)$/.test(endpoint)) return { ...assets.find(asset => endpoint.endsWith('/' + asset.id)), people };
    if (endpoint.endsWith('/tasks')) return { tasks: [task], nextOffset: null };
    if (endpoint.endsWith('/tasks/search-task')) return { task };
    if (/\/(files|comments|deliverables|history)$/.test(endpoint) && endpoint.startsWith('/api/projects/')) return { items: [], nextOffset: null, people };
    return null;
  }
  return { response, projectId: project.id, permissions };
}

module.exports = { projectVisual };
