const { readOptional } = require('../../storage/json-files.cjs');
const { validateWorktreeName } = require('../../domain/worktree-name.cjs');
const { MAX_IMAGES } = require('../../domain/image-format.cjs');
const {
  getPromptTemplates,
} = require('../../domain/prompt-templates.cjs');
const { ManualUploadStore } = require('./manual-upload-store.cjs');
const { buildManualTaskPackage } = require('./task-package.cjs');

const REQUEST_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function createManualChannel(configFile, { uploadDirectory } = {}) {
  const uploads = new ManualUploadStore(uploadDirectory);
  return {
    id: 'manual',
    label: '手动输入',
    capabilities: { manualInput: true },
    describe() {
      return {
        id: this.id,
        label: this.label,
        capabilities: this.capabilities,
      };
    },
    async uploadImage(bytes) {
      return (await uploads.upload(bytes));
    },
    async resolve({
      requestId,
      title,
      content = '',
      images = [],
      worktreeName = '',
      renderedPrompt = false,
    }) {
      if (typeof renderedPrompt !== 'boolean')
        throw new Error('无效的提示词格式。');
      if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId))
        throw new Error('无效的手动需求标识，请重新打开表单。');
      if (typeof title !== 'string' || !title.trim() || title.length > 200)
        throw new Error('标题必填，最多 200 字。');
      if (typeof content !== 'string' || content.length > 60000)
        throw new Error('需求内容最多 60000 字。');
      if (
        !Array.isArray(images) ||
        images.length > MAX_IMAGES ||
        new Set(images).size !== images.length
      )
        throw new Error('最多上传 20 张不同图片。');
      if (!content.trim() && !images.length)
        throw new Error('请填写需求内容或上传图片。');
      for (const id of images) (await uploads.read(id));
      const directoryName = validateWorktreeName(worktreeName);
      const config = (await readOptional(configFile));
      return {
        item: {
          id: requestId,
          workspace_id: 'local',
          type: 'requirement',
          title: title.trim(),
          markdown_description: content,
          image_ids: images,
          worktree_name: directoryName,
          rendered_prompt: renderedPrompt,
        },
        config: {
          ...config,
          prompt_templates: getPromptTemplates(config),
        },
        session: null,
      };
    },
    async prepare({ item, directory, config }) {
      return (await buildManualTaskPackage({
        item,
        directory,
        config,
        readImage: async (id) => (await uploads.read(id)),
      }));
    },
    async transition() {
      return { status: 'skipped', reason: '手动需求无需同步外部渠道' };
    },
  };
}
module.exports = { createManualChannel };
