const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Workspaces } = require('../../src/application/workspaces.cjs');
const { defaultChannelConfig } = require('../../src/channels/registry.cjs');
const { temporary } = require('../support/helpers.cjs');

test('workspace creation receives independent channel defaults and renaming preserves configured workflow', (t) => {
  const changedDefaults = defaultChannelConfig();
  changedDefaults.workflow.allow_write = true;
  changedDefaults.workflow.fields.owner = 'other-workspace';
  const workspaces = new Workspaces({
    directory: path.join(temporary(t), 'workspaces'),
  });
  const workspace = workspaces.save({ name: '默认配置' });
  const file = workspaces.configFile(workspace.id);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved, {
    version: 3,
    codex: {},
    workflow: { allow_write: false, target_status: 'developing', fields: {} },
    workspace: { id: workspace.id, name: '默认配置' },
  });
  saved.workflow = {
    allow_write: true,
    target_status: 'custom',
    fields: { owner: 'configured' },
  };
  fs.writeFileSync(file, JSON.stringify(saved));
  workspaces.save({ name: '重命名后' }, workspace.id);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(file, 'utf8')).workflow,
    saved.workflow,
  );
  assert.deepEqual(defaultChannelConfig(), {
    workflow: { allow_write: false, target_status: 'developing', fields: {} },
  });
});
