const path = require('node:path');
const { appendArtifact } = require('../storage/artifact-store.cjs');
const { spawn } = require('node:child_process');

const { validateInitCommands } = require('../domain/init-commands.cjs');
const { stopProcessTree } = require('../shared/process-tree.cjs');
const { childEnvironment } = require('../shared/child-environment.cjs');

async function initializeWorktree({
  commands,
  cwd,
  directory,
  signal,
  onUpdate = () => {},
  timeoutMs = 15 * 60 * 1000,
}) {
  commands = validateInitCommands(commands);
  if (!commands.length) return;
  const local = new AbortController();
  const abort = () => local.abort();
  const combined = signal
    ? AbortSignal.any([signal, local.signal])
    : local.signal;
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const state = {
    status: 'running',
    commands: commands.map((command) => ({
      command,
      status: 'pending',
      output: '',
    })),
  };
  let logBytes = 0;
  const logFile = path.join(directory, 'initialization.log');
  const log = async (text) => {
    const limit = 5 * 1024 * 1024;
    if (logBytes >= limit) return;
    const chunk = Buffer.from(text).subarray(0, limit - logBytes);
    (await appendArtifact(logFile, chunk));
    logBytes += chunk.length;
    if (logBytes >= limit)
      (await appendArtifact(logFile, '\n[日志已达到 5 MiB 上限]\n'));
  };
  try {
    for (const [index, entry] of state.commands.entries()) {
      try {
        if (combined.aborted) throw new Error('初始化已停止。');
        entry.status = 'running';
        entry.started_at = new Date().toISOString();
        (await log(`\n[${index + 1}/${commands.length}] ${entry.command}\n`));
        await onUpdate(structuredClone(state), index);
        await new Promise((resolve, reject) => {
          const env = childEnvironment();
          env.INIT_CWD = cwd;
          // Commands come only from local execution settings, never requirement text.
          const child = spawn(entry.command, {
            cwd,
            env,
            shell:
              process.platform === 'win32'
                ? process.env.ComSpec || 'cmd.exe'
                : '/bin/sh',
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let failure;
          let writes = Promise.resolve();
          let lastPublished = 0;
          const stop = (message) => {
            failure ||= new Error(message);
            void stopProcessTree(child);
          };
          const interrupted = () => stop('初始化已停止。');
          const timeout = setTimeout(
            () =>
              stop(`初始化命令超时（${Math.round(timeoutMs / 1000)} 秒）。`),
            timeoutMs,
          );
          combined.addEventListener('abort', interrupted, { once: true });
          if (combined.aborted) interrupted();
          const output = (chunk) => {
            writes = writes.then(async () => {
              (await log(chunk));
              entry.output = (entry.output + chunk).slice(-20000);
              if (Date.now() - lastPublished >= 200) {
                lastPublished = Date.now();
                await onUpdate(structuredClone(state), index);
              }
            }).catch(error => stop(error.message));
          };
          child.stdout.setEncoding('utf8').on('data', output);
          child.stderr.setEncoding('utf8').on('data', output);
          child.on('error', (error) => {
            failure = error;
          });
          child.once('close', async (code, exitSignal) => {
            clearTimeout(timeout);
            combined.removeEventListener('abort', interrupted);
            await writes;
            entry.exit_code = code;
            entry.signal = exitSignal;
            if (failure) reject(failure);
            else if (code !== 0)
              reject(
                new Error(
                  `退出码 ${code}${exitSignal ? ` (${exitSignal})` : ''}`,
                ),
              );
            else resolve();
          });
        });
        entry.status = 'completed';
        entry.finished_at = new Date().toISOString();
        await onUpdate(structuredClone(state), index);
      } catch (error) {
        entry.status = combined.aborted ? 'interrupted' : 'failed';
        entry.finished_at = new Date().toISOString();
        entry.error = error.message;
        state.status = entry.status;
        for (const next of state.commands.slice(index + 1))
          next.status = 'skipped';
        await onUpdate(structuredClone(state), index);
        throw new Error(
          `Worktree 初始化第 ${index + 1} 条命令失败：${entry.command}；${error.message}`,
        );
      }
    }
    state.status = 'completed';
    await onUpdate(structuredClone(state), state.commands.length - 1);
    return state;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

module.exports = { initializeWorktree };
