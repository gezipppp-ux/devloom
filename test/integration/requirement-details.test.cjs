const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { RunStore } = require('../../src/storage/run-store.cjs');
const { SessionPresenter } = require('../../src/application/session-presenter.cjs');
const { temporary } = require('../support/helpers.cjs');

test('requirement snapshots preserve complete body and generic agent prompt', async (t) => {
  const store = new RunStore(temporary(t));
  const presenter = new SessionPresenter({ store });
  const key = '1-2';
  fs.mkdirSync(store.dir(key));
  const state = {
    agent: { provider: 'codex' },
    workitem: { id: '2', title: '运行记录', description: 'fallback' },
    created_at: '2026-09-17T00:00:00Z',
  };
  const description = '<p>' + '完整正文'.repeat(30000) + '正文末尾</p>';
  const prompt = '完整提示词'.repeat(30000) + '提示词末尾';
  const supplementaryInstructions = '补充说明与指导意见\n'.repeat(5000);
  const snapshot = {
    generated_at: '2026-09-17T01:00:00Z',
    workitem: {
      id: '2',
      title: '需求标题',
      description,
      supplementary_instructions: supplementaryInstructions,
      detail_url: 'https://example.com/story/2',
    },
    prompt: prompt,
    images: [
      {
        source: 'https://example.com/image.png',
        path: path.join(store.dir(key), 'image.png'),
      },
    ],
    private: 'should-not-be-exposed',
  };
  fs.writeFileSync(
    path.join(store.dir(key), 'requirement.json'),
    JSON.stringify(snapshot),
  );
  const result = (await presenter.requirement(key, state));
  assert.equal(result.description, description);
  assert.equal(result.prompt, prompt);
  assert.equal(result.supplementaryInstructions, supplementaryInstructions);
  assert.equal(result.capturedAt, snapshot.generated_at);
  assert.deepEqual(result.images, [
    {
      index: 0,
      name: 'image.png',
      source: 'https://example.com/image.png',
      url: '/api/runs/1-2/images/0',
    },
  ]);
  assert.equal(result.private, undefined);
  assert.equal(result.warning, '');
  fs.writeFileSync(
    path.join(store.dir(key), 'requirement.json'),
    JSON.stringify({
      ...snapshot,
      workitem: {
        ...snapshot.workitem,
        markdown_description: '# Markdown 正文',
      },
    }),
  );
  assert.equal((await presenter.requirement(key, state)).markdown, '# Markdown 正文');
  assert.equal(
    (await presenter.requirement(key, state)).supplementaryInstructions,
    supplementaryInstructions,
  );
});

test('missing or corrupt snapshot falls back to saved requirement without failing the session', async (t) => {
  const store = new RunStore(temporary(t));
  const presenter = new SessionPresenter({ store });
  const key = '1-2';
  fs.mkdirSync(store.dir(key));
  const state = { agent: { provider: 'codex' }, workitem: { id: '2', description: '运行记录完整正文' } };
  assert.equal(
    (await presenter.requirement(key, state)).description,
    state.workitem.description,
  );
  assert.match((await presenter.requirement(key, state)).warning, /缺失/);
  fs.writeFileSync(path.join(store.dir(key), 'requirement.json'), 'bad json');
  assert.match((await presenter.requirement(key, state)).warning, /无法读取/);
  assert.deepEqual((await presenter.requirement(key, state)).images, []);
  assert.equal((await presenter.requirement(key, state)).supplementaryInstructions, '');
  state.workitem.supplementary_instructions = '保留记录中的补充说明\n第二行';
  assert.equal(
    (await presenter.requirement(key, state)).supplementaryInstructions,
    state.workitem.supplementary_instructions,
  );
});
