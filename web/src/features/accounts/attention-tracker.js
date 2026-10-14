// Successful snapshots form the baseline. Failed reads do not change it.
export function createAttentionTracker() {
  let scope, previous = null;
  return {
    reset(value) { scope = value; previous = null; },
    accept(value, items) {
      if (scope !== value) { scope = value; previous = null; }
      const current = new Map(items.map(item => [item.id, item]));
      const additions = previous === null ? [] : [...current.values()].filter(item => !previous.has(item.id));
      previous = current;
      return additions;
    },
  };
}
