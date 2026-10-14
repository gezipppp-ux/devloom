const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { absolutePath } = require('../shared/paths.cjs');

function resolveCodex(config = {}, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const node = options.node || process.execPath;
  const io = options.fs || fs;
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const absolute = (value) => {
    if (!windows) return paths.isAbsolute(value) ? value : null;
    try {
      return absolutePath(value, 'Codex 命令路径', platform);
    } catch {
      return null;
    }
  };
  const environment = (name) =>
    env[
      Object.keys(env).find((key) =>
        windows ? key.toUpperCase() === name : key === name,
      )
    ] || '';
  const isFile = (file, executable = true) => {
    try {
      if (!io.statSync(file).isFile()) return false;
      io.accessSync(
        file,
        executable && !windows ? fs.constants.X_OK : fs.constants.F_OK,
      );
      return true;
    } catch {
      return false;
    }
  };
  if (
    config.command_args !== undefined &&
    (!Array.isArray(config.command_args) ||
      config.command_args.some(
        (arg) => typeof arg !== 'string' || arg.includes('\0'),
      ))
  )
    throw new Error('codex.command_args 必须是字符串数组。');
  if (config.command !== undefined && typeof config.command !== 'string')
    throw new Error('codex.command 必须是可执行文件路径或命令名。');
  const extra = config.command_args || [];
  const candidate = (file) => {
    if (!isFile(file)) return null;
    if (/\.(cmd|bat|ps1)$/i.test(file)) {
      // Recognize npm's Codex entry point without executing or parsing a shell shim.
      if (windows && paths.basename(file).toLowerCase() === 'codex.cmd') {
        const script = paths.join(
          paths.dirname(file),
          'node_modules',
          '@openai',
          'codex',
          'bin',
          'codex.js',
        );
        if (isFile(script, false) && isFile(node))
          return { command: node, args: [script, ...extra] };
      }
      return null;
    }
    if (!windows) {
      const target = io.realpathSync(file);
      if (paths.basename(target) === 'codex.js' && isFile(node))
        return { command: node, args: [target, ...extra] };
    }
    return { command: file, args: [...extra] };
  };
  const search = (name, directories) => {
    const names =
      windows && !paths.extname(name)
        ? [`${name}.exe`, `${name}.cmd`, name]
        : [name];
    for (const directory of directories) {
      // Do not search the working directory via empty/relative PATH entries.
      const root = absolute(directory);
      if (!root) continue;
      for (const basename of names) {
        const result = candidate(paths.join(root, basename));
        if (result) return result;
      }
    }
    return null;
  };
  const directories = environment('PATH')
    .split(paths.delimiter)
    .map((part) => (windows ? part.trim().replace(/^"(.*)"$/, '$1') : part))
    .filter(Boolean);
  const explicit = config.command || environment('CODEX_BIN');
  if (explicit) {
    if (typeof explicit !== 'string' || explicit.includes('\0'))
      throw new Error(
        'codex.command / CODEX_BIN 必须是可执行文件路径或命令名。',
      );
    const file = absolute(explicit);
    const result = file
      ? candidate(file)
      : !/[\\/]/.test(explicit)
        ? search(explicit, directories)
        : null;
    if (result) return result;
    throw new Error(
      `无法启动 Codex：指定的命令不可用：${explicit}。请修正 agent.options.command / CODEX_BIN；迁移系统后移除旧路径可启用自动查找。脚本启动器仅支持标准 npm codex.cmd，其他情况请配置 node 与 command_args。`,
    );
  }
  let result = search('codex', directories);
  if (result) return result;
  const fallback = [
    paths.dirname(node),
    paths.join(home, '.local', 'bin'),
    paths.join(home, '.npm-global', 'bin'),
  ];
  if (windows) {
    const roaming = environment('APPDATA');
    const local = environment('LOCALAPPDATA');
    if (roaming) fallback.push(paths.join(roaming, 'npm'));
    if (local) {
      const desktop = paths.join(local, 'OpenAI', 'Codex', 'bin');
      fallback.push(desktop);
      try {
        const versions = io
          .readdirSync(desktop, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => paths.join(desktop, entry.name))
          .sort((a, b) => io.statSync(b).mtimeMs - io.statSync(a).mtimeMs);
        fallback.push(...versions);
      } catch {
        /* Desktop Codex is optional. */
      }
    }
  } else {
    // Homebrew uses a separate prefix on Apple Silicon. Follow the Node
    // process architecture so an Intel/Rosetta process keeps its Intel tools.
    if (platform === 'darwin' && arch === 'arm64') fallback.push('/opt/homebrew/bin');
    fallback.push('/usr/local/bin', '/usr/bin', '/bin');
  }
  result = search('codex', fallback);
  if (result) return result;
  throw Object.assign(new Error(
    '未找到 Codex CLI。请为运行服务的用户安装并登录 Codex，将其目录加入服务 PATH，或设置 CODEX_BIN / codex.command 为可执行文件绝对路径。systemd / launchd 不会自动读取终端的 nvm 或 Homebrew 初始化配置；修改后请重启服务。',
  ), { code: 'TOOL_NOT_FOUND' });
}

module.exports = { resolveCodex };
