# 全页面统一原型

生成方式：imagegen CLI · gpt-image-2 · 1536×1024 · high。沿用已选 C 方案。

## 手动需求

文件：01-new-manual.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Main breadcrumb "客户管理系统 / 新需求". Heading "从需求，开始开发。" Subtitle "描述目标与验收标准，为本次任务选择模型。" First white section header "需求信息" with 01 small step label: side-by-side "需求渠道" value "手动输入" and "任务类型" value "需求"; muted hint "新任务默认为进行中，进度由你维护。"; "需求标题" value "优化客户搜索体验"; "需求内容" textarea with "支持按姓名和手机号搜索客户"; "需求图片" compact dashed upload region with "选择图片" and PNG / JPEG / WebP helper; optional worktree directory field lower down. Second white section header "执行偏好" with side-by-side "Codex 模型" value "使用 Codex 默认配置" and "思考强度" value "使用默认思考强度"; small text action "刷新模型列表". Footer secondary "取消" and primary "创建 session 并开始开发 →". Keep all actual controls functional-looking, no hero illustration.
```

## TAPD 需求

文件：02-new-tapd.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Same new-requirement layout, breadcrumb and header as manual page. First white section "需求信息": side-by-side "需求渠道" value "TAPD" and "任务类型" value "Bug"; readonly "TAPD 项目 ID" value "123456"; search label "检索需求", input "导出" and secondary button "检索"; two compact search result rows with selected "修复客户导出异常", secondary ID "1024"; "需求 ID" value "1024"; two side-by-side searchable dropdowns "开发人员" value "张明" and "测试人员" value "李欣". Second section "执行偏好" model/reasoning paired dropdowns and refresh action. Footer cancel and primary start. Same 40px inputs, spacing, card headers, typography.
```

## 项目设置

文件：03-project-settings.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Main breadcrumb "客户管理系统 / 工作区设置". Title "客户管理系统 · 工作区设置", subtitle "配置项目环境与需求渠道。保存后应用于新任务。". Below two in-page anchor pills "项目环境" and "TAPD 渠道". Large white card "项目环境" with small repository outline icon and hint "路径属于运行服务的主机". Vertically stacked fields: "项目代码仓库" value "/srv/repos/customer"; "Worktree 根目录" value "/srv/worktrees"; "新任务基准引用" searchable dropdown "main · 本地分支" with muted helper BELOW control and positive 8px gap, never overlapping; "Worktree 初始化命令（可选）" textarea "pnpm install\npnpm build". Helper text short and gray. Bottom bordered action row "返回会话" and primary "保存执行设置". Below card show beginning of second white card "TAPD 渠道". No model or reasoning controls in workspace settings.
```

## TAPD 配置

文件：04-tapd-settings.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Settings page scrolled to second card, retain fixed shared left shell and main breadcrumb. Main page title "工作区设置", in-page anchors "项目环境", active "TAPD 渠道". One white card title "TAPD 渠道" with cloud outline icon, small status badge "已配置 Cookie"; subtitle "绑定当前项目，连接 TAPD 需求。". Fields "TAPD 项目 ID" value "123456"; "TAPD Cookie" blank textarea placeholder "已保存 Cookie；留空保留，粘贴新值替换"; gray helper "已保存的 Cookie 不会回显。"; unchecked checkbox "清除已保存的 Cookie"; "开发中状态码" value "developing", helper "Codex 开始执行后流转到此 TAPD 状态。"; "额外图片域名（可选，每行一个）" textarea placeholder "cdn.example.com", helper "仅用于下载需求中的外部图片。". Bottom pale green feedback strip "连接成功，当前配置可访问 TAPD。", then secondary "检测连接" primary "保存 TAPD 配置". No actual credentials displayed. Same design system.
```

## 会话

文件：05-session.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Main breadcrumb "客户管理系统 / 需求会话". White header title "优化客户搜索体验", small badge "Codex · 本轮结束", outline "刷新" on right. Next compact metadata toolbar labels "类型" dropdown "需求", "进度" dropdown "待验收", muted hint "进度由你维护". Collapsed slim disclosure "会话信息与需求资料" with chevron and small subtitle "模型 · 分支 · 需求快照". Conversation timeline in center 800px column: pale sage user message block "支持按姓名和手机号搜索客户，输入后实时筛选。"; assistant role "CODEX" and text "已完成搜索交互与结果展示，接下来检查边界情况。"; compact bordered collapsible tool "命令执行" with "npm run test" and muted "已完成"; assistant final message with short bulleted verification summary. Bottom white bordered rounded composer "输入指令，继续这个 session…" with Ctrl + Enter helper and forest button "发送 ↑". Distinguish human progress from Codex status. Sidebar selected first task pale green and review badge amber. Spacious yet useful developer conversation UI.
```

## 需求资料

文件：06-requirement-details.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
Main same session header "优化客户搜索体验", type/progress toolbar. Expanded "会话信息与需求资料" disclosure, show white detail card with tidy label-value grid: "Codex 模型" "使用默认配置", "思考强度" "默认思考强度", "分支" "codex/customer-search", "Worktree" "/srv/worktrees/customer-search", "渠道同步" "无需同步", "Session" "session-example". Below divider heading "需求正文", right green "查看原需求 ↗", muted snapshot date. Render requirement rich text: heading "客户搜索体验", paragraph, three item acceptance checklist, small 2-column table, two thumbnail attachment placeholders in bordered tiles (simple UI screenshots), collapsible "发送给 Codex 的完整内容". Main details scroll region; retain composer below. Keep fonts readable. Do not show secret credentials or giant UUID as primary headline.
```

