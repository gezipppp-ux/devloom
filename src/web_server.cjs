const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { WebSessions } = require('./web_sessions.cjs');
const { argument, configPath, root, dataRoot } = require('./config.cjs');
const { defaultChannels } = require('./channels/registry.cjs');
const { readSettings, saveSettings, listBaseRefs } = require('./settings.cjs');
const { RUN_KEY } = require('./run_identity.cjs');
const { MAX_IMAGE_BYTES } = require('./image_format.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function json(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new Error('请求必须使用 application/json');
  let data = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    data += chunk.toString('utf8');
    if (Buffer.byteLength(data) > 256000) throw new Error('请求内容过大');
  }
  return JSON.parse(data || '{}');
}

async function imageBody(request) {
  if (Number(request.headers['content-length']) > MAX_IMAGE_BYTES)
    throw new Error('单张图片不能超过 10 MiB。');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 10 MiB。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createWebServer({
  configFile = configPath(),
  manager,
  channels = manager?.channels || defaultChannels(configFile),
  staticDirectory = path.join(root, 'web', 'dist'),
} = {}) {
  const sessions =
    manager ||
    new WebSessions({
      runsDirectory: path.join(dataRoot, 'runs'),
      configFile,
      channels,
    });
  const token = randomBytes(32).toString('hex');
  const clients = new Set();
  let origin;
  sessions.on('event', (event) => {
    for (const response of clients) {
      if (response.writableLength > 1024 * 1024) {
        response.destroy();
        clients.delete(response);
      } else response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });
  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    origin ||= `http://127.0.0.1:${server.address().port}`;
    const expectedHost = new URL(origin).host;
    if (
      request.headers.host !== expectedHost ||
      (request.headers.origin && request.headers.origin !== origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return json(response, 403, {
        error: '仅允许本地同源访问。请使用终端显示的地址。',
      });
    try {
      const url = new URL(request.url, origin);
      if (
        request.method === 'POST' &&
        request.headers['x-tapd-token'] !== token
      )
        return json(response, 403, { error: '页面令牌失效，请刷新页面。' });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        const sources = channels.list();
        return json(response, 200, {
          token,
          workspace:
            sources.find((source) => source.id === 'tapd')?.workspace || '',
          channels: sources,
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/settings')
        return json(response, 200, readSettings(configFile));
      if (request.method === 'GET' && url.pathname === '/api/settings/refs')
        return json(response, 200, {
          refs: listBaseRefs(url.searchParams.get('repository')),
        });
      if (request.method === 'POST' && url.pathname === '/api/settings')
        return json(
          response,
          200,
          saveSettings(await body(request), configFile),
        );
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        response.write(': connected\n\n');
        clients.add(response);
        const timer = setInterval(
          () => response.write(': heartbeat\n\n'),
          15000,
        );
        request.on('close', () => {
          clearInterval(timer);
          clients.delete(response);
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runs')
        return json(response, 200, { runs: sessions.list() });
      if (
        request.method === 'GET' &&
        ['/api/stories', '/api/requirements'].includes(url.pathname)
      ) {
        const channel = channels.get(
          url.pathname === '/api/stories'
            ? 'tapd'
            : url.searchParams.get('channel') || 'tapd',
        );
        if (!channel.capabilities?.search)
          throw new Error('该渠道不支持需求检索。');
        const items = await channel.search({
          query: url.searchParams.get('query'),
          workspace: url.searchParams.get('workspace'),
        });
        return json(response, 200, { items });
      }
      if (request.method === 'GET' && url.pathname === '/api/users') {
        const channel = channels.get(url.searchParams.get('channel') || 'tapd');
        if (!channel.capabilities?.assignees)
          throw new Error('该渠道不支持人员选择。');
        const users = await channel.searchUsers({
          query: url.searchParams.get('query'),
          workspace: url.searchParams.get('workspace'),
        });
        return json(response, 200, {
          users: users.map((user) => ({
            id: user.id,
            nick: user.nick,
            name: user.name,
          })),
        });
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/api/channels/manual/images'
      )
        return json(
          response,
          201,
          channels.get('manual').uploadImage(await imageBody(request)),
        );
      if (request.method === 'POST' && url.pathname === '/api/runs')
        return json(response, 202, await sessions.start(await body(request)));
      const route = /^\/api\/runs\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      if (route && RUN_KEY.test(route[1])) {
        const [, key, action] = route;
        if (request.method === 'GET' && !action)
          return json(response, 200, await sessions.view(key));
        if (request.method === 'GET' && action === 'history')
          return json(
            response,
            200,
            await sessions.history(key, url.searchParams.get('cursor')),
          );
        if (request.method === 'GET' && /^images\/\d+$/.test(action || '')) {
          const file = sessions.store.imagePath(key, action.split('/')[1]);
          response.writeHead(200, {
            'content-type':
              MIME[path.extname(file)] || 'application/octet-stream',
            'cache-control': 'private, max-age=300',
          });
          fs.createReadStream(file)
            .on('error', () => response.destroy())
            .pipe(response);
          return;
        }
        if (request.method === 'POST' && action === 'messages')
          return json(
            response,
            202,
            await sessions.send(key, (await body(request)).text),
          );
        if (request.method === 'POST' && action === 'interrupt')
          return json(response, 202, await sessions.interrupt(key));
        if (request.method === 'POST' && action === 'responses') {
          const input = await body(request);
          await sessions.respond(key, input.requestId, input);
          return json(response, 200, { ok: true });
        }
      }
      if (url.pathname.startsWith('/api/'))
        return json(response, 404, { error: '接口不存在' });
      if (request.method !== 'GET')
        return json(response, 405, { error: '不支持该请求方法' });
      const relative =
        url.pathname === '/'
          ? 'index.html'
          : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(staticDirectory, relative);
      if (!file.startsWith(path.resolve(staticDirectory) + path.sep))
        return json(response, 403, { error: '无效的文件路径' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return json(response, 404, {
          error: '页面未构建，请运行 npm run web:build。',
        });
      response.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
    } catch (error) {
      if (!response.headersSent)
        json(response, error.code === 'ENOENT' ? 404 : 400, {
          error: error.message,
        });
      else response.end();
    }
  });
  return {
    server,
    sessions,
    async listen(port = 4317) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${server.address().port}`;
      return origin;
    },
    async close() {
      for (const response of clients) response.end();
      await sessions.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  const port = Number(argument('--port') || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('端口需为 1–65535。');
  const application = createWebServer();
  const origin = await application.listen(port);
  process.stdout.write(
    `TAPD Web CLI: ${origin}\n保持此进程运行；关闭浏览器不会停止 Codex。\n`,
  );
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    application.close().catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
module.exports = { createWebServer };
