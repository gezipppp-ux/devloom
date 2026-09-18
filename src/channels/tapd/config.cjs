const { loadConfig } = require("../../config/runtime.cjs");

function defaultTapdConfig() {
  return {
    workflow: {
      allow_write: false,
      target_status: "developing",
      fields: {},
    },
  };
}

function sessionFromConfig(config) {
  const session = config.tapd?.session || config;
  if (!session.cookie_header || !session.request_body?.dsc_token)
    throw new Error("TAPD session is incomplete. Refresh the local session.");
  return session;
}

function loadSession(value) {
  return sessionFromConfig(loadConfig(value));
}

function workspaceId(session, value) {
  if (value) return String(value);
  const ids = session.request_body?.select_workspace_ids || [];
  if (ids.length > 1)
    throw new Error(
      "Choose --workspace when the captured session contains multiple workspaces.",
    );
  const id = ids[0] || session.request_body?.group_id;
  if (!id) throw new Error("Provide --workspace <workspace-id>.");
  return String(id);
}

function numericId(value, label) {
  if (!/^\d+$/.test(String(value || "")))
    throw new Error(`${label} must be a TAPD numeric ID.`);
  return String(value);
}

module.exports = { defaultTapdConfig, loadSession, sessionFromConfig, workspaceId, numericId };
