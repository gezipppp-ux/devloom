/* global setTimeout, clearTimeout, AbortController */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { appApi } from "../../shared/api/api.js";
import { createRequestId } from "../../shared/api/request-id.js";

// The preparation request and its polling belong to one mounted project.
export function useProjectSpace(projectId, initialSpace, changed = () => {}) {
  const space = ref(null), submitting = ref(false), checking = ref(false), unknown = ref(false);
  const connectionError = ref(""), submissionError = ref(""), restricted = ref(false);
  const preparing = computed(() => space.value?.status === "preparing");
  const busy = computed(() => submitting.value || unknown.value || preparing.value);
  let alive = true, epoch = 0, readGeneration = 0, timer, pending;
  const requests = new Set();
  const current = expected => alive && expected === epoch;
  async function request(url, input) {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await appApi(url, input, { signal: controller.signal }); }
    finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function abortRequests() { for (const controller of requests) controller.abort(); requests.clear(); }
  function schedule() {
    clearTimeout(timer);
    if (alive && !restricted.value && (preparing.value || unknown.value)) timer = setTimeout(reload, 2000);
  }
  function accept(value) {
    if (value && space.value) {
      if (value.revision < space.value.revision) return;
      if (value.revision === space.value.revision && Date.parse(value.progress?.updatedAt || value.updatedAt) < Date.parse(space.value.progress?.updatedAt || space.value.updatedAt)) return;
    }
    const previous = space.value?.status;
    space.value = value;
    connectionError.value = "";
    if (!pending) unknown.value = false;
    if (value && (value.requestId === pending?.requestId || ["preparing", "ready"].includes(value.status))) {
      unknown.value = false;
      pending = undefined;
    }
    if (value?.status !== previous) changed();
    schedule();
  }
  function deny(failure) {
    if (![401, 403, 404].includes(failure.status)) return false;
    restricted.value = true; space.value = null; unknown.value = false; pending = undefined;
    clearTimeout(timer); changed(); return true;
  }
  async function reload() {
    if (!alive || checking.value || submitting.value || restricted.value) return;
    const expected = epoch, generation = ++readGeneration;
    checking.value = true;
    try {
      const result = await request(`/projects/${projectId()}/space`);
      if (!current(expected) || generation !== readGeneration) return;
      connectionError.value = "";
      accept(result.space);
    } catch (failure) {
      if (current(expected) && generation === readGeneration) { connectionError.value = failure.message; deny(failure); }
    } finally {
      if (current(expected) && generation === readGeneration) { checking.value = false; schedule(); }
    }
  }
  async function submit(input) {
    if (submitting.value || restricted.value || !alive) return;
    const expected = epoch;
    readGeneration++; checking.value = false; clearTimeout(timer); abortRequests();
    pending = input; submitting.value = true; submissionError.value = ""; connectionError.value = "";
    try {
      const result = await request(`/projects/${projectId()}/space/prepare`, input);
      if (!current(expected)) return;
      if (!result.space) throw new Error("未能确认创建结果，请重新确认本次请求。");
      unknown.value = false; pending = undefined; accept(result.space);
    } catch (failure) {
      if (!current(expected)) return;
      if (deny(failure)) submissionError.value = failure.message;
      else if ([400, 409, 422].includes(failure.status)) {
        submissionError.value = failure.message; pending = undefined; unknown.value = failure.status === 409;
      } else {
        // A lost response is not a failed creation. Keep the original UUID/input.
        unknown.value = true; connectionError.value = failure.message;
      }
    } finally {
      if (current(expected)) { submitting.value = false; schedule(); }
    }
  }
  function prepare(gitAccountId) {
    if (busy.value || !gitAccountId) return;
    return submit({ requestId: createRequestId(), gitAccountId });
  }
  async function confirm() {
    const expected = epoch;
    await reload();
    // Explicit confirmation may re-send only the same idempotent request.
    if (current(expected) && unknown.value && pending && !restricted.value && !connectionError.value) await submit(pending);
  }
  watch(projectId, () => {
    epoch++; readGeneration++; clearTimeout(timer); abortRequests(); pending = undefined;
    space.value = initialSpace(); submitting.value = false; checking.value = false; unknown.value = false;
    connectionError.value = ""; submissionError.value = ""; restricted.value = false; schedule();
  }, { immediate: true });
  watch(initialSpace, value => { if (!restricted.value && value) accept(value); });
  onBeforeUnmount(() => { alive = false; epoch++; readGeneration++; clearTimeout(timer); abortRequests(); });
  return { space, submitting, checking, unknown, preparing, busy, connectionError, submissionError, restricted, prepare, confirm };
}
