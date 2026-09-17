let token;
let workspaceId = "";
export function selectWorkspace(id) {
  workspaceId = id;
}
export function apiPath(url) {
  return `/api${workspaceId ? `/workspaces/${workspaceId}` : ""}${url}`;
}
export async function uploadManualImage(file) {
  const response = await fetch(apiPath("/channels/manual/images"), {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-tapd-token": token,
    },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "图片上传失败");
  return result;
}
export async function appApi(url, data) {
  return request(`/api${url}`, data);
}
export async function api(url, data) {
  return request(apiPath(url), data);
}
async function request(url, data) {
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tapd-token": token,
          },
          body: JSON.stringify(data),
        },
  );
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(
      new Error(
        response.ok
          ? "服务返回了无效的 JSON 响应"
          : `请求失败（HTTP ${response.status} ${response.statusText}）`,
      ),
      { status: response.status },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(result?.error || `请求失败（HTTP ${response.status}）`),
      { status: response.status },
    );
  return result;
}
export async function bootstrap() {
  const result = await api("/bootstrap");
  token = result.token;
  return result;
}
export function statusLabel(status) {
  return (
    {
      preparing: "准备中",
      initializing: "初始化中",
      starting: "启动中",
      running: "执行中",
      inProgress: "执行中",
      completed: "本轮结束",
      failed: "执行失败",
      error: "异常",
      interrupted: "已停止",
      disconnected: "连接中断",
      idle: "等待指令",
    }[status] ||
    status ||
    "等待指令"
  );
}
