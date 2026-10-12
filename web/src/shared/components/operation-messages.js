/* global setTimeout, clearTimeout */
import { ref } from "vue";

export const operationMessages = ref([]);
export const messageRevision = ref(0);
const lifetimes = { success: 4000, info: 5000, warning: 8000, error: 10000 };
const timers = new Map();
let sequence = 0;

export function dismissMessage(id) {
  clearTimeout(timers.get(id)?.handle);
  timers.delete(id);
  operationMessages.value = operationMessages.value.filter(item => item.id !== id);
}

function schedule(id, duration) {
  clearTimeout(timers.get(id)?.handle);
  timers.set(id, { remaining: duration, deadline: Date.now() + duration,
    handle: setTimeout(() => dismissMessage(id), duration) });
}

export function showMessage(message, type = "info") {
  if (typeof message !== "string" || !message.trim()) return;
  if (!Object.hasOwn(lifetimes, type)) type = "info";
  const existing = operationMessages.value.find(item => item.message === message && item.type === type);
  const id = existing?.id || ++sequence;
  if (!existing) {
    if (operationMessages.value.length >= 4) dismissMessage(operationMessages.value[0].id);
    operationMessages.value.push({ id, message, type });
  }
  const timer = timers.get(id);
  if (timer && !timer.handle) timer.remaining = lifetimes[type];
  else schedule(id, lifetimes[type]);
  messageRevision.value++;
  return id;
}

export function pauseMessage(id) {
  const timer = timers.get(id);
  if (!timer?.handle) return;
  clearTimeout(timer.handle);
  timer.handle = null;
  timer.remaining = Math.max(0, timer.deadline - Date.now());
}

export function resumeMessage(id) {
  const timer = timers.get(id);
  if (timer && !timer.handle) schedule(id, timer.remaining);
}

export function clearMessages() {
  for (const timer of timers.values()) clearTimeout(timer.handle);
  timers.clear();
  operationMessages.value = [];
}
