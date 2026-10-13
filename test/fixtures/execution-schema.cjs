const fs = require('node:fs');
const path = require('node:path');

const [scenarioFile, command, action, flag, directory] = process.argv.slice(2);
if (command !== 'app-server' || action !== 'generate-json-schema' || flag !== '--out')
  throw new Error('schema fixture only accepts generate-json-schema');
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
fs.appendFileSync(scenario.log, JSON.stringify({
  directory,
  credentialPresent: Object.hasOwn(process.env, 'TAPD_SCHEMA_FIXTURE'),
  threadPresent: Object.hasOwn(process.env, 'CODEX_THREAD_ID'),
}) + '\n');
if (scenario.failOnce && !fs.existsSync(scenario.failOnce)) {
  fs.writeFileSync(scenario.failOnce, 'failed');
  process.stderr.write('fixture schema generation failed');
  process.exit(1);
}
fs.mkdirSync(path.join(directory, 'v2'));
for (const name of ['ThreadStartParams', 'ThreadResumeParams', 'TurnStartParams']) {
  if (scenario.missing === name) continue;
  const schema = {
    properties: { approvalsReviewer: { $ref: '#/definitions/ApprovalsReviewer' }, modelProvider: { type: 'string' }, config: { type: 'object' } },
    definitions: { ApprovalsReviewer: { enum: ['user', 'auto_review'] } },
  };
  if (scenario.missingProperty === name) delete schema.properties.approvalsReviewer;
  if (scenario.missingSupplier === name) delete schema.properties.modelProvider;
  if (scenario.missingReviewer === name) schema.definitions.ApprovalsReviewer.enum = ['user'];
  fs.writeFileSync(path.join(directory, 'v2', name + '.json'),
    scenario.malformed === name ? '{invalid' : JSON.stringify(schema));
}
