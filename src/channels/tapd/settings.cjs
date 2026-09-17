const { readOptional, writeConfig } = require("../../storage/json-files.cjs");
const { numericId } = require("./config.cjs");
const {
  buildSession,
  parseCookieHeader,
  todoRequest,
} = require("./auth-utils.cjs");
const { request } = require("./http.cjs");

function readTapdSettings(file) {
  const config = readOptional(file);
  return {
    workspaceId: config.tapd?.session?.request_body?.group_id || "",
    hasCookie: Boolean(config.tapd?.session?.cookie_header),
    targetStatus: config.workflow?.target_status || "developing",
    imageHosts: config.tapd?.image_hosts || [],
  };
}

function draftConfig(file, input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          "workspaceId",
          "cookie",
          "clearCookie",
          "targetStatus",
          "imageHosts",
        ].includes(key),
    )
  )
    throw new Error("无效的 TAPD 配置字段。");
  const config = readOptional(file);
  const workspaceId = numericId(input.workspaceId, "TAPD 项目 ID");
  if (
    input.cookie !== undefined &&
    (typeof input.cookie !== "string" ||
      input.cookie.length > 32000 ||
      /[\r\n\0]/.test(input.cookie))
  )
    throw new Error("Cookie 格式无效，请粘贴单行 Cookie。");
  if (input.clearCookie !== undefined && typeof input.clearCookie !== "boolean")
    throw new Error("无效的清除选项。");
  const cookie = input.clearCookie
    ? ""
    : input.cookie?.trim() || config.tapd?.session?.cookie_header || "";
  const dscToken = cookie ? parseCookieHeader(cookie)["dsc-token"] : "";
  if (cookie && !dscToken) throw new Error("Cookie 必须包含 dsc-token。");
  const targetStatus =
    input.targetStatus ?? config.workflow?.target_status ?? "developing";
  if (typeof targetStatus !== "string" || !/^[\w-]{1,100}$/.test(targetStatus))
    throw new Error("请填写有效的目标状态码。");
  const imageHosts = input.imageHosts ?? config.tapd?.image_hosts ?? [];
  if (
    !Array.isArray(imageHosts) ||
    imageHosts.length > 30 ||
    imageHosts.some(
      (host) =>
        typeof host !== "string" ||
        host.length > 253 ||
        !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(host),
    )
  )
    throw new Error("图片域名必须是完整主机名，不包含协议、路径或通配符。");
  return {
    ...config,
    tapd: {
      ...config.tapd,
      image_hosts: [...new Set(imageHosts.map((host) => host.toLowerCase()))],
      session: buildSession({
        cookieHeader: cookie,
        requestBody: todoRequest({ workspaceId, dscToken }),
        referer: "https://www.tapd.cn/tapd_fe/my/work?left_tree=1",
      }),
    },
    workflow: { ...config.workflow, target_status: targetStatus },
  };
}

function saveTapdSettings(file, input) {
  writeConfig(file, draftConfig(file, input));
  return readTapdSettings(file);
}

async function checkTapdSettings(file, input, send = request) {
  const session = draftConfig(file, input).tapd.session;
  if (!session.cookie_header) throw new Error("请先填写 TAPD Cookie。");
  try {
    const result = await send(session, session.endpoint, {
      method: "POST",
      body: JSON.stringify({ ...session.request_body, page: 1, perpage: "1" }),
    });
    if (!Array.isArray(result?.workitem_list))
      throw new Error("Invalid response");
  } catch {
    // Never reflect upstream content or credentials through the settings API.
    throw new Error(
      "检测失败：Cookie 已失效、项目不可访问或网络异常，请检查后重试。",
    );
  }
  return {
    ok: true,
    message: "Cookie 可用，TAPD 待办接口访问成功。检测不会保存配置。",
  };
}

module.exports = { readTapdSettings, saveTapdSettings, checkTapdSettings };
