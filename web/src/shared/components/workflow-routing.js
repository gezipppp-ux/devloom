export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 72;
const CLEARANCE = 28;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const between = (value, a, b) => value > Math.min(a, b) && value < Math.max(a, b);

export function nodesOverlap(a, b, gap = 64) {
  return a.x < b.x + NODE_WIDTH + gap && a.x + NODE_WIDTH + gap > b.x &&
    a.y < b.y + NODE_HEIGHT + gap && a.y + NODE_HEIGHT + gap > b.y;
}

export function freeNodePosition(position, nodes) {
  const start = { x: Math.max(-100000, Math.min(100000, position.x)), y: Math.max(-100000, Math.min(100000, position.y)) };
  // Keep recorded coordinates when possible; resolve collisions only in the view.
  for (let radius = 0; ; radius += 32) {
    for (let dx = -radius; dx <= radius; dx += 32) {
      for (const dy of radius ? [-radius, radius] : [0]) {
        const point = { x: start.x + dx, y: start.y + dy };
        if (Math.abs(point.x) <= 100000 && Math.abs(point.y) <= 100000 && !nodes.some(node => nodesOverlap(point, node))) return point;
      }
    }
    for (let dy = -radius + 32; dy < radius; dy += 32) {
      for (const dx of [-radius, radius]) {
        const point = { x: start.x + dx, y: start.y + dy };
        if (Math.abs(point.x) <= 100000 && Math.abs(point.y) <= 100000 && !nodes.some(node => nodesOverlap(point, node))) return point;
      }
    }
  }
}

export function workflowNodes(definition) {
  return definition.nodes.reduce((nodes, node, index) => {
    nodes.push({ ...node, ...freeNodePosition({ x: node.x ?? 40 + index % 3 * 240, y: node.y ?? 40 + Math.floor(index / 3) * 160 }, nodes) });
    return nodes;
  }, []);
}

function sides(from, to) {
  if (to.x >= from.x + NODE_WIDTH + 32 && Math.abs(to.y - from.y) < NODE_HEIGHT) return ['right', 'left'];
  if (to.x + NODE_WIDTH + 32 <= from.x && Math.abs(to.y - from.y) < NODE_HEIGHT) return ['left', 'right'];
  if (to.y >= from.y + NODE_HEIGHT + 32) return ['bottom', 'top'];
  if (to.y + NODE_HEIGHT + 32 <= from.y) return ['top', 'bottom'];
  return ['top', 'top'];
}

function port(node, side, index, total, inset = 0) {
  const horizontal = ['top', 'bottom'].includes(side);
  const offset = 16 + (index + 1) * ((horizontal ? NODE_WIDTH : NODE_HEIGHT) - 32) / (total + 1);
  return {
    x: node.x + (horizontal ? offset : side === 'right' ? NODE_WIDTH + inset : -inset),
    y: node.y + (!horizontal ? offset : side === 'bottom' ? NODE_HEIGHT + inset : -inset),
  };
}

function edgePorts(edges, lookup, boxes) {
  const groups = new Map(), endpoints = new Map();
  for (const edge of edges) {
    endpoints.set(edge.id, [edge.from, edge.to].map((id, end) => {
      const node = lookup.get(id), side = edge.sides[end], key = `${id}:${side}`;
      const horizontal = side === 'top' || side === 'bottom', axis = horizontal ? 'x' : 'y';
      if (!groups.has(key)) groups.set(key, { min: node[axis] + 16, max: node[axis] + (horizontal ? NODE_WIDTH : NODE_HEIGHT) - 16, entries: [], used: [] });
      const group = groups.get(key), entry = { node, side, axis, group, end, other: lookup.get(end ? edge.from : edge.to) };
      group.entries.push(entry);
      return entry;
    }));
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => a.other[a.axis] - b.other[b.axis]);
    group.gap = Math.min(12, (group.max - group.min) / (group.entries.length + 1));
    group.entries.forEach((entry, index) => { entry.preferred = port(entry.node, entry.side, index, group.entries.length)[entry.axis]; });
  }
  const available = (group, value) => group.used.every(used => Math.abs(used - value) >= group.gap - .01);
  const assign = (entry, value) => { entry.value = value; entry.group.used.push(value); };
  const position = (entry, inset, value = entry.value) => ({ ...port(entry.node, entry.side, 0, 1, inset), [entry.axis]: value });
  // Share a coordinate on facing sides before assigning the remaining ports.
  // Different fan-in/fan-out counts must not force a tiny bend in a clear lane.
  for (const edge of edges) {
    const [a, b] = endpoints.get(edge.id);
    if (a.axis !== b.axis || a.side === b.side) continue;
    const min = Math.max(a.group.min, b.group.min), max = Math.min(a.group.max, b.group.max);
    if (min > max) continue;
    const preferred = Math.max(min, Math.min(max, (a.preferred + b.preferred) / 2));
    const candidates = [preferred, ...Array.from({ length: 33 }, (_, i) => min + (max - min) * i / 32)].sort((x, y) => Math.abs(x - preferred) - Math.abs(y - preferred));
    const value = candidates.find(value => available(a.group, value) && available(b.group, value) && !blocked(position(a, CLEARANCE, value), position(b, CLEARANCE, value), boxes));
    if (value !== undefined) { assign(a, value); assign(b, value); }
  }
  for (const group of groups.values()) for (const entry of group.entries) {
    if (entry.value !== undefined) continue;
    const used = [group.min - group.gap, ...group.used.toSorted((a, b) => a - b), group.max + group.gap];
    const candidates = [entry.preferred, ...used.slice(1).flatMap((value, i) => [used[i] + group.gap, value - group.gap, (used[i] + value) / 2])]
      .filter(value => value >= group.min && value <= group.max).sort((a, b) => Math.abs(a - entry.preferred) - Math.abs(b - entry.preferred));
    // Very crowded sides can use tighter spacing, but never reuse a port.
    const value = candidates.find(value => available(group, value)) ?? used.slice(1).map((value, i) => ({ size: value - used[i], value: (value + used[i]) / 2 })).sort((a, b) => b.size - a.size)[0].value;
    assign(entry, value);
  }
  return new Map([...endpoints].map(([id, entries]) => [id, entries.map(entry => ({ anchor: position(entry, entry.end ? 5 : 0), outer: position(entry, CLEARANCE) }))]));
}

