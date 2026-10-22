const PREVIEW_ID = /^[a-f0-9]{32}$/;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 16 * 1024;

function previewError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function validatePreviewState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["widget", "controls"].includes(key)))
    throw previewError("预览状态格式无效。");
  const encoded = JSON.stringify({ widget: value.widget ?? null, controls: value.controls ?? {} });
  if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) throw previewError("预览状态不能超过 16 KiB。");
  if (value.widget != null && (typeof value.widget !== "object" || Array.isArray(value.widget) ||
      Object.keys(value.widget).some(key => !["modelContent", "privateContent"].includes(key))))
    throw previewError("预览状态格式无效。");
  if (value.controls != null && (typeof value.controls !== "object" || Array.isArray(value.controls) ||
      Object.values(value.controls).some(entry => !["string", "number", "boolean"].includes(typeof entry))))
    throw previewError("预览调整值无效。");
  return JSON.parse(encoded);
}

function previewInstructions(cwd) {
  return `DevLoom supports interactive HTML previews in this chat. When a visualization helps, write a self-contained UTF-8 HTML fragment under ${cwd}/.devloom/previews/ (create the directory if needed), below 1 MiB. Do not use the desktop global visualization directory. Emit visualize{"path":"<absolute HTML path>","title":"<short title>"} in the reply at the desired position. Reuse a file path for subsequent versions of the same preview. Only completed replies are captured. Ordinary Markdown remains sanitized. The sandbox supports inline JS/CSS, Tweak sliders/color/toggle/select, window.openai.widgetState, setWidgetState({modelContent,privateContent}), openai:set_globals, sendFollowUpMessage({prompt,title}), and .viz-carousel > [data-variant]. Tweak controls appear in the host adjustment panel. Follow-up requests only stage a draft; the user sends it. Save state as a complete snapshot below 16 KiB; never put secrets in modelContent or controls. Network requests, forms, popups and parent DOM access are unavailable; use inline data and self-contained SVG. CDN scripts/fonts may use cdnjs.cloudflare.com, esm.sh, cdn.jsdelivr.net, unpkg.com, fonts.googleapis.com, fonts.gstatic.com, fonts.bunny.net. The host owns immutable versions and persistence. If using the visualize skill, follow these host output-path and runtime constraints.`;
}

module.exports = { PREVIEW_ID, MAX_PREVIEW_BYTES, validatePreviewState, previewError, previewInstructions };
