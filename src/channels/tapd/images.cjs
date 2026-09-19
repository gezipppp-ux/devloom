const { writeArtifact } = require('../../storage/artifact-store.cjs');
const path = require('node:path');
const { marked } = require('marked');

const {
  imageExtension,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} = require('../../domain/image-format.cjs');

function decodeEntities(value) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named = {
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
        '&lt;': '<',
        '&gt;': '>',
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = entity.toLowerCase().startsWith('&#x');
      const code = Number.parseInt(
        entity.slice(hex ? 3 : 2, -1),
        hex ? 16 : 10,
      );
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

function extractImages(workitem) {
  const sources = [];
  for (const text of [
    workitem.description || '',
    workitem.markdown_description || '',
  ]) {
    // Render Markdown first so references resolve and code/escaped examples
    // remain text. Raw HTML still supports TAPD's lazy image attributes.
    const html = marked.parse(text).replace(
      /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    );
    for (const match of html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const attrs = new Map(
        [
          ...match[0].matchAll(
            /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
          ),
        ].map((attr) => [attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4]]),
      );
      const source =
        attrs.get('data-src') || attrs.get('data-original') || attrs.get('src');
      if (!source) throw new Error('A TAPD image has no downloadable source.');
      sources.push(source);
    }
  }
  return [
    ...new Set(
      sources.map((source) => {
        const url = new URL(
          decodeEntities(source.trim()),
          workitem.detail_url || 'https://www.tapd.cn/',
        );
        url.hash = '';
        return url.href;
      }),
    ),
  ];
}

function allowedUrl(value, extraHosts) {
  const url = new URL(value);
  const tapd = url.hostname === 'tapd.cn' || url.hostname.endsWith('.tapd.cn');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    (!tapd && !extraHosts.some((host) => host.toLowerCase() === url.hostname))
  ) {
    throw new Error(
      `Image host is not allowed: ${url.hostname}. Configure tapd.image_hosts for trusted attachment hosts.`,
    );
  }
  return url;
}

async function downloadImage(source, session, extraHosts = []) {
  if (source.startsWith('data:')) {
    const match = /^data:image\/(png|jpeg|webp);base64,([a-z\d+/=\s]+)$/i.exec(
      source,
    );
    if (!match)
      throw new Error('Unsupported embedded image; use PNG, JPEG or WebP.');
    if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      throw new Error('Embedded image exceeds 10 MiB.');
    return Buffer.from(match[2], 'base64');
  }
  let url = allowedUrl(source, extraHosts);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    // TAPD's authenticated file service needs the same login as the main site.
    // Never forward these credentials to arbitrary subdomains or external CDNs.
    const headers = { accept: 'image/*', referer: 'https://www.tapd.cn/' };
    if (['https://www.tapd.cn', 'https://file.tapd.cn'].includes(url.origin))
      headers.cookie = session.cookie_header;
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Image redirect has no location.');
      url = allowedUrl(new URL(location, url).href, extraHosts);
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error(
        `Image download failed (HTTP ${response.status}). Refresh TAPD login if needed.`,
      );
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      await response.body.cancel();
      throw new Error('Image exceeds 10 MiB.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Image exceeded five redirects.');
}

async function collectImages(workitem, session, directory, options = {}) {
  const sources = extractImages(workitem);
  if (sources.length > MAX_IMAGES)
    throw new Error(
      'Requirement contains more than 20 images; split it before execution.',
    );
  const images = [];
  for (const [index, source] of sources.entries()) {
    let bytes;
    let extension;
    try {
      bytes = await downloadImage(source, session, options.image_hosts || []);
      extension = imageExtension(bytes);
    } catch (error) {
      throw new Error(`Requirement image ${index + 1}: ${error.message}`);
    }
    const file = path.resolve(
      directory,
      'images',
      `${String(index + 1).padStart(2, '0')}.${extension}`,
    );
    writeArtifact(file, bytes, { materialize: true, mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` });
    images.push({
      index: index + 1,
      source: source.startsWith('data:') ? '(embedded image)' : source,
      path: file,
      bytes: bytes.length,
    });
  }
  return images;
}

module.exports = {
  collectImages,
  downloadImage,
  extractImages,
};
