const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { resolveCodex } = require('./command.cjs');
const { stopProcessTree } = require('../shared/process-tree.cjs');
const { childEnvironment } = require('./environment.cjs');

function commandFor(config, repository, directory, images) {
  const resolved = resolveCodex(config);
  const args = [
    ...resolved.args,
    '-a',
    'never',
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '--cd',
    repository,
    '--output-last-message',
    path.join(directory, 'final.md'),
  ];
  if (config.model) args.push('--model', config.model);
  if (config.reasoning_effort)
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(config.reasoning_effort)}`,
    );
  for (const image of images) args.push('--image', image.path);
  args.push('-');
  return { command: resolved.command, args };
}

async function startSession({
  config = {},
  repository,
  directory,
  task,
  onSession,
  onStarted,
  onEvent,
  onStderr,
  onFinal,
}) {
  const { command, args } = commandFor(
    config,
    repository,
    directory,
    task.images,
  );
  const timeoutMs = config.startup_timeout_ms ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new Error('codex.startup_timeout_ms must be a positive integer.');
  const env = childEnvironment();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repository,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let sessionId;
    let started = false;
    let completed = false;
    let failure;
    let startupFailure;
    let callbackError;
    let startCallback = Promise.resolve();
    const timer = setTimeout(() => {
      startupFailure = new Error(
        'Codex did not begin execution before the startup timeout.',
      );
      void stopProcessTree(child);
    }, timeoutMs);
    const stop = () => {
      startupFailure = new Error(
        'Runner interrupted; inspect the recorded session before retrying.',
      );
      void stopProcessTree(child);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('error', (error) => {
      startupFailure = new Error(`Unable to launch Codex: ${error.message}`);
    });
    child.stdin.on('error', (error) => {
      startupFailure ||= new Error(`Codex input failed: ${error.code}`);
      void stopProcessTree(child);
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        if (onEvent) onEvent(`${line}\n`);
        else fs.appendFileSync(path.join(directory, 'events.jsonl'), `${line}\n`, {
          mode: 0o600,
        });
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === 'thread.started' && event.thread_id && !sessionId) {
          sessionId = event.thread_id;
          onSession(sessionId);
        }
        if (event.type === 'turn.started' && sessionId && !started) {
          started = true;
          clearTimeout(timer);
          // Observe rejection immediately, even when the process keeps running.
          startCallback = Promise.resolve()
            .then(() => onStarted(sessionId))
            .catch((error) => {
              callbackError = error;
            });
        }
        if (event.type === 'turn.completed') completed = true;
        if (event.type === 'turn.failed')
          failure = event.error?.message || 'Codex turn failed.';
      } catch (error) {
        startupFailure = error;
        void stopProcessTree(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      try {
        if (onStderr) onStderr(chunk);
        else fs.appendFileSync(path.join(directory, 'stderr.log'), chunk, {
          mode: 0o600,
        });
      } catch (error) {
        startupFailure = error;
        void stopProcessTree(child);
      }
    });
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      await startCallback;
      try { onFinal?.(); } catch (error) { startupFailure ||= error; }
      if (startupFailure) return reject(startupFailure);
      if (callbackError) return reject(callbackError);
      if (!started)
        return reject(
          new Error(
            `Codex exited before execution began (code ${code}). See stderr.log.`,
          ),
        );
      resolve({
        session_id: sessionId,
        exit_code: code,
        signal,
        completed: code === 0 && completed && !failure,
        error:
          failure ||
          (code !== 0
            ? `Codex exited with code ${code}.`
            : !completed
              ? 'Codex exited without turn.completed.'
              : null),
      });
    });
    child.stdin.end(task.codex_prompt);
  });
}

module.exports = { commandFor, startSession };
