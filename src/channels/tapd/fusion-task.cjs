const path = require("node:path");
const { MAX_IMAGES } = require("../../domain/image-format.cjs");
const { getPromptTemplates, renderPromptTemplate } = require("../../domain/prompt-templates.cjs");

async function buildFusionTask({ session, item, directory, config, services }) {
  const requirements = [];
  const images = [];
  for (const [index, selected] of item.requirements.entries()) {
    const workitem = await services.detail(session, selected);
    if (String(workitem.id) !== selected.id || String(workitem.workspace_id) !== selected.workspace_id)
      throw new Error("TAPD 返回的需求身份与所选需求不一致。");
    const task = await services.prepareMaterials(workitem, session,
      path.join(directory, "sources", `${index + 1}-${selected.id}`), config);
    if (!task.execution_ready)
      throw new Error(`需求 ${selected.id}：${task.blocked_reason}`);
    requirements.push(task);
    images.push(...task.images.map((image, imageIndex) => ({ ...image, index: images.length + imageIndex + 1,
      source_id: workitem.id, source_position: index + 1 })));
    if (images.length > MAX_IMAGES)
      throw new Error("本次融合资料合计超过 20 张图片，请减少所选需求。");
  }
  const imageList = images.map(image =>
    `图片 ${image.index}（第 ${image.source_position} 条需求 #${image.source_id}）：${image.path}`).join("\n");
  const materials = requirements.map((task, index) => [
    `--- 第 ${index + 1} 条需求 #${task.workitem.id} 开始 ---`,
    `标题：${task.workitem.title}`,
    `来源：${task.workitem.detail_url || "（未提供链接）"}`,
    task.content,
    `关联图片：${images.filter(image => image.source_position === index + 1).map(image => `图片 ${image.index}`).join("、") || "无"}`,
    `--- 第 ${index + 1} 条需求结束 ---`,
  ].join("\n")).join("\n\n");
  const prompt = renderPromptTemplate("tapd_fusion", getPromptTemplates(config).tapd_fusion, {
    title: item.title,
    workspace_id: item.workspace_id,
    requirement_count: requirements.length,
    requirements: materials,
    supplement: item.supplementary_instructions
      ? `--- 融合补充说明开始 ---\n${item.supplementary_instructions}\n--- 融合补充说明结束 ---\n\n` : "",
    images: images.length
      ? `本批附带 ${images.length} 张图片，按以下全局编号传入，括号标明所属需求：\n${imageList}\n请结合图片理解对应需求。`
      : "本批需求未包含内嵌图片。",
    image_count: images.length,
    image_list: imageList,
  });
  if (prompt.length > 240000) throw new Error("融合资料超过 240000 字，请减少所选需求。");
  const task = { generated_at: new Date().toISOString(), execution_ready: true,
    workitem: item, requirements, images, codex_prompt: prompt };
  return { workitem: item, task };
}

module.exports = { buildFusionTask };
