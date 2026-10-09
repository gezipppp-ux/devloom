const { createHash } = require('node:crypto');

const RUN_KEY = /^(?:\d+-\d+|[a-z][a-z0-9-]{0,31}-[a-f0-9]{32})$/;
function sourceFor(channel, item) {
  const source = {
    channel,
    scope: String(item.workspace_id || ''),
    id: String(item.id || ''),
  };
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(channel) ||
    !source.scope ||
    !source.id ||
    source.scope.length > 200 ||
    source.id.length > 200
  )
    throw new Error('Invalid requirement source identity.');
  return source;
}
function runKey(source) {
  sourceFor(source.channel, { workspace_id: source.scope, id: source.id });
  if (source.channel === 'tapd' && !/^\d+$/.test(source.scope))
    throw new Error('TAPD identity must use numeric IDs.');
  if (source.channel === 'tapd' && !/^fusion-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(source.id)) {
    if (!/^\d+$/.test(source.scope) || !/^\d+$/.test(source.id))
      throw new Error('TAPD identity must use numeric IDs.');
    return `${source.scope}-${source.id}`;
  }
  return `${source.channel}-${createHash('sha256')
    .update(JSON.stringify([source.scope, source.id]))
    .digest('hex')
    .slice(0, 32)}`;
}
module.exports = { RUN_KEY, runKey, sourceFor };
