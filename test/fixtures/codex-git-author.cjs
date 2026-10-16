const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const readline = require("node:readline");

// Model a Codex shell policy that does not inherit Git identity variables.
const policy = { inherit: "core", include_only: ["PATH", "SystemRoot", "CUSTOM_SETTING"], set: { CUSTOM_SETTING: "preserved" } };
const sessionFile = process.argv[2];
let sessionPolicy = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, "utf8")) : undefined;
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  try {
    if (message.method === "config/read") result = { config: { shell_environment_policy: policy } };
    if (["thread/start", "thread/resume"].includes(message.method)) {
      sessionPolicy = message.params.config?.shell_environment_policy || sessionPolicy || policy;
      fs.writeFileSync(sessionFile, JSON.stringify(sessionPolicy));
      result = { thread: { id: "author-session" } };
    }
    if (message.method === "fixture/commit") {
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        !/^(?:GIT_|GCM_|SSH_)/i.test(name),
      ));
      Object.assign(env, sessionPolicy.set);
      for (const name of Object.keys(env)) {
        if (!sessionPolicy.include_only.some(pattern => pattern.toLowerCase() === name.toLowerCase())) delete env[name];
      }
      const git = args => execFileSync("git", ["-C", message.params.cwd, ...args], {
        env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      git(["-c", "core.hooksPath=", "commit", "--allow-empty", "-m", "fixture author"]);
      result = { identity: git(["log", "-1", "--format=%an <%ae>|%cn <%ce>"]), setting: env.CUSTOM_SETTING };
    }
    process.stdout.write(JSON.stringify({ id: message.id, result }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ id: message.id, error: { message: "fixture commit failed" } }) + "\n");
  }
});
