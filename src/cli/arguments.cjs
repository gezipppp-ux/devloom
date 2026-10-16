function argument(name, fallback = null, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value.`);
  return value;
}

function portArgument(argv, { defaultPort, allowAuto = false, env = process.env }) {
  const configured = argument("--port", null, argv) ?? (env.PORT?.trim() || String(defaultPort));
  const port = Number(configured);
  const minimum = allowAuto ? 0 : 1;
  if (!/^\d+$/.test(configured.trim()) || !Number.isInteger(port) || port < minimum || port > 65535)
    throw new Error(allowAuto ? "端口需为 0–65535（0 表示自动分配）。" : "端口需为 1–65535。");
  return port;
}

module.exports = { argument, portArgument };
