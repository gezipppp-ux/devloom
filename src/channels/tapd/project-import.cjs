const { detail } = require("./detail.cjs");
const { sessionFromConfig, workspaceId, numericId } = require("./config.cjs");
const { accountError } = require("../../domain/account.cjs");
const { randomUUID } = require("node:crypto");
const { extractImageReferences, downloadImage } = require("./images.cjs");
const { imageExtension, MAX_IMAGES } = require("../../domain/image-format.cjs");

async function importProjectTapd(config, input) {
  if (!input || Object.keys(input).some(key => key !== "items") || !Array.isArray(input.items) || !input.items.length || input.items.length > 20)
    throw accountError("请选择 1–20 条 TAPD 事项。", 400);
  const session = sessionFromConfig(config);
  const scope = workspaceId(session);
  const selected = input.items.map(entry => {
    if (!entry || Object.keys(entry).some(key => !["id", "type"].includes(key)) || !["story", "bug", "board_card"].includes(entry.type))
      throw accountError("TAPD 事项类型无效。", 400);
    return { id: numericId(entry.id, "TAPD 事项 ID"), type: entry.type, workspace_id: scope };
  });
  if (new Set(selected.map(item => `${item.type}:${item.id}`)).size !== selected.length)
    throw accountError("不能重复选择 TAPD 事项。", 400);
  const result = [];
  let totalBytes = 0;
  for (const item of selected) {
    const workitem = await detail(session, item);
    if (String(workitem.id) !== item.id || String(workitem.workspace_id) !== scope)
      throw accountError("TAPD 返回的事项身份不匹配。", 400);
    const references = extractImageReferences(workitem);
    const sources = [...new Set(references.map(reference => reference.url))];
    if (sources.length > MAX_IMAGES) throw accountError("单条 TAPD 事项图片不能超过 20 张。", 400);
    const attachments = [], projectImages = [];
    for (const [index, source] of sources.entries()) {
      const data = await downloadImage(source, session, config.tapd?.image_hosts || []);
      const extension = imageExtension(data);
      totalBytes += data.length;
      if (totalBytes > 20 * 1024 * 1024) throw accountError("本次 TAPD 导入图片合计不能超过 20 MiB，请分批导入。", 400);
      const id = randomUUID();
      attachments.push({ id, name: `tapd-${item.id}-${index + 1}.${extension}`, data,
        mimeType: extension === "jpg" ? "image/jpeg" : `image/${extension}` });
      for (const reference of references.filter(reference => reference.url === source))
        projectImages.push({ source: reference.source, fileId: id });
    }
    result.push({ title: workitem.title, description: workitem.markdown_description || workitem.description || "", type: item.type === "bug" ? "bug" : "requirement",
      attachments, source: { channel: "tapd", scope, type: item.type, externalId: item.id, url: workitem.detail_url || "", snapshot: { ...workitem, projectImages } } });
  }
  return result;
}

module.exports = { importProjectTapd };
