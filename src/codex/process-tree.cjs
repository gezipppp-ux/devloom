const path = require('node:path');
const { spawn } = require('node:child_process');

// POSIX callers create a detached process group; Windows taskkill follows the
// child tree, including the native executable behind an npm launcher.
function stopProcessTree(child) {
  if (!child?.pid) return Promise.resolve();
  const fallback = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process may already have exited while its pipes were closing.
    }
  };
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      fallback();
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    const command = systemRoot
      ? path.join(systemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe';
    let killer;
    try {
      killer = spawn(command, ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
    } catch {
      fallback();
      resolve();
      return;
    }
    killer.once('error', () => {
      fallback();
      resolve();
    });
    killer.once('close', (code) => {
      if (code !== 0) fallback();
      resolve();
    });
  });
}

module.exports = { stopProcessTree };
