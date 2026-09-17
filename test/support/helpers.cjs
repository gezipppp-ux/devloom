const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tapd-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('tapd-test-')
    )
      throw new Error('Unexpected test cleanup path.');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  return directory;
}

const session = {
  endpoint: 'https://www.tapd.cn/api/todos',
  cookie_header: 'test-secret',
  referer: 'https://www.tapd.cn/',
  request_body: {
    group_id: '1',
    select_workspace_ids: ['1'],
    dsc_token: 'test-token',
    perpage: '2',
  },
};
const item = {
  id: '1130141304001000752',
  workspace_id: '1',
  type: 'story',
  title: '示例需求',
  description: '<p>增加筛选</p>',
  detail_url: 'https://www.tapd.cn/1/story/1130141304001000752',
};
const workflow = {
  current_status: 'open',
  my_all_transitions: [
    {
      StepPrevious: 'open',
      StepNext: 'developing',
      to_name: '开发中',
      Appendfield: [],
    },
  ],
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxkAAAAASUVORK5CYII=',
  'base64',
);

function json(data, code = 0) {
  return Response.json({ meta: { code }, data });
}
module.exports = { item, json, png, session, temporary, workflow };
