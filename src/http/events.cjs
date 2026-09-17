function createEventStream() {
  const clients = new Map();
  const subscriptions = new Map();

  function subscribe(sessions) {
    if (subscriptions.has(sessions)) return;
    const listener = (event) => {
      for (const [response, client] of clients) {
        if (client.sessions !== sessions) continue;
        if (response.writableLength > 1024 * 1024) response.destroy();
        else response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };
    subscriptions.set(sessions, listener);
    sessions.on("event", listener);
  }

  function connect(request, response, sessions) {
    subscribe(sessions);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    const timer = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    clients.set(response, { sessions, timer });
    const cleanup = () => {
      clearInterval(timer);
      clients.delete(response);
    };
    request.once("close", cleanup);
    response.once("close", cleanup);
  }

  function close() {
    for (const [response, { timer }] of clients) {
      clearInterval(timer);
      response.end();
    }
    clients.clear();
    for (const [sessions, listener] of subscriptions)
      sessions.off("event", listener);
    subscriptions.clear();
  }

  return { connect, close };
}

module.exports = { createEventStream };
