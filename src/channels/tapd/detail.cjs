const { numericId, workspaceId } = require('./config.cjs');
const {
  assertSuccess,
  headers,
  parseData,
  request,
} = require('./http.cjs');

async function todos(session, options = {}) {
  const template = structuredClone(session.request_body);
  if (options.workspace) {
    template.group_id = numericId(options.workspace, 'Workspace');
    template.select_workspace_ids = [template.group_id];
  }
  if (options.type) template.select_object_types = [options.type.toLowerCase()];
  const perPage = Number(template.perpage) || 20;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 200)
    throw new Error('TAPD perpage must be between 1 and 200.');
  const items = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const data = await request(session, session.endpoint, {
      method: 'POST',
      body: JSON.stringify({ ...template, page, perpage: String(perPage) }),
    });
    if (!Array.isArray(data?.workitem_list))
      throw new Error('TAPD returned an invalid workitem_list.');
    const list = data.workitem_list;
    const previousSize = items.size;
    for (const item of list) items.set(`${item.workspace_id}:${item.id}`, item);
    if (list.length === 0) break;
    if (items.size === previousSize)
      throw new Error(
        'TAPD repeated a page; search results may be incomplete.',
      );
    // record_total may be "0" despite real items; use page length instead.
    if (list.length < perPage) break;
    if (page === 100)
      throw new Error(
        'TAPD search exceeded 100 pages. Narrow the saved TAPD view.',
      );
  }
  const query = options.query?.trim().toLocaleLowerCase();
  return [...items.values()].filter(
    (item) =>
      (!options.type ||
        String(item.entity_type || item.type).toLowerCase() ===
          options.type.toLowerCase()) &&
      (!options.workspace ||
        String(item.workspace_id) === String(options.workspace)) &&
      (!options.status || item.status === options.status) &&
      (!query ||
        String(item.title || item.name || '')
          .toLocaleLowerCase()
          .includes(query)),
  );
}

function detailUrl(item) {
  const type = String(item.entity_type || item.type || 'story').toLowerCase();
  return (
    item.detail_url ||
    item.title_url ||
    `https://www.tapd.cn/${item.workspace_id}/prong/${type === 'bug' ? 'bugs' : 'stories'}/view/${item.id}`
  );
}

async function detail(session, item) {
  const type = String(item.entity_type || item.type || 'story').toLowerCase();
  const data = await request(
    session,
    'https://www.tapd.cn/api/aggregation/workitem_aggregation/get_info',
    {
      method: 'POST',
      headers: headers(session, detailUrl(item)),
      body: JSON.stringify({
        workspace_id: numericId(item.workspace_id, 'Workspace'),
        entity_id: numericId(item.id, 'Item'),
        entity_type: type,
        api_controller_prefix: '',
        enable_description: 'true',
        is_detail: 1,
        blacklist_fields: [],
        identifier:
          'app_for_editor,app_for_obj_more,app_for_obj_dialog_dropdown,app_for_obj_detail_panel,app_for_obj_detail_bottom_card,app_for_obj_attachment,app_for_obj_copy_link,app_for_obj_additional_panel',
        installed_app_entity: {
          obj_id: item.id,
          obj_type: type,
          obj_name: type === 'story' ? '需求' : type === 'bug' ? '缺陷' : type,
        },
        has_edit_rule_fields: [],
        is_archived: 0,
        is_assistant_exec_log: 1,
        app_id: '',
        dsc_token: session.request_body.dsc_token,
      }),
    },
  );
  const basicResult = parseData(data?.get_workitem_basic_info_ret);
  if (basicResult?.meta) assertSuccess(basicResult, 'TAPD detail');
  const basic = parseData(basicResult?.data);
  if (!basic?.id || String(basic.id) !== String(item.id))
    throw new Error('TAPD detail is missing or returned a different item.');
  if (
    basic.workspace_id &&
    String(basic.workspace_id) !== String(item.workspace_id)
  )
    throw new Error('TAPD detail returned a different workspace.');
  return {
    id: String(basic.id),
    workspace_id: String(basic.workspace_id || item.workspace_id),
    type,
    title: [basic.name, basic.title, item.title, item.name]
      .find((value) => typeof value === 'string' && value.trim()) || '',
    status: basic.status || item.status,
    description: basic.description || '',
    markdown_description: basic.markdown_description || '',
    description_type: basic.description_type || null,
    detail_url: detailUrl(item),
  };
}

async function selectItem(session, options = {}) {
  if (options.id)
    return {
      id: numericId(options.id, 'Item'),
      workspace_id: numericId(
        workspaceId(session, options.workspace),
        'Workspace',
      ),
      type: options.type || 'story',
    };
  const list = await todos(session, options);
  if (!list.length) throw new Error('There are no matching TAPD work items.');
  return list[0];
}

module.exports = {
  detail,
  detailUrl,
  selectItem,
  todos,
};
