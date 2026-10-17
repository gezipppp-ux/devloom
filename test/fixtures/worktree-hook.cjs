const fs = require("node:fs");

// A real Git checkout hook, held open by the parent test without a busy loop.
const [ready, release, exitCode] = process.argv.slice(2);
fs.writeFileSync(ready, String(process.pid));
const deadline = setTimeout(() => process.exit(99), 30000);
const timer = setInterval(() => {
  if (!fs.existsSync(release)) return;
  clearTimeout(deadline);
  clearInterval(timer);
  process.exitCode = Number(exitCode);
}, 20);
