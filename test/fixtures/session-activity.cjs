function sessionActivityItems() {
  const turnId = 'activity-turn';
  return [
    { id: 'activity-user', type: 'userMessage', text: '优化注册与找回密码流程，统一表单校验，并补充验证码过期和重复提交的反馈。' },
    { id: 'activity-intro', type: 'agentMessage', text: '我会先检查现有表单和校验规则，再调整注册、找回密码的交互与错误提示。' },
    { id: 'activity-reasoning-1', type: 'reasoning', text: '检查注册表单及找回密码入口，保留已有账号与会话身份。' },
    { id: 'activity-command-1', type: 'commandExecution', command: 'rg -n "resetPassword|register" apps/web/src/views/auth', output: 'register.vue\nreset-password.vue', exitCode: 0 },
    { id: 'activity-command-2', type: 'commandExecution', command: '读取表单组件与校验规则', output: '<script>window.activityXss = true</script>\n**命令输出保持原文**', exitCode: 0 },
    { id: 'activity-files-1', type: 'fileChange', changes: [{ path: 'apps/web/src/views/auth/register.vue', kind: 'update', diff: '+ 密码强度校验' }, { path: 'apps/web/src/views/auth/reset-password.vue', kind: 'update', diff: '+ 提交失败后保留输入' }] },
    { id: 'activity-reasoning-2', type: 'reasoning', text: '补充验证码过期与重复提交的边界用例。' },
    { id: 'activity-files-2', type: 'fileChange', changes: [{ path: 'apps/web/src/views/auth/__tests__/password-reset-validation.test.ts', kind: 'update', diff: '+ 验证码过期用例' }] },
    { id: 'activity-command-3', type: 'commandExecution', command: 'pnpm --dir apps/web exec eslint src/views/auth', output: '校验通过', exitCode: 0 },
    { id: 'activity-command-4', type: 'commandExecution', command: 'pnpm --dir apps/web test password-reset-validation --run', output: '✓ 密码长度与确认密码\n✓ 防止重复提交\n… 验证码过期与重新发送', status: 'inProgress' },
  ].map(item => ({ turnId, status: 'completed', ...item }));
}
module.exports = { sessionActivityItems };
