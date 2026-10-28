function hashId(id) {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.codePointAt(0), 16777619);
  return value >>> 0;
}

const palettes = new Map();
function allocate(id, used) {
  const start = hashId(id) % 360;
  if (!used.size) return start;
  let best = start, bestDistance = -1;
  for (let offset = 0; offset < 360; offset++) {
    const hue = (start + offset * 137) % 360;
    let distance = 180;
    for (const other of used) distance = Math.min(distance, Math.abs(hue - other), 360 - Math.abs(hue - other));
    if (distance > bestDistance) { best = hue; bestDistance = distance; }
  }
  return best;
}

// Allocate the complete known set first, so unknown states cannot change its colours.
export function statusHue(status, knownStatuses) {
  const known = [...new Set(knownStatuses)].sort();
  const cacheKey = JSON.stringify(known);
  let palette = palettes.get(cacheKey);
  if (!palette) {
    const used = new Set(), assigned = new Map();
    for (const id of known) {
      const hue = allocate(id, used);
      used.add(hue);
      assigned.set(id, hue);
    }
    palette = { used, assigned };
    if (palettes.size >= 128) palettes.delete(palettes.keys().next().value);
    palettes.set(cacheKey, palette);
  }
  if (palette.assigned.has(status)) return palette.assigned.get(status);
  let hue = hashId(status) % 360;
  while (palette.used.has(hue)) hue = (hue + 137) % 360;
  return hue;
}
