/* Search selectable TAPD users through the saved HTTP session. */
const { headers, request } = require('./http.cjs');

async function searchUsers(session, { query, workspace, perPage = 10 }) {
  if (!query?.trim())
    throw new Error(
      'Provide a non-empty search query with --query <name-or-pinyin>.',
    );
  if (!workspace)
    throw new Error(
      'Provide --workspace <workspace-id>, or refresh a TAPD configuration that contains a workspace ID.',
    );

  // This is the same form payload used by the TAPD developer/tester chooser.
  const body = new URLSearchParams({
    key_word: query.trim(),
    workspace_id: String(workspace),
    multi_workspace_ids: '',
    disabled: '0',
    show_child_user: '0',
    extelnal: '1',
    per_page: String(perPage),
    load_all: '0',
    is_batch: 'undefined',
    select_type: 'fuzzy_match',
    size: '0',
    chooser_type: 'userspinyin',
  });
  const result = await request(
    session,
    'https://www.tapd.cn/api/basic/user/user_chooser',
    {
      method: 'POST',
      headers: {
        ...headers(session, session.referer),
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'dsc-token': session.request_body?.dsc_token || '',
      },
      body,
    },
  );
  if (!Array.isArray(result))
    throw new Error('TAPD user search returned an invalid result.');
  return result;
}

module.exports = { searchUsers };
