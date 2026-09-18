const { MAX_IMAGES } = require("./image-format.cjs");

const MESSAGE_IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validateSessionMessage(text = "", images = []) {
  if (typeof text !== "string" || text.length > 60000)
    throw new Error("消息文本不能超过 60000 个字符。");
  if (
    !Array.isArray(images) ||
    images.length > MAX_IMAGES ||
    images.some((id) => typeof id !== "string" || !MESSAGE_IMAGE_ID.test(id)) ||
    new Set(images).size !== images.length
  )
    throw new Error("每条消息最多附 20 张图片，且图片标识必须有效、不重复。");
  if (!text.trim() && !images.length) throw new Error("请填写消息或添加图片。");
  return { text: text.trim(), images };
}

module.exports = { MESSAGE_IMAGE_ID, validateSessionMessage };
