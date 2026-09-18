const fs = require('node:fs');
const path = require('node:path');
const { pinyin } = require('pinyin-pro');
const {
  getPromptTemplates,
  renderPromptTemplate,
} = require('../../domain/prompt-templates.cjs');

function titleSlug(title) {
  return (
    pinyin(title, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('-')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'requirement'
  );
}

function buildManualTaskPackage({ item, directory, readImage, config = {} }) {
  const images = item.image_ids.map((id, offset) => {
    const { bytes, extension } = readImage(id);
    const file = path.join(
      directory,
      'images',
      `${String(offset + 1).padStart(2, '0')}.${extension}`,
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    return {
      index: offset + 1,
      source: `manual-image:${id}`,
      path: file,
      bytes: bytes.length,
    };
  });
  const workitem = { ...item };
  delete workitem.image_ids;
  const imageList = images
    .map((image) => `图片 ${image.index}：${image.path}`)
    .join('\n');
  const imageDescription = [
    `附带 ${images.length} 张本地图片，顺序与用户上传顺序一致，请结合图片理解需求。`,
    ...(imageList ? [imageList] : []),
  ].join('\n');
  const prompt = renderPromptTemplate('manual', getPromptTemplates(config).manual, {
    title: item.title,
    content: item.markdown_description,
    images: imageDescription,
    image_count: images.length,
    image_list: imageList,
  });
  return {
    workitem,
    worktreeSlug: titleSlug(item.title),
    worktreeName: item.worktree_name,
    target: null,
    task: {
      generated_at: new Date().toISOString(),
      workitem,
      images,
      codex_prompt: prompt,
      execution_ready: true,
      blocked_reason: null,
    },
  };
}

module.exports = { titleSlug, buildManualTaskPackage };
