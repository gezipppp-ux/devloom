const path = require("node:path");
const { sourceFor } = require("../domain/run-identity.cjs");
const { normalizeItem } = require("../domain/session-item.cjs");

function text(value) {
  return typeof value === "string" ? value : "";
}

// Owns the public session DTOs; raw records and filesystem locations stay in storage.
class SessionPresenter {
  constructor({ store, settings, apiPrefix = "/api" }) {
    this.store = store;
    this.settings = settings;
    this.apiPrefix = apiPrefix;
  }

  summary(key, state) {
    return {
      key,
      title: this.store.readSessionTitle(key, state.workitem.title),
      source: state.source || sourceFor("tapd", state.workitem),
      storyId: state.workitem.id,
      workspaceId: state.workitem.workspace_id,
      sessionId: state.session_id,
      metadata: this.store.readTaskMetadata(key, state.workitem),
      ...(this.settings ? this.settings.describe(key, state) : {}),
      codex: state.codex
        ? {
            model: text(state.codex.model),
            reasoningEffort: text(state.codex.reasoning_effort),
          }
        : null,
      execution: state.execution,
      transition: state.transition,
      updatedAt: state.updated_at,
      imageCount: state.image_count,
      worktree: state.worktree,
      worktreeDeletion: this.store.readWorktreeDeletion(key),
    };
  }

  requirement(key, state = this.store.read(key)) {
    let task = {};
    let warning = "";
    try {
      task = this.store.readTask(key);
    } catch (error) {
      warning =
        error.code === "ENOENT"
          ? "任务资料快照缺失，已显示运行记录中保存的需求内容。"
          : "任务资料快照无法读取，已显示运行记录中保存的需求内容。";
    }
    const item = { ...state.workitem, ...task.workitem };
    return {
      id: text(String(item.id || "")),
      title: text(item.title),
      sourceUrl: text(item.detail_url),
      capturedAt: text(task.generated_at || state.created_at),
      description: text(item.description),
      markdown: text(item.markdown_description),
      supplementaryInstructions: text(item.supplementary_instructions),
      prompt: text(task.codex_prompt),
      warning,
      images: (task.images || []).map((image, index) => ({
        index,
        name: path.basename(image.path || `image-${index + 1}`),
        source: text(image.source),
        url: `${this.apiPrefix || "/api"}/runs/${key}/images/${index}`,
      })),
    };
  }

  images(key) {
    try {
      const task = this.store.readTask(key);
      return (task.images || []).map((image, index) => ({
        index,
        name: path.basename(image.path),
        url: `${this.apiPrefix || "/api"}/runs/${key}/images/${index}`,
      }));
    } catch {
      return [];
    }
  }

  messageImage(key, image) {
    return {
      id: image.id,
      name: `image-${image.id}.${image.extension}`,
      size: image.size,
      contentType:
        image.extension === "jpg" ? "image/jpeg" : `image/${image.extension}`,
      url: `${this.apiPrefix}/runs/${key}/message-images/${image.id}`,
    };
  }

  item(key, item, turnId) {
    const normalized = normalizeItem(item, turnId);
    if (normalized.type === "userMessage") {
      const images = this.store.messageImages(key).match(item.content);
      if (images.length)
        normalized.images = images.map((image) =>
          this.messageImage(key, image),
        );
    }
    return normalized;
  }
}

module.exports = { SessionPresenter };
