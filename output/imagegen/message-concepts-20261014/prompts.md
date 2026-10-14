# 消息提示设计方案（待用户确认）

日期：2026-10-14
模式：imagegen 官方 CLI / Image API（用户指定平台）
平台：https://aimodel.mingy-iot.com/
模型标识：gpt-image-2.5-sunburst
请求参数：1536 × 1024，high，PNG；每个方案独立提示词。

本轮仅输出设计图，尚未修改应用。面向现有操作消息（成功、错误、警告、信息）；选定后再实现响应式与中英文布局。设计图分辨率不是后续 CSS 布局限制。

- A · 顶部极简提示条：[设计图](a-top-minimal.png)
- B · 右上角轻浮卡片：[设计图](b-top-right-card.png)
- C · 右下角消息叠层：[设计图](c-bottom-right-stack.png)

## 共用提示词

Use case: ui-mockup.
Asset type: a premium, spacious UI design presentation board for the WEB CODING collaboration app, showing a proposed global operation-message / toast component redesign, not a dialog or chat conversation.
Style: extremely modern, quiet, minimal and carefully typeset. Flat, crisp, front-facing software screenshot graphics. White dominant, barely grey canvas #fafafb, white surfaces, ink #24252d, secondary #727480, hairline borders #e9e9ef. Graphite primary buttons #292a33 and restrained purple #7256d8 in the surrounding app only. Status colors are small muted accents: green #26765a, red #b64750, amber #95620c, purple #7256d8. All message text remains dark neutral, not saturated status-colored text. Soft, shallow shadows.
Composition: landscape 1536x1024 board with generous outer margins, 40 percent negative space, exact alignment and plenty of air. Header at top left. Left half shows four large isolated component specimens vertically, separated by ample whitespace. Right half shows one restrained desktop app screenshot for placement context above one smaller mobile screen adaptation. Desktop context contains only a narrow white sidebar, sparse header and a simple project settings form with generous whitespace; notifications are the focal point. Mobile is a flat screen crop, no photographic hardware. Each placement example shows only one active success message. No full-page colored areas or dimming. Keep all UI inside the canvas.
Copy: four specimens in order. Success copy: "项目设置已保存". Error copy: "保存失败，请稍后重试". Warning copy: "内容已更新，请检查后保存". Information copy: "正在准备开发环境". Tiny specimen labels: "成功", "错误", "警告", "信息". Labels are separate from component text unless concept specifically uses titles. Every specimen has a small close × at right, an appropriate line icon at left (check / exclamation / warning triangle / information). Use clear contemporary Chinese sans-serif, precise spelling, comfortable line height and dark legible contrast.
Context copy only: "WEB CODING", sidebar "工作台", "项目", "事项", "开发", "交付"; selected sidebar row is "项目" in pale lavender. Page title "项目设置"; field labels "项目名称", "项目描述"; action "保存". Small area labels "桌面端", "移动端". All other unnecessary UI text omitted.
Constraints: high-fidelity professional software design, restrained and suitable for developers and product teams without role switching. No neon, glassmorphism, heavy glow, gradients, 3D, photo devices, giant shadows, confetti, colored toast backgrounds, illustration, unreadable microcopy, extra dense dashboard content, or code. Do not write design specs, measurements or hex codes on the image.

## A · 顶部极简提示条

Concept A — top-center minimal bar. Header text exactly "A / 顶部极简提示条", subtitle "轻量反馈，保持专注". Four slim single-line white floating bars, approximately 470x60 in the large specimen area, 10px corner radius, delicate 1px border, almost imperceptible shadow. 20px outline status icon with no surrounding square tile, dark regular-weight body copy, muted close control, 18px horizontal padding. No separate title within the bars, no action buttons, no colored strips, no progress timers. The desktop sample shows one slim white success toast at the top center of the main content, beneath the top header with comfortable space. Mobile version is a single slim full-width card with 16px side gutters near the top below the app header; long messages wrap naturally. This is the most compact and visually quiet proposal.

## B · 右上角轻浮卡片

Concept B — top-right floating card. Header text exactly "B / 右上角轻浮卡片", subtitle "清晰层级，从容反馈". Four tidy white cards, approximately 470x94 in the large specimen area, 12px corner radius and a subtle fine border and shallow shadow. Each has a small 32px rounded icon tile with an extremely pale semantic tint, a dark medium-weight short title above muted body copy, and close × at upper right. Titles in order "保存成功", "保存失败", "需要确认", "环境准备中". Body copy uses the four exact shared specimen messages. Comfortable padding 20px, title/body gap 6px. No action button, no countdown, no thick colored accent bar. Desktop sample shows one card aligned to upper right within the main content, 24px from edge below app header. Mobile shows one full-width two-line card below header with 16px gutters. This should feel more informative and structured than a single-line toast while remaining very minimal.

## C · 右下角消息叠层

Concept C — bottom-right quiet notification stack. Header text exactly "C / 右下角消息叠层", subtitle "低干扰反馈，消息有序". Four independent specimen groups, each with a compact white foreground notification card approximately 470x72, 16px radius, very fine border, extremely subtle shadow, centered line icon within a small muted semantic ring at left, a dark single-line message and close × at right. Behind each specimen, show exactly two empty white offset card edges, recessed by 8px each with reduced width, so a sophisticated layered stack affordance is visible; rear cards have no text. The foreground card is always readable, no obscured body text and no additional number badge. Desktop example shows one readable success card over two empty recessed card edges at bottom right of content, with generous edge clearance, never covering navigation. Mobile sample places the same stack near the bottom, above its bottom navigation and safe area, full width with 16px gutters. This is a low-interruption alternative with a clearly distinct bottom placement, no history drawer, no notification-center panel, no new action buttons.