function blocked(a, b, boxes) {
  return boxes.some(box => a.x === b.x
    ? between(a.x, box.left, box.right) && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
    : between(a.y, box.top, box.bottom) && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right);
}

function push(heap, entry) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index) {
    const parent = (index - 1) >> 1;
    if (heap[parent].score <= entry.score) break;
    heap[index] = heap[parent]; index = parent;
  }
  heap[index] = entry;
}

function pop(heap) {
  const first = heap[0], last = heap.pop();
  if (heap.length) {
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
      if (heap[child].score >= last.score) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  }
  return first;
}

function route(start, end, boxes, occupied, lane) {
  const xs = new Set([start.x, end.x]), ys = new Set([start.y, end.y]);
  for (const box of boxes) {
    for (const offset of [0, 16, 32]) {
      xs.add(box.left - offset); xs.add(box.right + offset);
      ys.add(box.top - offset); ys.add(box.bottom + offset);
    }
  }
  xs.add(Math.min(...xs) - lane); xs.add(Math.max(...xs) + lane);
  ys.add(Math.min(...ys) - lane); ys.add(Math.max(...ys) + lane);
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
  const key = (i, j, direction) => (j * x.length + i) * 2 + direction;
  const heap = [], costs = new Map(), previous = new Map(), states = new Map();
  const initial = { i: x.indexOf(start.x), j: y.indexOf(start.y), direction: 0, cost: 0, score: distance(start, end) };
  initial.key = key(initial.i, initial.j, 0);
  push(heap, initial); costs.set(initial.key, 0);
  while (heap.length) {
    const current = pop(heap);
    if (current.cost !== costs.get(current.key)) continue;
    const a = { x: x[current.i], y: y[current.j] };
    if (a.x === end.x && a.y === end.y) {
      const points = [a];
      for (let id = current.key; previous.has(id);) {
        id = previous.get(id);
        const state = states.get(id);
        points.push({ x: x[state.i], y: y[state.j] });
      }
      return points.reverse();
    }
    states.set(current.key, current);
    for (const [di, dj, direction] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) {
      const i = current.i + di, j = current.j + dj;
      if (i < 0 || j < 0 || i >= x.length || j >= y.length) continue;
      const b = { x: x[i], y: y[j] };
      if (blocked(a, b, boxes)) continue;
      // Separate shared corridors; penalize crossings but allow non-planar graphs.
      let penalty = 0;
      for (const [c, d] of occupied) {
        if (a.x === b.x && c.x === d.x && a.x === c.x && Math.max(a.y, b.y) > Math.min(c.y, d.y) && Math.min(a.y, b.y) < Math.max(c.y, d.y)) penalty += 4000;
        else if (a.y === b.y && c.y === d.y && a.y === c.y && Math.max(a.x, b.x) > Math.min(c.x, d.x) && Math.min(a.x, b.x) < Math.max(c.x, d.x)) penalty += 4000;
        else if (a.x === b.x && c.y === d.y && between(a.x, c.x, d.x) && between(c.y, a.y, b.y)) penalty += 80;
        else if (a.y === b.y && c.x === d.x && between(a.y, c.y, d.y) && between(c.x, a.x, b.x)) penalty += 80;
      }
      const nextKey = key(i, j, direction);
      const cost = current.cost + distance(a, b) + (direction !== current.direction ? 24 : 0) + penalty;
      if (cost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, cost); previous.set(nextKey, current.key);
      push(heap, { i, j, direction, key: nextKey, cost, score: cost + distance(b, end) });
    }
  }
  // Never draw an unsafe straight fallback through a node.
  return null;
}

