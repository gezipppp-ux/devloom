const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { WorkspaceManager } = require('../../src/application/workspace-manager.cjs');
const { defaultChannelConfig } = require('../../src/channels/channel-registry.cjs');
const { temporary } = require('../support/helpers.cjs');

test('workspace creation receives independent channel defaults and renaming preserves configured workflow', async (t) => {
  const changedDefaults = defaultChannelConfig();
  changedDefaults.workflow = { allow_write: true };
  const workspaces = new WorkspaceManager({
    directory: path.join(temporary(t), 'workspaces'),
  });
  const workspace = (await workspaces.save({ name: '默认配置' }));
  const file = workspaces.configFile(workspace.id);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved, {
    version: 3,
    agent: { provider: "codex", model: "", reasoningEffort: "", permissionMode: "ask", options: {} },
    execution: { projectName: `w-${workspace.id.slice(0, 8)}` },
    workspace: { id: workspace.id, name: '默认配置' },
  });
  saved.workflow = {
    allow_write: true,
    target_status: 'custom',
    fields: { owner: 'configured' },
  };
  fs.writeFileSync(file, JSON.stringify(saved));
  (await workspaces.save({ name: '重命名后' }, workspace.id));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(file, 'utf8')).workflow,
    saved.workflow,
  );
  assert.deepEqual(defaultChannelConfig(), {
  });
});
