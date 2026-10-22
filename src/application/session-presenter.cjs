const path = require("node:path");
const { runKey, recordedSources } = require("../domain/run-identity.cjs");
const { agentConfig } = require("../domain/agent-config.cjs");
const { describeAgent } = require("./agent-presenter.cjs");
const { previewSummary } = require("./preview-presenter.cjs");

function text(value) {
  return typeof value === "string" ? value : "";
}

// Owns the public session DTOs; raw records and filesystem locations stay in storage.
class SessionPresenter {
  constructor({ store, settings, apiPrefix = "/api", agent }) {
    /** @type {import('../storage/run-store.cjs').RunStore} */
    this.store = store;
    this.agent = agent;
    /** @type {import('./session-settings.cjs').SessionSettings} */
    this.settings = settings;
    this.apiPrefix = apiPrefix;
  }

  async summary(key, state) {
    runKey(state.source);
    const originalTitle = text(state.workitem.title).trim() || text(state.workitem.name).trim();
    const sources = (await this.store.requirements.read(key)).sources || recordedSources(state);
    return {
      key,
      sources,
      requirementCount: sources.length,
      title: (await this.store.readSessionTitle(key, originalTitle || `未命名会话 · ${state.workitem.id || key}`)),
      archivedAt: (await this.store.readArchive(key)).archivedAt || null,
      source: state.source,
      storyId: state.workitem.id,
      workspaceId: state.workitem.workspace_id,
      sessionId: state.session_id,
      ...(this.settings ? (await this.settings.describe(key, state)) : {}),
      agent: { ...describeAgent(this.agent, agentConfig(state).provider),
        model: agentConfig(state).model, reasoningEffort: agentConfig(state).reasoningEffort,
        permissionMode: agentConfig(state).permissionMode },
      execution: state.execution,
      transition: state.transition,
      updatedAt: state.updated_at,
      imageCount: state.image_count,
      worktree: state.worktree,
      worktreeDeletion: (await this.store.readWorktreeDeletion(key)),
    };
  }

  async requirement(key, state) {
    state ??= await this.store.read(key);
    let task = {};
    let warning = "";
    try {
      task = (await this.store.readTask(key));
    } catch (error) {
      warning =
        error.code === "ENOENT"
          ? "任务资料快照缺失，已显示运行记录中保存的需求内容。"
          : "任务资料快照无法读取，已显示运行记录中保存的需求内容。";
    }
    return { ...this.taskRequirement(key, task, state.workitem, state.created_at), warning,
      additions: ((await this.store.requirements.read(key)).additions || []).map(entry => ({
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
      prompt: text(task.prompt),
      requirements: task.requirements?.map(child => this.taskRequirement(key, child, {}, createdAt, additionId, allImages)),
      images: (task.images || []).map((image) => ({
        index: allImages.findIndex(entry => entry.path === image.path),
        name: path.basename(image.path || "image"),
        source: text(image.source),
        url: `${this.apiPrefix || "/api"}/runs/${key}/${imagePrefix}/${allImages.findIndex(entry => entry.path === image.path)}`,
      })),
    };
  }

  async images(key) {
    try {
      const task = (await this.store.readTask(key));
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

  async item(key, item, turnId, { capturePreviews = true } = {}) {
    const { imageSources, previewReferences, ...fields } = item;
    const normalized = { ...fields, turnId: turnId ?? item.turnId };
    if (normalized.type === "agentMessage" && normalized.status === "completed" && previewReferences?.length) {
      const parts = [];
      let offset = 0;
      const state = await this.store.read(key);
      for (const [ordinal, reference] of previewReferences.slice(0, 8).entries()) {
        if (!Number.isInteger(reference.start) || !Number.isInteger(reference.end) ||
            reference.start < offset || reference.end <= reference.start || reference.end > normalized.text.length) continue;
        parts.push({ type: "text", text: normalized.text.slice(offset, reference.start) });
        try {
          const entry = await this.store.previews(key).capture({ itemId: item.id, turnId: normalized.turnId,
            reference, ordinal, worktree: state.worktree?.path, allowCapture: capturePreviews });
          parts.push({ type: "preview", ...previewSummary(entry) });
        } catch {
          parts.push({ type: "preview-error", title: reference.title || "", error: "预览无法保存，请让 Agent 在当前任务内重新生成 HTML。" });
        }
        offset = reference.end;
      }
      parts.push({ type: "text", text: normalized.text.slice(offset) });
      normalized.contentParts = parts;
      normalized.text = parts.map(part => part.type === "text" ? part.text : `[${part.title || "预览"}]`).join("");
    }
    if (normalized.type === "userMessage") {
      const images = (await (await this.store.messageImages(key)).match(imageSources));
      if (images.length)
        normalized.images = images.map((image) =>
          this.messageImage(key, image),
        );
    }
    return normalized;
  }
}

module.exports = { SessionPresenter };