function simplify(points) {
  return points.filter((point, index) => !index || index === points.length - 1 ||
    !((points[index - 1].x === point.x && point.x === points[index + 1].x) || (points[index - 1].y === point.y && point.y === points[index + 1].y)));
}

export function bezierPath(points) {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`, last = points[0];
  const line = point => {
    path += ` C ${last.x + (point.x - last.x) / 3} ${last.y + (point.y - last.y) / 3}, ${last.x + (point.x - last.x) * 2 / 3} ${last.y + (point.y - last.y) * 2 / 3}, ${point.x} ${point.y}`;
    last = point;
  };
  for (let index = 1; index < points.length - 1; index++) {
    const a = points[index - 1], b = points[index], c = points[index + 1];
    const radius = Math.min(24, distance(a, b) / 2, distance(b, c) / 2);
    const before = { x: b.x + Math.sign(a.x - b.x) * radius, y: b.y + Math.sign(a.y - b.y) * radius };
    const after = { x: b.x + Math.sign(c.x - b.x) * radius, y: b.y + Math.sign(c.y - b.y) * radius };
    line(before);
    path += ` C ${b.x} ${b.y}, ${b.x} ${b.y}, ${after.x} ${after.y}`;
    last = after;
  }
  line(points.at(-1));
  return path;
}

const nodeBox = node => ({ left: node.x - CLEARANCE, right: node.x + NODE_WIDTH + CLEARANCE, top: node.y - CLEARANCE, bottom: node.y + NODE_HEIGHT + CLEARANCE });
const contains = (box, point) => between(point.x, box.left, box.right) && between(point.y, box.top, box.bottom);

export function workflowConnection(nodes, fromId, cursor) {
  const from = nodes.find(node => node.id === fromId);
  if (!from || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return '';
  const target = nodes.find(node => cursor.x >= node.x && cursor.x <= node.x + NODE_WIDTH && cursor.y >= node.y && cursor.y <= node.y + NODE_HEIGHT);
  // A hovered card is a connection destination, never a point inside the path.
  if (target?.id === fromId) return '';
  const boxes = nodes.map(nodeBox);
  const start = port(from, 'right', 0, 1), outer = port(from, 'right', 0, 1, CLEARANCE);
  let end = { x: cursor.x, y: cursor.y }, anchor;
  if (target) {
    const side = sides(from, target)[1];
    end = port(target, side, 0, 1, CLEARANCE);
    anchor = port(target, side, 0, 1, 5);
  } else {
    const box = boxes.find(box => contains(box, end));
    if (box) {
      // Keep a pointer close to a card outside its safety margin as well.
      end = [
        { x: box.left, y: end.y }, { x: box.right, y: end.y },
        { x: end.x, y: box.top }, { x: end.x, y: box.bottom },
      ].sort((a, b) => distance(a, cursor) - distance(b, cursor))[0];
    }
  }
  const middle = route(outer, end, boxes, [], 24);
  return middle ? bezierPath(simplify([start, ...middle, ...(anchor ? [anchor] : [])])) : '';
}

export function workflowRoutes(nodes, transitions) {
  const lookup = new Map(nodes.map(node => [node.id, node]));
  const edges = transitions.filter(edge => lookup.has(edge.from) && lookup.has(edge.to) && edge.from !== edge.to)
    .map(edge => ({ ...edge, sides: sides(lookup.get(edge.from), lookup.get(edge.to)) }));
  const boxes = nodes.map(nodeBox);
  const ports = edgePorts(edges, lookup, boxes);
  const occupied = [], labels = [];
  return edges.map((edge, index) => {
    const endpoints = ports.get(edge.id);
    const middle = route(endpoints[0].outer, endpoints[1].outer, boxes, occupied, 24 + index * 12);
    if (!middle) return { ...edge, path: '', points: [], label: null };
    const points = simplify([endpoints[0].anchor, ...middle, endpoints[1].anchor]);
    const segments = points.slice(1).map((point, i) => [points[i], point]);
    occupied.push(...segments);
    const labelWidth = Math.min(10, [...edge.name].length) * 12 + 16;
    let label = null;
    for (const [a, b] of [...segments].sort((a, b) => distance(...b) - distance(...a))) {
      if (a.y !== b.y || distance(a, b) < labelWidth + 24) continue;
      const candidate = { x: (a.x + b.x) / 2, y: a.y, width: labelWidth };
      if (boxes.some(box => candidate.x + labelWidth / 2 > box.left && candidate.x - labelWidth / 2 < box.right && candidate.y + 13 > box.top && candidate.y - 13 < box.bottom)) continue;
      if (labels.some(item => Math.abs(item.y - candidate.y) < 28 && Math.abs(item.x - candidate.x) < (item.width + labelWidth) / 2 + 8)) continue;
      label = candidate; labels.push(label); break;
    }
    return { ...edge, points, path: bezierPath(points), label };
  });
}
