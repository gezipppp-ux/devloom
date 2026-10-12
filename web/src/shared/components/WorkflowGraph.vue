<script setup>
/* global document, ResizeObserver */
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { FullscreenOutlined, FullscreenExitOutlined, ZoomInOutlined, ZoomOutOutlined } from "@antdv-next/icons";
import { NODE_WIDTH, NODE_HEIGHT, nodesOverlap, workflowConnection, workflowNodes, workflowRoutes } from "./workflow-routing.js";

const props = defineProps({ definition: { type: Object, required: true }, current: { type: String, default: "" }, selected: { type: String, default: "" }, selectedEdge: { type: String, default: "" }, editable: Boolean });
const emit = defineEmits(["select", "select-edge", "move", "add", "connect", "clear", "delete"]);
const svg = ref(), scroll = ref(), markerId = useId(), connection = ref(null), gestureBounds = ref(null);
const frame = ref(), fullscreenButton = ref(), fullscreen = ref(false), fallbackFullscreen = ref(false), zoom = ref(1), fitting = ref(true);
const fullscreenChanging = ref(false);
let resizeObserver, previousOverflow = '', alive = true;
const kinds = { initial: '初始', normal: '普通', completed: '完成', cancelled: '取消' };
const nodes = computed(() => workflowNodes(props.definition));
const routes = computed(() => workflowRoutes(nodes.value, props.definition.transitions));
const bounds = computed(() => {
  if (gestureBounds.value) return gestureBounds.value;
  const points = routes.value.flatMap(edge => edge.points).concat(nodes.value.flatMap(node => [node, { x: node.x + NODE_WIDTH, y: node.y + NODE_HEIGHT }]));
  const x = Math.min(0, ...points.map(point => point.x - 32)), y = Math.min(0, ...points.map(point => point.y - 32));
  return { x, y, width: Math.max(760, ...points.map(point => point.x + 64)) - x, height: Math.max(400, ...points.map(point => point.y + 80)) - y };
});
const point = id => nodes.value.find(node => node.id === id);
const tone = edge => point(edge.to)?.kind || 'normal';
defineExpose({ focusCanvas: () => scroll.value?.focus() });
async function fit() {
  fitting.value = true;
  await nextTick();
  if (!scroll.value) return;
  zoom.value = Math.max(.15, Math.min(1, (scroll.value.clientWidth - 24) / bounds.value.width, (scroll.value.clientHeight - 24) / bounds.value.height));
}
function changeZoom(amount) { fitting.value = false; zoom.value = Math.max(.15, Math.min(2, Math.round((zoom.value + amount) * 100) / 100)); }
function fullscreenChanged() { fullscreen.value = document.fullscreenElement === frame.value || fallbackFullscreen.value; if (fitting.value) void fit(); }
async function exitNativeFullscreen(element) {
  if (document.fullscreenElement !== element) return;
  // Escape or element removal can finish the browser's exit before this promise.
  try { await document.exitFullscreen(); } catch { /* fullscreenchange remains authoritative. */ }
}
async function toggleFullscreen() {
  if (fullscreenChanging.value || !alive) return;
  fullscreenChanging.value = true;
  const element = frame.value;
  try {
    if (fullscreen.value) {
      await exitNativeFullscreen(element);
      if (fallbackFullscreen.value) { fallbackFullscreen.value = false; document.body.style.overflow = previousOverflow; }
      fullscreenChanged(); await nextTick(); fullscreenButton.value?.focus();
    } else {
      try {
        if (!element.requestFullscreen) throw new Error('Fullscreen unavailable');
        await element.requestFullscreen();
      } catch {
        if (!alive) return;
        previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
        fallbackFullscreen.value = true;
      }
      if (!alive) { await exitNativeFullscreen(element); return; }
      fullscreenChanged(); await fit(); scroll.value?.focus();
    }
  } finally { fullscreenChanging.value = false; }
}
onMounted(() => {
  resizeObserver = new ResizeObserver(() => { if (fitting.value && !drag) void fit(); });
  resizeObserver.observe(scroll.value);
  document.addEventListener('fullscreenchange', fullscreenChanged);
  void fit();
});
onUnmounted(() => {
  alive = false;
  resizeObserver?.disconnect(); document.removeEventListener('fullscreenchange', fullscreenChanged);
  if (fallbackFullscreen.value) document.body.style.overflow = previousOverflow;
  void exitNativeFullscreen(frame.value);
});
watch(bounds, () => { if (fitting.value && !drag) void fit(); });
let drag = null;
function coordinates(event) {
  const position = svg.value.createSVGPoint(); position.x = event.clientX; position.y = event.clientY;
  return position.matrixTransform(svg.value.getScreenCTM().inverse());
}
function cancelGesture() { drag = null; gestureBounds.value = null; }
function clear() { cancelGesture(); connection.value = null; emit('clear'); }
watch(() => props.editable, editable => { if (!editable) { cancelGesture(); connection.value = null; } });
function select(node) {
  if (connection.value && props.editable) {
    if (connection.value.from !== node.id) { emit('connect', { from: connection.value.from, to: node.id }); connection.value = null; }
  } else emit('select', node.id);
}
function down(event, node) {
  if (!props.editable || event.button !== 0 || connection.value) return;
  const position = coordinates(event);
  gestureBounds.value = { ...bounds.value };
  drag = { id: node.id, start: position, x: node.x, y: node.y, moved: false };
  svg.value.setPointerCapture(event.pointerId);
}
function moveNode(node, x, y) {
  const next = { id: node.id, x: Math.min(100000, Math.max(32, Math.round(x / 8) * 8)), y: Math.min(100000, Math.max(32, Math.round(y / 8) * 8)) };
  if (!nodes.value.some(other => other.id !== node.id && nodesOverlap(next, other))) emit('move', next);
}
function move(event) {
  if (!props.editable) return;
  const position = coordinates(event);
  if (connection.value) connection.value = { ...connection.value, x: position.x, y: position.y };
  if (!drag) return;
  if (Math.hypot(position.x - drag.start.x, position.y - drag.start.y) > 4) drag.moved = true;
  if (drag.moved) moveNode(drag, drag.x + position.x - drag.start.x, drag.y + position.y - drag.start.y);
}
function up(event) {
  if (connection.value && props.editable) {
    const position = coordinates(event);
    const target = nodes.value.find(node => position.x >= node.x - 10 && position.x <= node.x + NODE_WIDTH + 16 && position.y >= node.y && position.y <= node.y + NODE_HEIGHT);
    if (target && target.id !== connection.value.from) select(target);
  }
  if (drag && !drag.moved) select(drag);
  cancelGesture();
}
function connect(event, node) {
  if (!props.editable || event.button !== 0) return;
  if (connection.value) { select(node); return; }
  connection.value = { from: node.id, x: node.x + NODE_WIDTH + 48, y: node.y + NODE_HEIGHT / 2 };
  svg.value.setPointerCapture(event.pointerId);
}
function connectKey(node) {
  if (!props.editable) return;
  if (connection.value) select(node);
  else connection.value = { from: node.id, x: node.x + NODE_WIDTH + 48, y: node.y + NODE_HEIGHT / 2 };
}
function key(event, node) {
  if (["Enter", " "].includes(event.key)) { event.preventDefault(); select(node); }
  if (props.editable && event.key.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    moveNode(node, node.x + ({ ArrowLeft: -step, ArrowRight: step }[event.key] || 0), node.y + ({ ArrowUp: -step, ArrowDown: step }[event.key] || 0));
  }
}
function canvasKey(event) {
  if (event.key === 'Tab' && fallbackFullscreen.value) {
    const controls = [...frame.value.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.target.closest('input, select, textarea, button')) return;
  if (event.key === 'Escape') { event.preventDefault(); clear(); scroll.value.focus(); }
  if (!props.editable) return;
  if (event.key === 'Delete' && (props.selected || props.selectedEdge)) { event.preventDefault(); emit('delete'); }
  if (event.key === 'Insert') {
    event.preventDefault();
    emit('add', { x: scroll.value.scrollLeft + bounds.value.x + 80, y: scroll.value.scrollTop + bounds.value.y + 100 });
  }
}
function fullscreenKey(event) {
  if (event.key === 'Escape' && fullscreen.value) { event.preventDefault(); event.stopPropagation(); void toggleFullscreen(); }
}
function add(event) { if (props.editable && [svg.value, scroll.value].includes(event.target)) emit('add', coordinates(event)); }
const preview = computed(() => workflowConnection(nodes.value, connection.value?.from, connection.value));
</script>

<template>
  <section ref="frame" class="workflow-canvas" :class="{ 'is-editable': editable, 'is-fullscreen': fullscreen, 'fallback-fullscreen': fallbackFullscreen }" :role="fallbackFullscreen ? 'dialog' : undefined" :aria-modal="fallbackFullscreen ? true : undefined" aria-label="流程画布" @keydown="canvasKey" @keydown.capture="fullscreenKey">
    <div class="workflow-toolbar" aria-label="画布视图">
      <div class="workflow-zoom"><button aria-label="缩小流程图" title="缩小" :disabled="zoom <= .15" @click="changeZoom(-.1)"><ZoomOutOutlined /></button><output aria-label="画布缩放比例">{{ Math.round(zoom * 100) }}%</output><button aria-label="放大流程图" title="放大" :disabled="zoom >= 2" @click="changeZoom(.1)"><ZoomInOutlined /></button><button @click="fit">适应画布</button></div>
      <button ref="fullscreenButton" :aria-label="fullscreen ? '退出全屏' : '全屏画布'" :aria-pressed="fullscreen" :disabled="fullscreenChanging" @click="toggleFullscreen"><FullscreenExitOutlined v-if="fullscreen" aria-hidden="true" /><FullscreenOutlined v-else aria-hidden="true" />{{ fullscreen ? '退出全屏' : '全屏画布' }}</button>
    </div>
    <div class="workflow-legend" aria-label="状态类型图例">
      <span v-for="(name, kind) in kinds" :key="kind" :class="`tone-${kind}`"><i />{{ name }}</span>
      <span class="workflow-count">{{ nodes.length }} 个状态 · {{ definition.transitions.length }} 条连线</span>
    </div>
    <p v-if="editable" class="workflow-guide">双击空白新增状态 · 拖动节点调整位置 · 拖动或依次点击连接点连线 · 点击节点／连线直接编辑</p>
    <div class="workflow-body">
      <div ref="scroll" class="workflow-scroll" tabindex="0" aria-label="流程图，可横向滚动；Insert 新增状态，Delete 删除选中项" @dblclick.self="add" @pointerdown.self="clear">
        <svg ref="svg" :width="bounds.width * zoom" :height="bounds.height * zoom" :viewBox="`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`" role="group" aria-label="事项流程图" @dblclick="add" @pointerdown.self="clear" @pointermove="move" @pointerup="up" @pointercancel="cancelGesture(); connection = null" @lostpointercapture="cancelGesture">
          <defs><marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
          <g v-for="edge in routes" :key="edge.id" class="workflow-edge" :class="[`tone-${tone(edge)}`, { selected: edge.id === selectedEdge, highlighted: edge.from === (selected || current) }]" :tabindex="editable ? 0 : undefined" :role="editable ? 'button' : undefined" :aria-label="`连线：${edge.name}，${point(edge.from)?.name} → ${point(edge.to)?.name}`" @click.stop="editable && emit('select-edge', edge.id)" @keydown.enter.prevent="editable && emit('select-edge', edge.id)" @keydown.space.prevent="editable && emit('select-edge', edge.id)">
            <title>{{ point(edge.from)?.name }} → {{ point(edge.to)?.name }}：{{ edge.name }}</title>
            <path class="edge-separation" :d="edge.path" />
            <path class="edge-line" :d="edge.path" :marker-end="`url(#${markerId})`" />
            <path v-if="editable" class="edge-hit" :d="edge.path" />
          </g>
          <g v-for="edge in routes.filter(item => item.label)" :key="`label-${edge.id}`" class="edge-label" :class="`tone-${tone(edge)}`" :transform="`translate(${edge.label.x}, ${edge.label.y})`" @click.stop="editable && emit('select-edge', edge.id)">
            <title>{{ edge.name }}</title><rect :x="-edge.label.width / 2" y="-12" :width="edge.label.width" height="24" rx="6" /><text text-anchor="middle" y="4">{{ [...edge.name].length > 10 ? [...edge.name].slice(0, 9).join('') + '…' : edge.name }}</text>
          </g>
          <path v-if="preview" class="connection-preview" :d="preview" />
          <g v-for="node in nodes" :key="node.id" class="workflow-node" :data-node-id="node.id" :transform="`translate(${node.x}, ${node.y})`" :class="[`tone-${node.kind}`, { active: node.id === current, selected: node.id === selected, editable, 'connection-target': connection && connection.from !== node.id }]" tabindex="0" role="button" :aria-label="`${node.name}${node.id === current ? '，当前状态' : ''}`" :aria-pressed="node.id === selected" @pointerdown.stop="down($event, node)" @click.stop="!editable && select(node)" @keydown="key($event, node)">
            <title>{{ node.name }} · {{ kinds[node.kind] }}{{ node.allowDevelopment ? ' · 可开发' : '' }}</title>
            <rect class="node-card" :width="NODE_WIDTH" :height="NODE_HEIGHT" rx="12" />
            <rect class="node-accent" x="0" y="16" width="4" height="40" rx="2" />
            <text class="node-name" x="16" y="29">{{ [...node.name].length > 9 ? [...node.name].slice(0, 8).join('') + '…' : node.name }}</text>
            <text class="node-hint" x="16" y="53">{{ kinds[node.kind] }}{{ node.allowDevelopment ? ' · 可开发' : '' }}{{ node.id === current ? ' · 当前' : '' }}</text>
            <g v-if="editable" class="node-port" :transform="`translate(${NODE_WIDTH}, ${NODE_HEIGHT / 2})`" tabindex="0" role="button" :aria-label="`连接 ${node.name}`" @pointerdown.stop="connect($event, node)" @keydown.enter.stop.prevent="connectKey(node)" @keydown.space.stop.prevent="connectKey(node)"><circle class="port-hit" r="18" /><circle class="port-dot" r="6" /></g>
          </g>
        </svg>
      </div>
      <aside v-if="$slots.inspector && (selected || selectedEdge)" class="workflow-inspector" aria-label="画布内属性编辑"><slot name="inspector" /></aside>
    </div>
    <div v-if="editable" class="workflow-footer"><span>键盘：Enter 选取 · 方向键移动 · Insert 新增 · Delete 删除 · Esc 取消</span><span role="status">{{ connection ? `从「${point(connection.from)?.name}」连接：选择目标状态，Esc 取消。` : '修改后保存草稿' }}</span></div>
    <div v-if="$slots.actions" class="workflow-actions"><slot name="actions" :fullscreen="fullscreen" /></div>
  </section>
</template>

<style scoped>
.workflow-canvas { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--canvas); }
.workflow-toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.workflow-toolbar button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.workflow-zoom { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.workflow-zoom output { min-width: 42px; text-align: center; color: var(--muted); font-size: 12px; }
.workflow-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px 16px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--surface); }
.workflow-canvas.is-fullscreen { display: flex; flex-direction: column; width: 100%; height: 100dvh; border: 0; border-radius: 0; }
.fallback-fullscreen { position: fixed; inset: 0; z-index: 1000; }
.is-fullscreen .workflow-body { flex: 1; min-height: 0; }
.is-fullscreen .workflow-scroll { height: 100%; max-height: none; }
.is-fullscreen .workflow-inspector { max-height: none; }
.workflow-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; padding: 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
.workflow-legend span { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.workflow-legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--node-color); }
.workflow-count { margin-left: auto; color: var(--muted); }
.tone-initial { --node-color: var(--accent); --node-soft: var(--selected); }
.tone-normal { --node-color: var(--muted); --node-soft: var(--soft); }
.tone-completed { --node-color: var(--success); --node-soft: var(--success-soft); }
.tone-cancelled { --node-color: var(--danger); --node-soft: var(--danger-soft); }
.workflow-guide { padding: 12px 16px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.workflow-body { display: flex; min-width: 0; }
.workflow-scroll { width: 100%; min-width: 0; height: 460px; max-height: 560px; overflow: auto; background-image: radial-gradient(var(--field-border) .7px, transparent .7px); background-size: 16px 16px; }
.workflow-scroll:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
svg { display: block; }
.workflow-edge path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.edge-separation { stroke: var(--canvas); stroke-width: 7; pointer-events: none; }
.edge-line { stroke: var(--node-color); stroke-width: 1.8; pointer-events: none; }
.edge-hit { stroke: transparent; stroke-width: 14; cursor: pointer; }
.workflow-edge.selected .edge-line, .workflow-edge:focus-visible .edge-line, .workflow-edge.highlighted .edge-line { stroke: var(--accent); stroke-width: 3; }
.edge-label { cursor: pointer; }
.edge-label rect { fill: var(--canvas); stroke: var(--line); }
.edge-label text { fill: var(--node-color); font-size: 11px; }
.connection-preview { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 5; pointer-events: none; }
.node-card { fill: var(--surface); stroke: var(--node-color); stroke-width: 1.5; }
.node-accent { fill: var(--node-color); }
.node-name { fill: var(--ink); font-size: 14px; font-weight: 600; }
.node-hint { fill: var(--node-color); font-size: 11px; }
text { pointer-events: none; user-select: none; }
.active .node-card { fill: var(--node-soft); stroke-width: 3; }
.workflow-node.selected .node-card, .workflow-node:focus-visible .node-card { fill: var(--node-soft); stroke: var(--focus); stroke-width: 3; }
.editable { cursor: grab; touch-action: none; }
.editable:active { cursor: grabbing; }
.connection-target { cursor: crosshair; }
.node-port { cursor: crosshair; outline: none; }
.port-hit { fill: transparent; }
.port-dot { fill: var(--surface); stroke: var(--node-color); stroke-width: 2; }
.node-port:hover .port-dot, .node-port:focus-visible .port-dot { fill: var(--accent); stroke-width: 3; }
.workflow-inspector { flex: 0 0 280px; min-width: 0; padding: 20px; background: var(--surface); border-left: 1px solid var(--line); max-height: 560px; overflow-y: auto; }
.workflow-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); color: var(--muted); background: var(--surface); font-size: 12px; }
@media (max-width: 900px) { .workflow-body { flex-direction: column; } .workflow-inspector { flex: auto; border-left: 0; border-top: 1px solid var(--line); max-height: none; } .workflow-scroll { max-height: 420px; } .is-fullscreen .workflow-body { overflow-y: auto; } .is-fullscreen .workflow-scroll { flex: none; height: 45dvh; min-height: 220px; } }
@media (max-width: 480px) { .workflow-legend { gap: 12px; } .workflow-count { width: 100%; margin-left: 0; } .workflow-inspector { padding: 16px; } }
</style>
