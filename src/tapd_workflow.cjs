const { argument, loadConfig, loadSession } = require('./config.cjs');
const {
  detailUrl,
  selectItem,
  selectionArguments,
} = require('./tapd_direct_detail.cjs');
const {
  assertSuccess,
  headers,
  parseData,
  request,
} = require('./tapd_http.cjs');

async function workflowInfo(session, item) {
  if (String(item.entity_type || item.type).toLowerCase() !== 'story')
    throw new Error('Workflow execution supports story requirements only.');
  const endpoint = `https://www.tapd.cn/api/aggregation/story_aggregation/get_story_transition_info?workspace_id=${encodeURIComponent(item.workspace_id)}&story_id=${encodeURIComponent(item.id)}&field_blocker=`;
  const result = await request(session, endpoint, {
    headers: headers(session, detailUrl(item)),
  });
  const nested = parseData(result?.get_workflow_by_story);
  if (nested?.meta) assertSuccess(nested, 'TAPD workflow');
  const info = parseData(nested?.data);
  if (!info?.current_status)
    throw new Error('TAPD returned no current workflow status.');
  return info;
}

function transitionSummary(info) {
  return (info.my_all_transitions || []).map((transition) => ({
    from: transition.StepPrevious,
    to: transition.StepNext,
    to_name: transition.to_name,
    required_fields: (transition.Appendfield || [])
      .filter((field) => field.Notnull === 'yes')
      .map((field) => ({
        name: field.FieldName || field.field_name,
        label: field.FieldLabel,
        default_value: field.default_value ?? '',
      })),
  }));
}

function fieldsFor(transition, configured) {
  const fields = { ...configured };
  const empty = (value) =>
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && !value.length);
  for (const field of transition.Appendfield || []) {
    const name = field.FieldName || field.field_name;
    if (empty(fields[name]) && !empty(field.default_value))
      fields[name] = field.default_value;
    if (field.Notnull === 'yes' && empty(fields[name]))
      throw new Error(
        `Transition requires ${field.FieldLabel || name}. Set workflow.fields.${name}.`,
      );
  }
  return fields;
}

function planTransition(info, workflow = {}, override) {
  const transitions = info.my_all_transitions || [];
  const target =
    override ||
    workflow.target_status ||
    transitions.find((entry) => entry.to_name === '开发中')?.StepNext ||
    'developing';
  if (info.current_status === target)
    return { target, already: true, fields: {} };
  const transition = transitions.find(
    (candidate) =>
      candidate.StepNext === target &&
      (!candidate.StepPrevious ||
        candidate.StepPrevious === info.current_status),
  );
  if (!transition)
    throw new Error(
      `No permitted transition from ${info.current_status} to ${target}. Inspect tapd:transitions and configure workflow.target_status.`,
    );
  return {
    target,
    already: false,
    transition,
    fields: fieldsFor(transition, workflow.fields),
  };
}

async function applyTransition(session, item, workflow, target) {
  if (workflow?.allow_write !== true)
    throw new Error(
      'Set workflow.allow_write to true before changing TAPD status.',
    );
  // Reread after dispatch: permissions, required fields and state may have changed.
  const info = await workflowInfo(session, item);
  const plan = planTransition(info, workflow, target);
  if (!plan.already) {
    await request(
      session,
      'https://www.tapd.cn/api/entity/workflow/transition',
      {
        method: 'POST',
        headers: headers(session, detailUrl(item)),
        body: JSON.stringify({
          workspace_id: item.workspace_id,
          program_id: 0,
          entity_id: item.id,
          entity_type: 'story',
          current_status: info.current_status,
          next_status: plan.target,
          from: info.current_status,
          fields: plan.fields,
          is_manual: true,
          auto_complete: false,
          close_task: false,
          current_alias_status:
            info.status_alias?.[info.current_status] || info.current_status,
          next_alias_status:
            plan.transition.to_name ||
            info.status_alias?.[plan.target] ||
            plan.target,
          Timesheet: null,
          dsc_token: session.request_body.dsc_token,
        }),
      },
    );
    const verified = await workflowInfo(session, item);
    if (verified.current_status !== plan.target)
      throw new Error(
        `TAPD transition verification failed: expected ${plan.target}, received ${verified.current_status}.`,
      );
  }
  return {
    item_id: item.id,
    from: info.current_status,
    to: plan.target,
    verified_status: plan.target,
    already: plan.already,
  };
}

async function main() {
  const config = loadConfig();
  const session = loadSession();
  const options = selectionArguments();
  options.id ||= config.workflow?.test_item_id;
  if (process.argv.includes('--apply') && !options.id)
    throw new Error('Choose an explicit --id before changing TAPD status.');
  const item = await selectItem(session, options);
  let result;
  if (process.argv.includes('--apply'))
    result = await applyTransition(
      session,
      item,
      config.workflow,
      argument('--to'),
    );
  else {
    const info = await workflowInfo(session, item);
    result = {
      item_id: item.id,
      current_status: info.current_status,
      transitions: transitionSummary(info),
    };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
module.exports = {
  applyTransition,
  fieldsFor,
  planTransition,
  transitionSummary,
  workflowInfo,
};
