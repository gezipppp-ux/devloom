function createEventStream() {
  const clients = new Map();
  const subscriptions = new Map();

  function write(response, frame) {
    if (response.writableLength > 1024 * 1024) response.destroy();
    else response.write(frame);
  }

  async function authorize(response, client) {
    try {
      if (!client.authorize || await client.authorize()) return true;
    } catch {
      /* Authorization failure closes the stream without harming execution. */
    }
    write(response, "event: auth-expired\ndata: {}\n\n");
    response.end();
    return false;
  }

  function enqueue(response, client, frame) {
    const bytes = Buffer.byteLength(frame);
    client.pendingBytes += bytes;
    if (client.pendingBytes > 1024 * 1024) { response.destroy(); return; }
    client.pending = client.pending.then(async () => {
      if (clients.get(response) !== client || response.destroyed || response.writableEnded) return;
      if (await authorize(response, client) && clients.get(response) === client && !response.writableEnded)
        write(response, frame);
    }).catch(() => response.destroy()).finally(() => { client.pendingBytes -= bytes; });
  }

  function subscribe(sessions) {
    if (subscriptions.has(sessions)) return;
    const listener = (event) => {
      for (const [response, client] of clients) {
        if (client.sessions !== sessions) continue;
        enqueue(response, client, `data: ${JSON.stringify(event)}\n\n`);
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
      pending: Promise.resolve(),
      pendingBytes: 0,
    };
    const timer = setInterval(() => {
      enqueue(response, client, ": heartbeat\n\n");
    }, 1000);
    client.timer = timer;
    clients.set(response, client);
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
