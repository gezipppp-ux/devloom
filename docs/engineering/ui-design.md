# Web console visual system

The approved workspace rail (prototype C) is the shared shell for every page. The full-page reference set and generation prompts are in `output/imagegen/unified-pages-20260917/`. Generated images describe visual hierarchy; existing API, execution, source, and session contracts remain authoritative.

## Shared language

- Ivory canvas, sage navigation, white surfaces, forest-green primary actions. Semantic amber, red, violet and neutral colors are reserved for status or feedback.
- One 64px workspace rail and 256px project pane on desktop. Narrow screens use a horizontal workspace rail and a compact task pane. Long names truncate in navigation but remain available through titles and accessible labels.
- Shared breadcrumb, page heading, bordered form sections, 24px section padding and 8px spacing rhythm. Form pages use a centered 800px content column; conversation content uses the same alignment.
- Body text 14px, helper text 12px; fields and primary actions at least 40px high. Native fields and Ant Design search selects share colors, heights, radii and focus treatment.
- Field hints follow their control with positive spacing. Error feedback can expand the form without covering the next field. Model, reasoning and permission controls are shared between task creation and the session composer; they are not workspace settings.
- The session composer is a rounded multiline white card near the bottom of the conversation, aligned with the timeline. Permissions sit at bottom-left; model, reasoning and send controls sit at bottom-right and wrap on small screens. Saving, save errors and next-turn status remain visible without hiding the message field. Active-turn supplementary instructions keep the current settings.
- Dialogs share the same surface, typography, footer actions and SVG icon language. They remain keyboard accessible and scroll inside the viewport.

## Coverage

1. Workspace welcome, loading/error, workspace creation and editing, searchable icon picker.
2. New manual task: type, title/content/images, optional directory, model/effort/permissions.
3. New TAPD task: type, bound project, search results, ID, assignees, model/effort/permissions.
4. Project environment and TAPD settings, independently saved, including connection feedback.
5. Conversation: human progress, Codex state, message/tool timeline, composer.
6. Expanded session context, requirement body/table/attachments, original prompt.
7. Approval and clarification requests, empty, disconnected, read-only and error states.
8. Desktop, tablet, narrow mobile and long content.

## Verification

Use fixture data only. Browser regression suites verify behavior; the visual fixture captures all pages and checks viewport overflow, control containment and dialog reachability. Review the resulting screenshots against the prototype set. Generated prototypes and fixture screenshots must never contain live credentials or customer content.

Run `npm run test:visual` after building. The screenshot index is `state/browser/unified/index.html`; generated AI references are separate in `output/imagegen/unified-pages-20260917/index.html`. The fixture intercepts APIs, uses a fake Codex client, and never calls real task execution or TAPD.

The reusable personal skill is `~/.codex/skills/sage-workbench/SKILL.md`. Its design variables and reference images are bundled inside the skill. This repository owns `web/src/shared/styles/design-tokens.css`; the Ant Design provider reads those CSS variables so search selects and native controls share one theme.
