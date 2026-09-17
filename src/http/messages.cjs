const { MAX_IMAGE_BYTES } = require("../domain/image-format.cjs");

function json(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function body(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("请求必须使用 application/json");
  let data = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    data += chunk.toString("utf8");
    if (Buffer.byteLength(data) > 256000) throw new Error("请求内容过大");
  }
  return JSON.parse(data || "{}");
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
