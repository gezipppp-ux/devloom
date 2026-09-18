import { computed, onUnmounted, reactive, ref } from "vue";
import { apiPath, uploadSessionImage } from "../../shared/api/api.js";

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxImages = 20;
const maxBytes = 10 * 1024 * 1024;

export function useSessionImages({ active, canSend }) {
  const images = ref([]),
    error = ref("");
  const uploading = computed(() =>
    images.value.some((image) => image.status === "uploading"),
  );
  const blocked = computed(() =>
    images.value.some((image) => image.status !== "ready"),
  );
  const controllers = new Map();
  let generation = 0,
    nextId = 0,
    disposed = false,
    uploadQueue = Promise.resolve();

  function reset() {
    generation++;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    for (const image of images.value) URL.revokeObjectURL(image.preview);
    images.value = [];
    error.value = "";
  }

  function queueUpload(image) {
    const version = generation;
    // Capture both the run and workspace before any queued asynchronous work.
    const url = apiPath(`/runs/${active.value}/message-images`);
    image.status = "uploading";
    image.error = "";
    const current = () =>
      !disposed && version === generation && images.value.includes(image);
    // The run owns one upload operation at a time, including repeated pastes.
    uploadQueue = uploadQueue.then(async () => {
      if (!current()) return;
      const controller = new globalThis.AbortController();
      controllers.set(image.localId, controller);
      try {
        const uploaded = await uploadSessionImage(
          url,
          image.file,
          controller.signal,
        );
        if (!current()) return;
        image.id = uploaded.id;
        image.status = "ready";
      } catch (e) {
        if (!current()) return;
        image.status = "failed";
        image.error = e.message;
      } finally {
        controllers.delete(image.localId);
      }
    });
  }

  function add(files) {
    if (!canSend.value || !active.value || disposed) return;
    const selected = [...files];
    error.value = "";
    if (images.value.length + selected.length > maxImages) {
      error.value = "每条消息最多添加 20 张图片，请移除部分图片后重试。";
      return;
    }
    for (const file of selected) {
      if (!imageTypes.has(file.type)) {
        error.value = "仅支持 PNG、JPEG、WebP 图片。";
        return;
      }
      if (!file.size || file.size > maxBytes) {
        error.value = "图片不能为空，且每张不得超过 10 MiB。";
        return;
      }
    }
    for (const file of selected) {
      const image = reactive({
        localId: ++nextId,
        id: "",
        name: file.name || `粘贴图片 ${nextId}`,
        file,
        preview: URL.createObjectURL(file),
        status: "uploading",
        error: "",
      });
      images.value.push(image);
      queueUpload(image);
    }
  }

  function remove(localId) {
    const index = images.value.findIndex((image) => image.localId === localId);
    if (index < 0) return;
    const [image] = images.value.splice(index, 1);
    controllers.get(localId)?.abort();
    controllers.delete(localId);
    URL.revokeObjectURL(image.preview);
    error.value = "";
  }

  function retry(localId) {
    if (!canSend.value || disposed) return;
    const image = images.value.find((entry) => entry.localId === localId);
    if (image?.status === "failed") queueUpload(image);
  }

  onUnmounted(() => {
    disposed = true;
    reset();
  });
  return { images, error, uploading, blocked, add, remove, retry, reset };
}
