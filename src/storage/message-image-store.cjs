const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const {
  imageExtension,
  MAX_IMAGE_BYTES,
} = require("../domain/image-format.cjs");
const { MESSAGE_IMAGE_ID } = require("../domain/session-message.cjs");
const { samePath } = require("../shared/paths.cjs");
const { readOptional, updateConfig } = require("./json-files.cjs");
const { databaseForPath } = require("./database-registry.cjs");
const { writeArtifact, materializeArtifact } = require("./artifact-store.cjs");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Stored filenames are generated here. Neither HTTP nor Codex paths authorize reads.
class MessageImageStore {
  constructor(runDirectory) {
    this.runDirectory = runDirectory;
    this.directory = path.join(runDirectory, "message-images");
    this.indexFile = path.join(this.directory, "index.json");
    this.database = databaseForPath(this.directory);
  }

  assertDirectory() {
    const root = fs.realpathSync.native(this.runDirectory);
    const directory = fs.realpathSync.native(this.directory);
    if (!samePath(path.dirname(directory), root))
      throw new Error("图片目录不属于当前任务。");
  }

  async list() {
    if (!this.database && !fs.existsSync(this.directory)) return [];
    if (!this.database) this.assertDirectory();
    if (
      !this.database && fs.existsSync(this.indexFile) &&
      !samePath(
        path.dirname(fs.realpathSync.native(this.indexFile)),
        fs.realpathSync.native(this.directory),
      )
    )
      throw new Error("图片索引不属于当前任务。");
    const saved = (await readOptional(this.indexFile));
    const images = saved.images || [];
    if (
      !Array.isArray(images) ||
      images.some(
        (image) =>
          !image ||
          !MESSAGE_IMAGE_ID.test(image.id) ||
          !["png", "jpg", "webp"].includes(image.extension) ||
          !Number.isInteger(image.size) ||
          image.size <= 0 ||
          image.size > MAX_IMAGE_BYTES ||
          !/^[0-9a-f]{64}$/.test(image.sha256),
      )
    )
      throw new Error("会话图片索引无效。");
    return images;
  }

  async save(bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > MAX_IMAGE_BYTES
    )
      throw new Error("单张图片必须为 1 字节至 10 MiB。");
    const extension = imageExtension(bytes);
    if (this.database) {
      const image = { id: randomUUID(), extension, size: bytes.length, sha256: digest(bytes), createdAt: new Date().toISOString() };
      (await this.database.transaction(async () => {
        (await writeArtifact(this.filename(image), bytes, { mimeType: extension === "jpg" ? "image/jpeg" : `image/${extension}` }));
        (await updateConfig(this.indexFile, (saved) => ({ images: [...(saved.images || []), image] })));
      }));
      return image;
    }
    fs.mkdirSync(this.directory, { recursive: true });
    this.assertDirectory();
    (await this.list());
    const image = {
      id: randomUUID(),
      extension,
      size: bytes.length,
      sha256: digest(bytes),
      createdAt: new Date().toISOString(),
    };
    const file = this.filename(image);
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    try {
      (await updateConfig(this.indexFile, async () => ({ images: [...(await this.list()), image] })));
    } catch (error) {
      fs.unlinkSync(file);
      throw error;
    }
    return image;
  }

  filename(image) {
    return path.join(this.directory, `${image.id}.${image.extension}`);
  }

  async read(id) {
    if (typeof id !== "string" || !MESSAGE_IMAGE_ID.test(id))
      throw new Error("无效的会话图片标识。");
    const image = (await this.list()).find((entry) => entry.id === id);
    if (!image)
      throw Object.assign(new Error("当前任务中不存在该会话图片。"), {
        code: "ENOENT",
      });
    if (this.database) (await materializeArtifact(this.filename(image)));
    const file = fs.realpathSync.native(this.filename(image));
    if (!samePath(path.dirname(file), fs.realpathSync.native(this.directory)))
      throw new Error("图片不属于当前任务。");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== image.size)
      throw new Error("会话图片文件无效。");
    const bytes = fs.readFileSync(file);
    if (
      imageExtension(bytes) !== image.extension ||
      digest(bytes) !== image.sha256
    )
      throw new Error("会话图片文件已发生变化，请重新上传。");
    return { ...image, path: file };
  }

  async match(sources) {
    if (!Array.isArray(sources) || !sources.length) return [];
    const images = await this.list();
    return sources.flatMap(source => {
      const image = typeof source?.path === "string"
        ? images.find(entry => samePath(this.filename(entry), source.path))
        : typeof source?.sha256 === "string"
          ? images.find(entry => entry.sha256 === source.sha256) : null;
      return image ? [image] : [];
    });
  }
}

module.exports = { MessageImageStore };
