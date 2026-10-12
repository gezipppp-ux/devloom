const { accountError } = require('./account.cjs');
const { text, object } = require('./project-issues.cjs');
const { imageExtension, MAX_IMAGE_BYTES } = require('./image-format.cjs');

function previewMimeType(data) {
  if (!data) return null;
  const bytes = Buffer.from(data);
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  try { return { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[imageExtension(bytes)]; }
  catch { return null; }
}
function projectFileInput(input) {
  const name = text(input.name, '附件名称', 200, { required: true });
  if (/[\\/\u0000-\u001f\u007f]/.test(name)) throw accountError('附件名称不能包含路径或控制字符。', 400);
  if (!Buffer.isBuffer(input.data) || !input.data.length || input.data.length > MAX_IMAGE_BYTES) throw accountError('附件大小需为 1 字节至 10 MiB。', 400);
  if (input.mimeType !== undefined && typeof input.mimeType !== 'string') throw accountError('附件类型无效。', 400);
  const mimeType = input.mimeType?.split(';', 1)[0].trim().toLowerCase() || 'application/octet-stream';
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) || mimeType.length > 100) throw accountError('附件类型无效。', 400);
  return { name, mimeType: previewMimeType(input.data) || mimeType, data: input.data };
}
function issueAttachments(input) {
  if (!Object.hasOwn(input, 'attachments')) return [];
  if (!Array.isArray(input.attachments) || input.attachments.length > 20) throw accountError('附件最多 20 个。', 400);
  const ids = new Set();
  let size = 0;
  return input.attachments.map(file => {
    object(file, ['id', 'name', 'mimeType', 'data']);
    if (typeof file.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(file.id)) throw accountError('附件标识需为 UUIDv4。', 400);
    const id = file.id.toLowerCase();
    if (ids.has(id)) throw accountError('附件标识不能重复。', 400);
    ids.add(id);
    if (typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw accountError('附件内容需为有效 base64。', 400);
    const data = Buffer.from(file.data, 'base64');
    if (data.toString('base64') !== file.data) throw accountError('附件内容需为有效 base64。', 400);
    size += data.length;
    if (size > 20 * 1024 * 1024) throw accountError('附件合计不能超过 20 MiB。', 400);
    return { id, ...projectFileInput({ ...file, data }) };
  });
}
module.exports = { previewMimeType, projectFileInput, issueAttachments };
