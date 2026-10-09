const path = require("node:path");
const { writeConfig } = require("../../storage/json-files.cjs");
const { writeArtifact } = require("../../storage/artifact-store.cjs");
const { collectImages } = require("./images.cjs");
const {
  getPromptTemplates,
  renderPromptTemplate,
} = require("../../domain/prompt-templates.cjs");

async function prepareMaterials(workitem, session, directory, config = {}) {
  const images = await collectImages(workitem, session, directory, config.tapd);
  const description = (
    workitem.markdown_description ||
    workitem.description ||
    ""
  ).trim();
  const visible = description
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  const supplement = workitem.supplementary_instructions?.trim() || "";
  const ready =
    visible.length > 0 || images.length > 0 || supplement.length > 0;
  return {
    generated_at: new Date().toISOString(),
    execution_ready: ready,
    blocked_reason: ready ? null : "TAPD 需求缺少描述和图片。",
    workitem,
    images,
    content: description || (supplement && !images.length
      ? "（TAPD 原始描述为空，请阅读补充说明。）" : "（仅有图片，请阅读附件。）"),
  };
}

async function buildTask(workitem, session, directory, config = {}) {
  const materials = await prepareMaterials(workitem, session, directory, config);
  const { images, content } = materials;
  const supplement = workitem.supplementary_instructions?.trim() || "";
  const imageList = images
    .map((image) => `${image.index}. ${path.basename(image.path)}`)
    .join("\n");
  const prompt = renderPromptTemplate("tapd", getPromptTemplates(config).tapd, {
    id: workitem.id,
    title: workitem.title,
    workspace_id: workitem.workspace_id,
    url: workitem.detail_url,
    content,
    supplement: supplement
      ? `--- 补充说明与指导意见开始 ---\n${supplement}\n--- 补充说明与指导意见结束 ---\n\n`
      : "",
    images: images.length
      ? `已附带 ${images.length} 张图片（通过 --image 传入），顺序如下：\n${imageList}\n请结合图片中的界面、标注和文字理解需求。`
      : "该需求未包含内嵌图片。",
    image_count: images.length,
    image_list: imageList,
  });
  const task = {
    ...materials,
    codex_prompt: prompt,
  };
  writeConfig(path.join(directory, "tapd-task.json"), task);
  writeArtifact(path.join(directory, "task.md"), prompt, { mimeType: "text/markdown" });
  return task;
}

module.exports = { buildTask, prepareMaterials };
