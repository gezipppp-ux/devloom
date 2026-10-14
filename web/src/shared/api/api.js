import { translate } from "../i18n/index.js";
let token;
let workspaceId = "";
let generation = 0;
let authenticationFailure = () => {};
export function setAuthenticationToken(value) { token = value; }
export function onAuthenticationFailure(handler) { authenticationFailure = handler; }
export function resetApiSession() { generation++; token = undefined; workspaceId = ""; }
export function currentWorkspaceId() { return workspaceId; }
export function expireAuthentication() { authenticationFailure(); }
function assertCurrent(expected) {
  if (expected !== generation)
    throw Object.assign(new Error("账号已切换，请重新操作。"), { name: "AbortError" });
}
function responseError(response, result, url = "") {
  if (response.status === 401 && !url.endsWith("/auth/login")) authenticationFailure();
  return Object.assign(new Error(result?.error || translate('请求失败（HTTP {status}）', { status: response.status })), {
    status: response.status, code: result?.code,
  });
}
export function selectWorkspace(id) {
  workspaceId = id;
}
export function apiPath(url) {
  return `/api${workspaceId ? `/workspaces/${workspaceId}` : ""}${url}`;
}
export async function uploadSessionImage(url, file, signal) {
  const expected = generation;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-csrf-token": token,
    },
    body: file,
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(translate('图片上传失败（HTTP {status}），请重试', { status: response.status }));
  }
  assertCurrent(expected);
  if (!response.ok) throw responseError(response, result, url);
  if (typeof result?.id !== "string" || !result.id.trim())
    throw new Error("图片上传响应无效，请重试");
  return result;
}
export async function uploadManualImage(file) {
  const expected = generation;
  const response = await fetch(apiPath("/channels/manual/images"), {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-csrf-token": token,
    },
    body: file,
  });
  const result = await response.json();
  assertCurrent(expected);
  if (!response.ok) throw responseError(response, result);
  return result;
}
export async function appApi(url, data) {
  return request(`/api${url}`, data);
}
export async function api(url, data) {
  return request(apiPath(url), data);
}
async function request(url, data) {
  const expected = generation;
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
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
          : translate('请求失败（HTTP {status}）', { status: response.status + ' ' + response.statusText }),
      ),
      { status: response.status },
    );
  }
  assertCurrent(expected);
  if (!response.ok) throw responseError(response, result, url);
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
