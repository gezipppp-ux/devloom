<script setup>
import { computed, ref, useId } from "vue";
const props = defineProps({ definition: { type: Object, required: true }, current: { type: String, default: "" }, selected: { type: String, default: "" }, editable: Boolean });
const emit = defineEmits(["select", "move"]);
const svg = ref(), markerId = useId();
const nodes = computed(() => props.definition.nodes.map((node, index) => ({ ...node, x: node.x ?? 40 + index % 3 * 220, y: node.y ?? 40 + Math.floor(index / 3) * 120 })));
const width = computed(() => Math.max(740, ...nodes.value.map(n => n.x + 200)));
const height = computed(() => Math.max(260, ...nodes.value.map(n => n.y + 100 + props.definition.transitions.length * 18)));
const point = id => nodes.value.find(n => n.id === id);
function path(edge, index) {
  const from = point(edge.from), to = point(edge.to);
  if (to.x > from.x && Math.abs(to.y - from.y) < 70) return `M ${from.x + 160} ${from.y + 33} C ${from.x + 200} ${from.y + 33}, ${to.x - 40} ${to.y + 33}, ${to.x - 5} ${to.y + 33}`;
  const lane = Math.max(...nodes.value.map(node => node.y + 66)) + 28 + index * 18;
  return `M ${from.x + 80} ${from.y + 66} V ${lane} H ${to.x + 80} V ${to.y + 71}`;
}
let drag = null;
function down(event, node) { emit("select", node.id); if (!props.editable) return; drag = { id: node.id, x: event.clientX, y: event.clientY, nx: node.x, ny: node.y }; event.currentTarget.setPointerCapture(event.pointerId); }
function move(event) { if (!drag) return; emit("move", { id: drag.id, x: Math.max(8, drag.nx + event.clientX - drag.x), y: Math.max(8, drag.ny + event.clientY - drag.y) }); }
function key(event, node) { if (["Enter", " "].includes(event.key)) { event.preventDefault(); emit("select", node.id); } if (props.editable && event.key.startsWith("Arrow")) { event.preventDefault(); emit("move", { id: node.id, x: Math.max(8, node.x + ({ ArrowLeft: -16, ArrowRight: 16 }[event.key] || 0)), y: Math.max(8, node.y + ({ ArrowUp: -16, ArrowDown: 16 }[event.key] || 0)) }); } }
</script>
<template><div class="workflow-scroll" tabindex="0" aria-label="流程图，可横向滚动"><svg ref="svg" :width="width" :height="height" role="group" aria-label="事项流程图">
  <defs><marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path class="arrow" d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
  <template v-for="(edge, index) in definition.transitions" :key="edge.id"><g v-if="point(edge.from) && point(edge.to)"><title>{{ point(edge.from).name }} → {{ point(edge.to).name }}：{{ edge.name }}</title><path :class="{ highlighted: edge.from === (selected || current) }" :d="path(edge, index)" :marker-end="`url(#${markerId})`" /></g></template>
  <g v-for="node in nodes" :key="node.id" :transform="`translate(${node.x}, ${node.y})`" :class="{ active: node.id === current, selected: node.id === selected, editable }" tabindex="0" role="button" :aria-label="`${node.name}${node.id === current ? '，当前状态' : ''}`" @pointerdown="down($event, node)" @pointermove="move" @pointerup="drag = null" @pointercancel="drag = null" @keydown="key($event, node)"><rect width="160" height="66" rx="10" /><text x="12" y="26">{{ node.name }}</text><text class="node-hint" x="12" y="49">{{ { initial: '初始', normal: '普通', completed: '完成', cancelled: '取消' }[node.kind] }}{{ node.allowDevelopment ? ' · 可开发' : '' }}</text></g>
</svg></div></template>
<style scoped>
.workflow-scroll { width: 100%; max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--canvas); }
svg { display: block; } path { fill: none; stroke: var(--muted); stroke-width: 1.5; opacity: .55; } .highlighted { stroke: var(--accent); stroke-width: 2.5; opacity: 1; } .arrow { fill: var(--muted); stroke: none; opacity: 1; } rect { fill: var(--surface); stroke: var(--field-border); stroke-width: 2; } text { fill: var(--ink); font-size: 13px; pointer-events: none; } .node-hint { fill: var(--muted); font-size: 11px; } .active rect { fill: var(--selected); stroke: var(--accent); } .selected rect, g:focus rect { stroke: var(--focus); stroke-width: 4; } .editable { cursor: grab; touch-action: none; }
</style>