## 工作区与弹窗

文件：07-workspace-dialogs.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
This one image is a labeled UI design board with three panels demonstrating the SAME visual system: left 45% width full empty workspace page, right 55% width two stacked dialog views. Left ivory welcome page t_ dark-green icon, "需求 × CODEX", large title "创建或选择工作区", short subtitle "一个项目，一套配置。", existing workspace choice rows "客户管理系统" and "运营后台", green "＋ 新建工作区". Right upper modal title "新建工作区", close x, name input "客户管理系统", icon picker preview of folder icon beside name, search "搜索图标", curated thin SVG icons grid (folder, code, cloud, terminal, globe, app), active green tile, secondary "取消" primary "创建工作区". Right lower modal title "编辑工作区", same form and icon picker, secondary reset "恢复默认", primary "保存工作区". Modals white, 16px corners, subtle shadow and sage tinted dim backdrop, consistent 24px padding. Label board sections modestly "工作区入口", "新建工作区", "编辑工作区". No unrelated features.
```

## 状态与移动端

文件：08-states-mobile.png

```text
Use case: ui-mockup.
Create a polished, realistically implementable Chinese desktop web application UI screenshot for "需求 × CODEX", part of one coherent eight-screen design system. 1536x1024 canvas, straight-on flat UI, no device frame, no browser chrome, no perspective, no decorative illustrations or gradients. This is an existing developer workbench: do not invent teams, avatars, billing, dashboards or functionality.
Design system: warm ivory canvas #f7f8f5, white card surfaces, light sage project pane #eff3ed, darker sage workspace rail #e6ece4, forest green primary #204b3c, text #203e34, muted text #68796f, hairline borders #dfe5de. Crisp Chinese sans-serif, 28px page titles, 14px body, 12px secondary text. 8px spacing unit, 40px-high input fields, 8px control radii, 12px card radii, 24px card padding, restrained thin outline SVG icons, no heavy shadows. Button hierarchy forest green primary, white border secondary, quiet text tertiary. Clear readable Chinese, correct spelling. Relaxed but efficient density.
Shared desktop shell: leftmost 64px icon rail with t_ brand tile, selected folder outline workspace icon, second app icon, plus action; adjacent 256px project sidebar showing brand "需求 × CODEX", project name "客户管理系统", ellipsis edit, "工作区设置", forest button "＋ 从需求启动", task toolbar "需求列表 3" and grouping dropdown "按类型", collapsible groups "需求 1", "Bug 1", "其他 1". Example task rows "优化客户搜索体验", "修复导出异常", "整理项目文档", small type and human progress badges and separate muted Codex status. Footer dot "服务已连接". Main starts at x320. Main has a thin top breadcrumb bar, then a max-width 800px centered column with 32px top gap, clear heading/subtitle and white bordered sections. Main body scrolls if needed, never shrink fonts to cram. Consistent anatomy and colors across every screen.

Screen-specific requirements:
This image is a coherent UI design board: left two-thirds two stacked desktop component examples, right third a 390px mobile viewport. Left top approval card on ivory "需要你的输入", title "Codex 请求执行命令", pale neutral code block "npm run build", outline "拒绝", green "允许本次操作"; below second clarification card "搜索范围包含哪些字段？", selectable answer chips "姓名和手机号" active and "仅姓名", custom answer input, green "提交回答". Left bottom show empty state heading "让需求与开发，在这里连起来。", muted subtitle, green "从需求启动 →"; separate subtle disconnected warning banner "实时连接已断开，正在重连" and red inline form validation "请填写此项", five small progress badges "进行中 / 待验收 / 待合并 / 已完成 / 已搁置". Right mobile view same ivory-sage-forest style with workspace icons in horizontal top rail, compact project header and settings, new requirement button, compact scrollable task group list, then title "优化客户搜索体验", two metadata dropdowns, user and assistant messages, composer. No horizontal overflow, controls at least 40px touch targets. Board headings small, no ornamental illustrations.
```
