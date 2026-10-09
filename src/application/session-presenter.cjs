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
    const originalTitle = text(state.workitem.title).trim() || text(state.workitem.name).trim();
    const sources = this.store.requirements.read(key).sources || state.workitem.sources ||
      [state.source || sourceFor("tapd", state.workitem)];
    return {
      key,
      sources,
      requirementCount: sources.length,
      title: this.store.readSessionTitle(key, originalTitle || `未命名会话 · ${state.workitem.id || key}`),
      archivedAt: this.store.readArchive(key).archivedAt || null,
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
    return { ...this.taskRequirement(key, task, state.workitem, state.created_at), warning,
      additions: (this.store.requirements.read(key).additions || []).map(entry => ({
        id: entry.id, status: entry.status, createdAt: entry.createdAt,
        requirement: this.taskRequirement(key, entry.task, {}, entry.createdAt, entry.id),
      })),
    };
  }

  taskRequirement(key, task, fallback = {}, createdAt, additionId, allImages = task.images || []) {
    const item = { ...fallback, ...task.workitem };
    const imagePrefix = additionId ? `addition-images/${additionId}` : "images";
    return {
      id: text(String(item.id || "")),
      title: text(item.title),
      sourceUrl: text(item.detail_url),
      capturedAt: text(task.generated_at || createdAt),
      type: text(item.type),
      fusionMode: text(item.fusion_mode),
      description: text(item.description),
      markdown: text(item.markdown_description),
      supplementaryInstructions: text(item.supplementary_instructions),
      prompt: text(task.codex_prompt),
      requirements: task.requirements?.map(child => this.taskRequirement(key, child, {}, createdAt, additionId, allImages)),
      images: (task.images || []).map((image) => ({
        index: allImages.findIndex(entry => entry.path === image.path),
        name: path.basename(image.path || "image"),
        source: text(image.source),
        url: `${this.apiPrefix || "/api"}/runs/${key}/${imagePrefix}/${allImages.findIndex(entry => entry.path === image.path)}`,
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
