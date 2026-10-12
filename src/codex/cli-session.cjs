const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { resolveCodex } = require('./command.cjs');
const { stopProcessTree } = require('../shared/process-tree.cjs');
const { childEnvironment } = require('../shared/child-environment.cjs');
const { normalizeItem } = require('./session-item.cjs');

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
  onItem,
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
    let writes = Promise.resolve();
    const enqueue = (operation) => {
      writes = writes.then(operation).catch((error) => {
        startupFailure ||= error;
        void stopProcessTree(child);
      });
    };
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
    lines.on('line', (line) => enqueue(async () => {
      try {
        if (onEvent) await onEvent(`${line}\n`);
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
          await onSession(sessionId);
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
        if (event.type === 'item.completed' && event.item)
          await onItem?.(normalizeItem(event.item, event.turn_id));
        if (event.type === 'turn.failed')
          failure = event.error?.message || 'Codex turn failed.';
      } catch (error) {
        startupFailure = error;
        void stopProcessTree(child);
      }
    }));
    child.stderr.on('data', (chunk) => enqueue(async () => {
      try {
        if (onStderr) await onStderr(chunk);
        else fs.appendFileSync(path.join(directory, 'stderr.log'), chunk, {
          mode: 0o600,
        });
      } catch (error) {
        startupFailure = error;
        void stopProcessTree(child);
      }
    }));
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      await writes;
      await startCallback;
      try { await onFinal?.(); } catch (error) { startupFailure ||= error; }
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
    child.stdin.end(task.prompt);
  });
}

module.exports = { commandFor, startSession };
