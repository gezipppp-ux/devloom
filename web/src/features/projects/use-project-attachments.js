import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import {
  createDraftImageUrl,
  revokeDraftImageUrl,
} from "../../shared/api/attachment-drafts.js";
import { createRequestId } from "../../shared/api/request-id.js";

const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
function bitmap(bytes) {
  if (
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6))))
    return "image/gif";
  return "";
}
function base64(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return globalThis.btoa(result);
}
function label(name) {
  return name.replace(/[\\[\]<>`!*_]/g, "_").replace(/[\r\n]/g, " ");
}

export function useProjectAttachments(projectId) {
  const pending = ref([]),
    error = ref(""),
    busy = ref(false);
  let generation = 0;
  function reset() {
    generation++;
    for (const item of pending.value) revokeDraftImageUrl(item.previewUrl);
    pending.value = [];
    error.value = "";
    busy.value = false;
  }
  function remove(id) {
    const item = pending.value.find((entry) => entry.id === id);
    if (item) revokeDraftImageUrl(item.previewUrl);
    pending.value = pending.value.filter((entry) => entry.id !== id);
  }
  async function add(files) {
    if (busy.value) return "";
    const project = toValue(projectId),
      current = generation;
    if (!project) return "";
    busy.value = true;
    error.value = "";
    const links = [];
    try {
      for (const file of files) {
        if (current !== generation) return "";
        if (!file.size || file.size > MAX_FILE)
          throw new Error("每个附件须为非空文件，且不超过 10 MiB。");
        if (
          pending.value.length >= 20 ||
          pending.value.reduce((size, entry) => size + entry.size, 0) +
            file.size >
            MAX_TOTAL
        )
          throw new Error("附件最多 20 个，总大小不超过 20 MiB。");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (current !== generation || project !== toValue(projectId)) return "";
        const mime = bitmap(bytes),
          id = createRequestId();
        const source = `/api/projects/${project}/files/${id}`;
        const previewUrl = mime
          ? createDraftImageUrl(new globalThis.Blob([bytes], { type: mime }))
          : "";
        pending.value.push({
          id,
          name: file.name || "附件",
          mimeType: mime || file.type || "application/octet-stream",
          data: base64(bytes),
          size: file.size,
          source,
          previewUrl,
        });
        links.push(
          `${mime ? "!" : ""}[${label(file.name || "附件")}](${source})`,
        );
      }
    } catch (failure) {
      if (current === generation)
        error.value = failure.message || "无法读取附件，请重试。";
    } finally {
      if (current === generation) busy.value = false;
    }
    return links.join("\n");
  }
  const images = computed(() =>
    pending.value
      .filter((item) => item.previewUrl)
      .map((item) => ({ source: item.source, url: item.previewUrl })),
  );
  function serialize() {
    return pending.value.map(({ id, name, mimeType, data }) => ({
      id,
      name,
      mimeType,
      data,
    }));
  }
  watch(() => toValue(projectId), reset, { flush: "sync" });
  onScopeDispose(reset);
  return { pending, error, busy, images, add, serialize, reset, remove };
}
