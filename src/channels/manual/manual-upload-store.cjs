const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { dataRoot } = require('../../config/runtime.cjs');
const { imageExtension, MAX_IMAGE_BYTES } = require('../../domain/image-format.cjs');
const { databaseForPath } = require('../../storage/database-registry.cjs');

const UPLOAD_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const UPLOAD_TTL = 24 * 60 * 60 * 1000;

class ManualUploadStore {
  constructor(directory = path.join(dataRoot, 'state', 'manual-uploads')) {
    this.directory = directory;
  }

  read(id) {
    if (typeof id !== 'string' || !UPLOAD_ID.test(id))
      throw new Error('无效的图片标识。');
    const file = path.join(this.directory, id);
    const database = databaseForPath(file);
    if (database) {
      const blob = database.readBlob(file);
      if (!blob || !blob.expiresAt || Date.parse(blob.expiresAt) <= Date.now())
        throw new Error('图片不存在或已过期，请移除后重新上传。');
      if (blob.data.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 10 MiB。');
      return { bytes: blob.data, extension: imageExtension(blob.data) };
    }
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      throw new Error('图片不存在或已过期，请移除后重新上传。');
    }
    if (!stat.isFile() || Date.now() - stat.mtimeMs > UPLOAD_TTL)
      throw new Error('图片已过期，请移除后重新上传。');
    if (stat.size > MAX_IMAGE_BYTES)
      throw new Error('单张图片不能超过 10 MiB。');
    const bytes = fs.readFileSync(file);
    return { bytes, extension: imageExtension(bytes) };
  }

  cleanup() {
    const database = databaseForPath(this.directory);
    if (database) {
      for (const blob of database.listBlobs(this.directory)) {
        if (blob.expiresAt && Date.parse(blob.expiresAt) <= Date.now()) database.deleteBlob(blob.path);
      }
      return;
    }
    for (const name of fs.readdirSync(this.directory)) {
      if (!UPLOAD_ID.test(name)) continue;
      const file = path.join(this.directory, name);
      try {
        const stat = fs.lstatSync(file);
        if ((stat.isFile() || stat.isSymbolicLink()) &&
            Date.now() - stat.mtimeMs > UPLOAD_TTL)
          fs.unlinkSync(file);
      } catch (error) {
        // A second service may have removed the same expired upload already.
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  upload(bytes) {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
      throw new Error('单张图片需为 1 字节至 10 MiB。');
    const extension = imageExtension(bytes);
    const database = databaseForPath(this.directory);
    if (database) {
      this.cleanup();
      const id = randomUUID();
      database.putBlob(path.join(this.directory, id), bytes, {
        mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
        expiresAt: new Date(Date.now() + UPLOAD_TTL).toISOString(),
      });
      return { id, extension, bytes: bytes.length };
    }
    fs.mkdirSync(this.directory, { recursive: true });
    this.cleanup();
    const id = randomUUID();
    fs.writeFileSync(path.join(this.directory, id), bytes, {
      mode: 0o600,
      flag: 'wx',
    });
    return { id, extension, bytes: bytes.length };
  }
}

module.exports = { ManualUploadStore };
