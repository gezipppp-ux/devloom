const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultWorkflow } = require('../../src/domain/issue-workflows.cjs');

function sample(path) {
  const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
  let start = { x: values.shift(), y: values.shift() };
  const points = [start];
  while (values.length) {
    const [x1, y1, x2, y2, x3, y3] = values.splice(0, 6);
    for (let step = 1; step <= 40; step++) {
      const t = step / 40, u = 1 - t;
      points.push({ x: u ** 3 * start.x + 3 * u ** 2 * t * x1 + 3 * u * t ** 2 * x2 + t ** 3 * x3, y: u ** 3 * start.y + 3 * u ** 2 * t * y1 + 3 * u * t ** 2 * y2 + t ** 3 * y3 });
    }
    start = { x: x3, y: y3 };
  }
  return points;
}

function assertAvoidsNodes(path, nodes, width, height, description) {
  assert.match(path, /^M .* C /, `${description}: curve must remain visible`);
  for (const point of sample(path)) {
    const obstacle = nodes.find(node => point.x > node.x + .01 && point.x < node.x + width - .01 && point.y > node.y + .01 && point.y < node.y + height - .01);
    assert.equal(obstacle, undefined, `${description}: curve enters ${obstacle?.id} at ${JSON.stringify(point)}`);
  }
}

test('workflow curves avoid every node for defaults, obstacles, reverse and duplicate edges', async () => {
  const { workflowNodes, workflowRoutes, NODE_WIDTH, NODE_HEIGHT } = await import('../../web/src/shared/components/workflow-routing.js');
  const obstacle = { nodes: [
    { id: 'a', x: 40, y: 40 }, { id: 'b', x: 320, y: 40 }, { id: 'c', x: 600, y: 40 },
    { id: 'd', x: 320, y: 200 }, { id: 'e', x: 320, y: 360 },
  ], transitions: [['a', 'c'], ['c', 'a'], ['a', 'c'], ['b', 'e'], ['e', 'b'], ['d', 'a'], ['c', 'e']].map(([from, to], index) => ({ id: `edge-${index}`, from, to, name: '流转' })) };
  for (const definition of [defaultWorkflow('requirement'), defaultWorkflow('bug'), obstacle]) {
    const nodes = workflowNodes(definition), routes = workflowRoutes(nodes, definition.transitions);
    assert.equal(routes.length, definition.transitions.length);
    assert.equal(new Set(routes.map(edge => edge.path)).size, routes.length, 'parallel transitions need distinct paths');
    for (const edge of routes) {
      assert.match(edge.path, /^M .* C /, `${edge.id} must remain visible and use cubic curves`);
      for (const point of sample(edge.path)) {
        for (const node of nodes) assert.ok(!(point.x > node.x + .01 && point.x < node.x + NODE_WIDTH - .01 && point.y > node.y + .01 && point.y < node.y + NODE_HEIGHT - .01), `${edge.id} crosses ${node.id} at ${JSON.stringify(point)}`);
      }
    }
  }
});

test('overlapping, missing and negative coordinates get a separated view without mutating source', async () => {
  const { workflowNodes, nodesOverlap, freeNodePosition } = await import('../../web/src/shared/components/workflow-routing.js');
  const definition = { nodes: [{ id: 'a', x: -100, y: -100 }, { id: 'b', x: 40, y: 40 }, { id: 'c', x: 40, y: 40 }, { id: 'd' }] };
  const original = structuredClone(definition);
  const nodes = workflowNodes(definition);
  assert.deepEqual(definition, original);
  assert.deepEqual({ x: nodes[0].x, y: nodes[0].y }, { x: -100, y: -100 }, 'negative canvas coordinates must survive rendering');
  for (const node of nodes) for (const other of nodes) if (other !== node) assert.equal(nodesOverlap(node, other), false);
  const addition = freeNodePosition(nodes[0], nodes);
  assert.equal(nodes.some(node => nodesOverlap(node, addition)), false);
});

