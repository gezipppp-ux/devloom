const { json } = require("./messages.cjs");

async function serveSetup(request, response, url, { setup, actor, input, authorize }) {
  if (request.method === "GET" && url.pathname === "/api/system/setup") {
    json(response, 200, await setup.read(actor));
    return true;
  }
  const match = /^\/api\/system\/setup\/(environment|directory|departments|accounts|project|complete|draft)$/.exec(url.pathname);
  if (!match || request.method !== "POST") return false;
  json(response, 200, match[1] === "draft" ? await setup.saveDraft(actor, input, authorize) : await setup.submit(actor, match[1], input, authorize));
  return true;
}
module.exports = { serveSetup };
