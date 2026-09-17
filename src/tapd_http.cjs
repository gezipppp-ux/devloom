function parseData(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function headers(session, referer = session.referer) {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    cookie: session.cookie_header,
    origin: 'https://www.tapd.cn',
    referer,
    'user-agent': 'tapd-codex-runner/0.1',
  };
}

function assertSuccess(result, label) {
  if (!result || !['0', 0].includes(result.meta?.code)) {
    throw new Error(
      `${label} rejected the request (code ${result?.meta?.code ?? 'missing'}). Check session validity and TAPD permissions.`,
    );
  }
}

async function request(session, url, options = {}) {
  const target = new URL(url);
  if (target.origin !== 'https://www.tapd.cn')
    throw new Error('TAPD API endpoint must use https://www.tapd.cn.');
  const response = await fetch(target, {
    ...options,
    headers: { ...headers(session), ...options.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `TAPD HTTP ${response.status}. Refresh the session or check permissions.`,
    );
  let outer;
  try {
    outer = await response.json();
  } catch {
    throw new Error(
      'TAPD returned non-JSON content. The saved login may have expired.',
    );
  }
  assertSuccess(outer, 'TAPD');
  return parseData(outer.data);
}

module.exports = { assertSuccess, headers, parseData, request };
