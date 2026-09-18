const fs = require("node:fs");
const path = require("node:path");
const { collectImages } = require("./images.cjs");
const {
  getPromptTemplates,
  renderPromptTemplate,
} = require("../../domain/prompt-templates.cjs");

async function buildTask(workitem, session, directory, config = {}) {
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
  const imageList = images
    .map((image) => `${image.index}. ${path.basename(image.path)}`)
    .join("\n");
  const prompt = renderPromptTemplate("tapd", getPromptTemplates(config).tapd, {
    id: workitem.id,
    title: workitem.title,
    workspace_id: workitem.workspace_id,
    url: workitem.detail_url,
    content:
      description ||
      (supplement && !images.length
        ? "（TAPD 原始描述为空，请阅读补充说明。）"
        : "（仅有图片，请阅读附件。）"),
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
    generated_at: new Date().toISOString(),
    execution_ready: ready,
    blocked_reason: ready ? null : "TAPD 需求缺少描述和图片。",
    workitem,
    images,
    codex_prompt: prompt,
  };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "tapd-task.json"),
    JSON.stringify(task, null, 2),
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(directory, "task.md"), prompt, { mode: 0o600 });
  return task;
}

module.exports = { buildTask };
