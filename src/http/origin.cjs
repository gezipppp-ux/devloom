const { isIP } = require("node:net");

function validateListenHost(host) {
  if (typeof host !== "string" || !isIP(host) || host.includes("%"))
    throw new Error(
      "监听地址必须是 IPv4 或 IPv6 地址，不支持主机名或带作用域的地址。",
    );
  return host;
}

function httpOrigin(address, port) {
  const host = isIP(address) === 6 ? `[${address}]` : address;
  return new URL(`http://${host}:${port}`).origin;
}

function normalizedAddress(address) {
  const family = typeof address === "string" ? isIP(address) : 0;
  if (family === 4) return address;
  if (family !== 6 || address.includes("%")) return null;
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  return mapped
    .slice(1)
    .flatMap((part) => {
      const word = parseInt(part, 16);
      return [word >>> 8, word & 255];
    })
    .join(".");
}

function publicOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN 必须是 HTTPS 公开源地址，不包含路径或凭据。",
    );
  return url.origin;
}

function isLoopback(address) {
  const value = normalizedAddress(address);
  return value === "::1" || value?.startsWith("127.") === true;
}

function requestOrigin(request, configuredOrigin = null) {
  const host = request.headers.host;
  if (
    typeof host !== "string" ||
    request.headers["sec-fetch-site"] === "cross-site"
  )
    return null;
  if (configuredOrigin) {
    const expected = new URL(configuredOrigin);
    // Only a local reverse proxy may assert TLS; forwarded Host never grants access.
    if (
      !isLoopback(request.socket.remoteAddress) ||
      host !== expected.host ||
      request.headers["x-forwarded-proto"] !== "https"
    )
      return null;
    return request.headers.origin === undefined ||
      request.headers.origin === expected.origin
      ? expected.origin
      : null;
  }
  // Parse IP literals strictly before URL normalization, which otherwise also
  // accepts hostnames, credentials and alternate numeric IPv4 spellings.
  const match = /^(?:\[([\da-f:.]+)\]|([^:\[\]\s]+))(?::(\d+))?$/i.exec(host);
  if (!match) return null;
  const address = match[1] || match[2];
  if (match[1] && isIP(address) !== 6) return null;
  const normalized = normalizedAddress(address);
  if (
    !normalized ||
    normalized !== normalizedAddress(request.socket.localAddress)
  )
    return null;
  const port = match[3] === undefined ? 80 : Number(match[3]);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port !== request.socket.localPort
  )
    return null;
  const origin = httpOrigin(address, port);
  return request.headers.origin === undefined ||
    request.headers.origin === origin
    ? origin
    : null;
}

module.exports = {
  validateListenHost,
  httpOrigin,
  requestOrigin,
  publicOrigin,
  isLoopback,
};
