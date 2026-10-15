const path = require('node:path');
const { writeArtifact } = require('../../storage/artifact-store.cjs');
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

async function buildManualTaskPackage({ item, directory, readImage, config = {} }) {
  const images = (await Promise.all(item.image_ids.map(async (id, offset) => {
    const { bytes, extension } = await readImage(id);
    const file = path.join(
      directory,
      'images',
      `${String(offset + 1).padStart(2, '0')}.${extension}`,
    );
    (await writeArtifact(file, bytes, { materialize: true, mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}` }));
    return {
      index: offset + 1,
      source: `manual-image:${id}`,
      path: file,
      bytes: bytes.length,
    };
  })));
  const workitem = { ...item };
  delete workitem.image_ids;
  const imageList = images
    .map((image) => `图片 ${image.index}：${image.path}`)
    .join('\n');
  const imageDescription = [
    `附带 ${images.length} 个图片附件，已作为图片输入发送，请结合附件理解需求。`,
    ...(imageList ? [imageList] : []),
  ].join('\n');
  const type = item.type === 'bug' ? 'bug' : 'requirement';
  const prompt = item.rendered_prompt ? [item.markdown_description, imageDescription].join('\n\n') : renderPromptTemplate(type, getPromptTemplates(config)[type], {
    title: item.title,
    content: item.markdown_description,
    attachments: imageDescription,
    attachment_count: images.length,
    attachment_list: imageList,
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
      prompt,
      execution_ready: true,
      blocked_reason: null,
    },
  };
}

module.exports = { titleSlug, buildManualTaskPackage };
