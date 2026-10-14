# UI 设计契约

日期：2026-10-13。新的视觉目标为 [B 方案 UI 重构 PRD](../prd/ui-refactor.md)。用户已确认原型，正式 Vue 实现采用相同的中性导航、设计变量和响应式规则。范围与验证见[实施记录](../prd/ui-refactor-implementation.md)。

## 规范来源

- [中性协作视觉 Skill](../../.agents/skills/neutral-workbench/SKILL.md) 定义新的视觉与响应式规则。
- [UI 实施 Skill](../../.agents/skills/web-coding-ui/SKILL.md) 定义原型到 Vue 的阶段边界。
- [完整设计图册](../prd/assets/ui-refactor/index.html) 与 [HTML 原型](../prototypes/ui-refactor/review.html) 用于评审。
- [页面映射](../prd/ui-refactor-pages.md) 记录所有参考图对应的界面或关键状态。

这些规则由用户选定的白色 B 方案重建，不继承旧 UI skills 的主题和布局。正式主题位于 `web/src/shared/styles/design-tokens.css`，壳层与公共呈现位于 `workbench.css`。

## 布局

同一套工作台、项目、事项、开发、交付导航，个人与系统设置在低频区。权限控制操作，不引入职业视角切换。白色主体、浅灰分隔、石墨主按钮、克制紫色强调；具体 token 保存在新视觉 Skill 的 assets 中。

按 CSS 视口流式布局，验证 1920×1080、2560×1440、1440×900、1280×720、768×1024、390×844、320×740 及短屏。大屏增加上下文宽度，正文和表单仍限制行宽；移动端重排为单列、抽屉导航与底栏。不能按效果图分辨率整体缩放页面。

## 业务与技术

页面可以重组，权限、会话所有者、状态语义、Git 和 Worktree 身份仍遵循 [账号与数据库契约](accounts-and-database.md) 及 [生命周期 PRD](../prd/project-lifecycle.md)。生成图中的示例日期、模型和字段不定义真实接口。

Vue 使用仓库公共组件及统一 token，按 `app → features → shared` 边界组合。原型继续用模拟数据供设计追溯；正式页面使用权限校验后的真实接口。语言切换沿用同一组件实例，不重置表单或会话。

## 验收

原型使用浏览器内模拟状态，不访问真实 API、Agent 或 Git。验证跨页操作、表单错误、空／错误／只读状态、焦点、模态关闭和响应式截图；验证记录随原型维护。生产替换另行执行仓库全部工程和浏览器回归，不能把原型操作成功解释为生产接口已实现。
