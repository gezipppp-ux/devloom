const { MAX_IMAGE_BYTES } = require("../domain/image-format.cjs");

function json(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function body(request) {
  const contentType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json")
    throw new Error("请求必须使用 application/json");
  const chunks = [];
  let size = 0;
  request.setEncoding("utf8");
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 256000) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  const input = JSON.parse(chunks.join("") || "{}");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("请求内容必须是 JSON 对象。");
  return input;
}

async function imageBody(request) {
  if (Number(request.headers["content-length"]) > MAX_IMAGE_BYTES)
    throw new Error("单张图片不能超过 10 MiB。");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 10 MiB。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { json, body, imageBody };