test('clear facing sides use straight lines in all directions and with unequal port counts', async () => {
  const { workflowRoutes, NODE_WIDTH, NODE_HEIGHT } = await import('../../web/src/shared/components/workflow-routing.js');
  for (const [x, y, axis] of [[40, 320, 'x'], [40, -280, 'x'], [360, 40, 'y'], [-280, 40, 'y']]) {
    const nodes = [{ id: 'a', x: 40, y: 40 }, { id: 'b', x, y }];
    const edges = [{ id: 'forward', from: 'a', to: 'b', name: '前进' }, { id: 'reverse', from: 'b', to: 'a', name: '返回' }];
    for (const edge of workflowRoutes(nodes, edges)) {
      assert.equal(new Set(edge.points.map(point => point[axis])).size, 1, `${edge.id} must be straight along ${axis}`);
      assertAvoidsNodes(edge.path, nodes, NODE_WIDTH, NODE_HEIGHT, edge.id);
    }
  }
  const definition = { nodes: [{ id: 'planned', x: 40, y: 40 }, { id: 'rejected', x: 56, y: 360 }, { id: 'other', x: 420, y: 40 }], transitions: [{ id: 'planned_rejected', from: 'planned', to: 'rejected' }, { id: 'rejected_planned', from: 'rejected', to: 'planned' }, { id: 'other_rejected', from: 'other', to: 'rejected' }] };
  const routes = workflowRoutes(definition.nodes, definition.transitions.map(edge => ({ ...edge, name: edge.id })));
  for (const id of ['planned_rejected', 'rejected_planned']) {
    const edge = routes.find(edge => edge.id === id);
    assert.equal(new Set(edge.points.map(point => point.x)).size, 1, `${id}: unequal fan-in and a small node offset must not introduce a dogleg`);
  }
  assert.notEqual(routes.find(edge => edge.id === 'planned_rejected').points[0].x, routes.find(edge => edge.id === 'rejected_planned').points[0].x, 'opposite transitions remain distinguishable');
});

test('drawing previews avoid intermediate cards and stop at hovered node boundaries', async () => {
  const { workflowNodes, workflowConnection, NODE_WIDTH, NODE_HEIGHT } = await import('../../web/src/shared/components/workflow-routing.js');
  for (const displacement of [0, 96, 224]) {
    const nodes = workflowNodes({ nodes: [
      { id: 'a', x: 40, y: 40 }, { id: 'b', x: 280, y: 40 + displacement },
      { id: 'c', x: 520, y: 40 }, { id: 'd', x: 280, y: 280 }, { id: 'e', x: 760, y: 40 },
    ] });
    for (const from of [nodes[0], nodes.at(-1)]) {
      for (const target of nodes) {
        const cursor = { x: target.x + NODE_WIDTH / 2, y: target.y + NODE_HEIGHT / 2 };
        const path = workflowConnection(nodes, from.id, cursor);
        if (target === from) assert.equal(path, '', 'self connections cannot draw inside their source');
        else assertAvoidsNodes(path, nodes, NODE_WIDTH, NODE_HEIGHT, `preview ${from.id} → ${target.id}, offset ${displacement}`);
      }
      for (let x = 0; x <= 960; x += 48) {
        for (let y = 0; y <= 480; y += 48) {
          const insideSource = x >= from.x && x <= from.x + NODE_WIDTH && y >= from.y && y <= from.y + NODE_HEIGHT;
          const path = workflowConnection(nodes, from.id, { x, y });
          if (!insideSource) assertAvoidsNodes(path, nodes, NODE_WIDTH, NODE_HEIGHT, `preview ${from.id} at ${x},${y}`);
        }
      }
    }
  }
});

test('seeded dense layouts keep every forward, reverse and parallel curve outside nodes', async () => {
  const { workflowNodes, workflowRoutes, NODE_WIDTH, NODE_HEIGHT } = await import('../../web/src/shared/components/workflow-routing.js');
  let seed = 8124;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let layout = 0; layout < 24; layout++) {
    const nodes = workflowNodes({ nodes: Array.from({ length: 8 }, (_, i) => ({ id: String(i), x: Math.round(random() * 1000), y: Math.round(random() * 650) })) });
    const edges = Array.from({ length: 18 }, (_, i) => {
      const from = Math.floor(random() * nodes.length);
      return { id: String(i), from: String(from), to: String((from + 1 + Math.floor(random() * 7)) % nodes.length), name: '流转' };
    });
    const routes = workflowRoutes(nodes, edges);
    assert.equal(routes.length, edges.length);
    for (const route of routes) assertAvoidsNodes(route.path, nodes, NODE_WIDTH, NODE_HEIGHT, `layout ${layout}, transition ${route.id}`);
  }
});
