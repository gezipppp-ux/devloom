function createEventStream() {
  const clients = new Map();
  const subscriptions = new Map();

  function write(response, frame) {
    if (response.writableLength > 1024 * 1024) response.destroy();
    else response.write(frame);
  }

  function authorize(response, client) {
    try {
      if (!client.authorize || client.authorize()) return true;
    } catch {
      /* Authorization failure closes the stream without harming execution. */
    }
    write(response, "event: auth-expired\ndata: {}\n\n");
    response.end();
    return false;
  }

  function subscribe(sessions) {
    if (subscriptions.has(sessions)) return;
    const listener = (event) => {
      for (const [response, client] of clients) {
        if (client.sessions !== sessions) continue;
        if (!authorize(response, client)) continue;
        write(response, `data: ${JSON.stringify(event)}\n\n`);
      }
    };
    subscriptions.set(sessions, listener);
    sessions.on("event", listener);
  }

  function connect(request, response, sessions, authorization) {
    subscribe(sessions);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    const client = {
      sessions,
      authorize: authorization?.authorize,
      userId: authorization?.userId,
      sessionId: authorization?.sessionId,
    };
    const timer = setInterval(() => {
      if (authorize(response, client)) write(response, ": heartbeat\n\n");
    }, 1000);
    clients.set(response, { ...client, timer });
    const cleanup = () => {
      clearInterval(timer);
      clients.delete(response);
      request.off("close", cleanup);
      response.off("close", cleanup);
      if (
        ![...clients.values()].some((client) => client.sessions === sessions)
      ) {
        const listener = subscriptions.get(sessions);
        if (listener) sessions.off("event", listener);
        subscriptions.delete(sessions);
      }
    };
    request.once("close", cleanup);
    response.once("close", cleanup);
  }

  function revoke({ userId, sessionId }) {
    for (const [response, client] of clients) {
      if (
        (userId && userId === client.userId) ||
        (sessionId && sessionId === client.sessionId)
      ) {
        write(response, "event: auth-expired\ndata: {}\n\n");
        response.end();
      }
    }
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

  return { connect, close, revoke };
}

module.exports = { createEventStream };
