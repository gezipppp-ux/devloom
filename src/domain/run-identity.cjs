const { createHash } = require('node:crypto');

const RUN_KEY = /^(?:\d+-\d+|[a-z][a-z0-9-]{0,31}-[a-f0-9]{32})$/;
function sourceFor(channel, item) {
  const source = {
    channel,
    scope: String(item.workspace_id || ''),
    id: String(item.id || ''),
  };
  if (
    typeof channel !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(channel) ||
    !source.scope ||
    !source.id ||
    source.scope.length > 200 ||
    source.id.length > 200
  )
    throw new Error('Invalid requirement source identity.');
  return source;
}
function runKey(source) {
  if (!source || typeof source !== 'object')
    throw new Error('Invalid requirement source identity.');
  sourceFor(source.channel, { workspace_id: source.scope, id: source.id });
  return `${source.channel}-${createHash('sha256')
    .update(JSON.stringify([source.scope, source.id]))
    .digest('hex')
    .slice(0, 32)}`;
}
function recordedSources(record) {
  const sources = record.sources || record.workitem?.sources ||
    (record.workitem || record.source ? [record.source] : []);
  if (!Array.isArray(sources)) throw new Error('Invalid requirement source identities.');
  for (const source of sources) runKey(source);
  return sources;
}
module.exports = { RUN_KEY, runKey, sourceFor, recordedSources };
