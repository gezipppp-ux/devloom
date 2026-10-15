// Keep development and production entry-page routing aligned with Vue Router.
const pagePaths = new Set([
  "/",
  "/login",
  "/setup",
  "/password",
  "/projects",
  "/work",
  "/issues",
  "/development",
  "/deliveries",
  "/departments",
  "/personal",
  "/system",
  "/environment",
  "/accounts",
]);

function pageStatus(request, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  // Vue Router accepts a trailing slash and matches static segments case-insensitively.
  const normalized = url.pathname.replace(/\/$/, "").toLowerCase() || "/";
  if (pagePaths.has(normalized) || /^\/projects\/[^/]+$/.test(normalized)) return 200;
  if (normalized === "/404") return 404;
  // Only document navigation gets the error page. API, Vite and asset requests
  // keep their own status/content type instead of receiving the SPA shell.
  if (!/\btext\/html\b/i.test(request.headers.accept || "")) return null;
  if (/^\/(?:api|mcp|assets|src|shared|node_modules)(?:\/|$)|^\/@/i.test(normalized)) return null;
  if (/\.[^/]*$/.test(normalized)) return null;
  return 404;
}

module.exports = { pageStatus };
