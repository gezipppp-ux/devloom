const path = require('node:path');
const { updateConfig } = require('../../storage/json-files.cjs');

async function saveSession(session, file) {
  const resolved = path.resolve(file);
  (await updateConfig(resolved, (previous) => ({
    ...previous,
    version: previous.version ?? 1,
    tapd: { ...previous.tapd, session },
  })));
  return resolved;
}

function parseCookieHeader(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=');
        return separator < 0
          ? [part, '']
          : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

function todoRequest({ workspaceId, dscToken }) {
  return {
    group: 'workspace',
    group_id: workspaceId,
    order_field: 'due',
    order_type: 'desc',
    select_workspace_ids: [workspaceId],
    select_object_types: ['story', 'board_card', 'bug'],
    search_filter_time: 'all_time',
    search_filter: {
      common: {
        data: [
          {
            fieldOption: 'like',
            fieldType: 'input',
            fieldSystemName: 'name',
            fieldDisplayName: '标题',
            selectOption: [],
            value: '',
            fieldIsSystem: '1',
          },
          {
            fieldOption: 'in',
            fieldType: 'treeselect',
            fieldSystemName: 'iteration_id',
            fieldDisplayName: '迭代',
            selectOption: [],
            value: [],
            fieldIsSystem: '1',
          },
          {
            fieldOption: 'between',
            fieldType: 'dateinput',
            fieldSystemName: 'begin',
            fieldDisplayName: '预计开始',
            selectOption: [],
            value: '',
            fieldIsSystem: '1',
          },
          {
            fieldOption: 'between',
            fieldType: 'dateinput',
            fieldSystemName: 'due',
            fieldDisplayName: '预计结束',
            selectOption: [],
            value: '',
            fieldIsSystem: '1',
          },
        ],
        optionType: 'AND',
        needInit: '1',
      },
    },
    show_fields: [
      'name',
      'status',
      'priority',
      'iteration_id',
      'due',
      'owner',
      'created',
    ],
    perpage: '20',
    page: 1,
    tab: 'todo',
    setting_view: 'tree',
    exclude_workspace_configs: [],
    dsc_token: dscToken,
  };
}

function buildSession({ cookieHeader, requestBody, referer }) {
  return {
    version: 1,
    saved_at: new Date().toISOString(),
    endpoint:
      'https://www.tapd.cn/api/my_worktable/my_worktable/get_my_worktable_by_page?needRepeatInterceptors=false',
    request_body: requestBody,
    cookie_header: cookieHeader,
    origin: 'https://www.tapd.cn',
    referer,
  };
}

function sessionFromCookie({ cookieHeader, workspaceId, dscToken }) {
  const token = dscToken || parseCookieHeader(cookieHeader)['dsc-token'];
  if (!token)
    throw new Error(
      'The Cookie must include dsc-token, or set TAPD_DSC_TOKEN separately.',
    );
  return buildSession({
    cookieHeader,
    requestBody: todoRequest({ workspaceId, dscToken: token }),
    referer: 'https://www.tapd.cn/tapd_fe/my/work?left_tree=1',
  });
}

module.exports = {
  buildSession,
  sessionFromCookie,
  parseCookieHeader,
  saveSession,
  todoRequest,
};
