/* global window, ResizeObserver, MutationObserver, requestAnimationFrame, cancelAnimationFrame */
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";

export function usePreviewLayout(props, height, width, fitting, panel) {
  const root = ref(), stage = ref(), availableWidth = ref(640), budget = ref(400);
  let observer, chromeObserver, timeline, scheduled = 0;
  function measure() {
    scheduled = 0;
    if (!props.active || !stage.value?.clientWidth) return;
    const nextWidth = stage.value.clientWidth;
    if (Math.abs(nextWidth - availableWidth.value) > 1) {
      availableWidth.value = nextWidth;
      // Reflow at the new container width before deciding whether a fixed-width
      // document needs scaling. Do not retain the old fullscreen viewport width.
      width.value = 0;
    }
    const chrome = [...root.value.children].filter(child => child !== stage.value)
      .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
    const space = props.fullscreen ? root.value.clientHeight - chrome
      : Math.min(window.innerHeight * .62, timeline?.clientHeight || window.innerHeight * .62)
        - (root.value.querySelector(".preview-header")?.offsetHeight || 40)
        - (root.value.querySelector(".preview-footer")?.offsetHeight || 40) - 24;
    budget.value = Math.max(props.fullscreen ? 80 : 160, props.fullscreen ? space : Math.min(640, space));
  }
  function refresh() { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(measure); }
  const frameWidth = computed(() => Math.max(availableWidth.value, width.value));
  const scale = computed(() => fitting.value ? Math.min(1, availableWidth.value / frameWidth.value, budget.value / height.value) : 1);
  const canvasStyle = computed(() => ({ width: frameWidth.value * scale.value + "px", height: Math.min(budget.value, height.value * scale.value) + "px" }));
  // Keep the iframe viewport independent of its document's measured height.
  // Otherwise generated 100vh pages grow on every resize notification. The
  // sandbox scales its content inside this stable viewport instead.
  const frameStyle = computed(() => ({ width: frameWidth.value + "px", height: budget.value + "px" }));
  const stageStyle = computed(() => ({ height: (props.fullscreen ? budget.value : Math.min(budget.value, height.value * scale.value)) + "px" }));
  onMounted(() => {
    timeline = root.value.closest(".timeline");
    observer = new ResizeObserver(refresh);
    for (const target of [root.value, stage.value, timeline, ...root.value.children].filter(Boolean)) observer.observe(target);
    chromeObserver = new MutationObserver(() => {
      for (const target of root.value.children) observer.observe(target);
      refresh();
    });
    chromeObserver.observe(root.value, { childList: true });
    window.addEventListener("resize", refresh);
    refresh();
  });
  watch([() => props.active, () => props.fullscreen, height, width, panel], async () => {
    await nextTick();
    for (const target of root.value?.children || []) observer?.observe(target);
    refresh();
  });
  onBeforeUnmount(() => { observer?.disconnect(); chromeObserver?.disconnect(); cancelAnimationFrame(scheduled); window.removeEventListener("resize", refresh); });
  return { root, stage, scale, canvasStyle, frameStyle, stageStyle };
}
