function childEnvironment(source = process.env) {
  // Windows environment names are case insensitive and preserve the spelling
  // supplied by the service manager. Never forward an alternate-cased secret.
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name]) => !/^TAPD_/i.test(name) && !/^CODEX_THREAD_ID$/i.test(name) &&
        !/^(?:DATABASE_URL|APP_SECRET|SESSION_SECRET|RUNNER_(?:SECRET|MASTER_KEY|ENCRYPTION_KEY|SESSION_SECRET)|BOOTSTRAP_(?:PASSWORD|TOKEN))$/i.test(name),
    ),
  );
}

module.exports = { childEnvironment };
