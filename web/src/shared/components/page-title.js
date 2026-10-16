/* global document */
import { computed, inject, onScopeDispose, provide, shallowReactive, watchEffect } from "vue";

const titleContext = Symbol("page-title");

// One document writer; mounted detail pages override their enclosing page.
export function provideDocumentTitle(fallback, enabled = () => true) {
  const entries = shallowReactive(new Map());
  provide(titleContext, { entries, depth: 0 });
  watchEffect(() => {
    let parts = fallback(), depth = 0;
    if (enabled()) {
      for (const entry of entries.values()) {
        const value = entry.parts.value;
        if (value && entry.depth >= depth) { parts = value; depth = entry.depth; }
      }
    }
    document.title = [...(parts || []), "DevLoom"]
      .filter(part => typeof part === "string" && part.trim())
      .map(part => part.replace(/\s+/g, " ").trim()).join(" · ");
  }, { flush: "post" });
  onScopeDispose(() => { document.title = "DevLoom"; });
}

export function usePageTitle(parts) {
  const parent = inject(titleContext, null);
  if (!parent) return;
  const key = Symbol("page");
  const depth = parent.depth + 1;
  parent.entries.set(key, { parts: computed(parts), depth });
  provide(titleContext, { entries: parent.entries, depth });
  onScopeDispose(() => parent.entries.delete(key));
}
