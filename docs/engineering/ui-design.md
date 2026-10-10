# Web console visual system

The approved workspace rail (prototype C) is the shared shell for every page. The full-page reference set and generation prompts are in `output/imagegen/unified-pages-20260917/`. Generated images describe visual hierarchy; existing API, execution, source, and session contracts remain authoritative.

## Shared language

- Ivory canvas, sage navigation, white surfaces, forest-green primary actions. Semantic amber, red, violet and neutral colors are reserved for status or feedback.
- One 64px workspace rail and 240px project pane on desktop, with a 48px account bar. Narrow screens use a horizontal workspace rail and a compact task pane. Long names truncate in navigation but remain available through titles and accessible labels.
- Shared breadcrumb, page heading, bordered form sections, 24px section padding and 8px spacing rhythm. Form pages use a centered 800px content column; conversation messages and composer align to a responsive column capped at 1440px, with at least 32px side gutters on desktop.
- Session headers combine the breadcrumb and full editable title in one compact area (about 80px for a single-line title on a wide desktop). The edit icon follows the title; Codex state is a non-interactive badge aligned with the refresh button on the title row. Long titles wrap. While editing, state and refresh stay above a form capped at 1040px, with the character limit next to the field label and cancel/save beside the input. Narrow screens move the actions below the title or field. A narrow right rail opens information, Worktree Git or requirement drawers on demand. Drawers start collapsed, overlay the conversation without resizing it, and scroll independently. Clicking the active entry, the close action, outside the drawer or Escape dismisses it; keyboard dismissal restores the triggering button. Native confirmation dialogs retain their own Escape handling. Task management and lifecycle actions live in the information drawer; requirements retain their safe rendering. Drawer navigation preserves the message draft, timeline position and session identity; switching sessions starts with the drawer closed.
- Body text and conversation messages 14px, tool labels 13px, command summaries/output and session helper text 12px. Session headings are 18px; reply Markdown headings step down from 18px to 16px. Editable text uses 14px on desktop and 16px on phones to avoid input zoom. Fields and primary actions are at least 40px high. Native fields and Ant Design search selects share colors, heights, radii and focus treatment.
- Local file references open a separate conversation-side code panel. Wide desktops keep chat and code side by side with an optional wider code area; tablets overlay the conversation and phones use an inset viewport panel with unified diff. Source/diff tabs, fixed comparison labels, read timestamp and unavailable states keep current content distinct from historical messages. The information/Git/requirement drawer and code panel are mutually exclusive. Closing or Escape restores the trigger when available, without clearing drafts or changing tasks. Git's changed-file list opens the same panel.
- Field hints follow their control with positive spacing. Error feedback can expand the form without covering the next field. Model, reasoning and permission controls are shared between task creation and the session composer; they are not workspace settings.
- The session composer is a rounded multiline white card near the bottom of the conversation, aligned with the timeline. Its default two-line input keeps the card about 120px high on desktop; users can resize the text field, and attachments, feedback or wrapped controls expand naturally. Permissions sit at bottom-left; model, reasoning and send controls sit at bottom-right and wrap on small screens. Settings and keyboard hints share a wrapping row. Saving, save errors and next-turn status remain visible without hiding the message field. Active-turn supplementary instructions keep the current settings.
- Opening a conversation positions its timeline at the latest record immediately. Live updates follow the bottom only when the reader was already near it before the content grew, including a long requirement or a large streamed reply. Automatic positioning does not animate repeatedly during streaming, interrupt reading earlier records, or carry over to another selected session.
- Dialogs share the same surface, typography, footer actions and SVG icon language. They remain keyboard accessible and scroll inside the viewport.

## Coverage

1. Workspace welcome, loading/error, workspace creation and editing, searchable icon picker.
   Icon choices open in a separate keyboard-accessible modal from the compact preview. Background clone progress is available from the account bar across pages and restored from the server on reload; show stage-specific percentages, indeterminate waiting, and explicit failure/interruption states without claiming browser closure cancels a job.
2. New manual task: type, title/content/images, optional directory, model/effort/permissions.
3. New TAPD task: type, bound project, search results with local progress markers, ID, model/effort/permissions; no TAPD status code or assignees.
4. Workspace settings with independently saved project environment, TAPD connection settings and prompt templates; placeholder insertion, plain-text preview and reset/save feedback. Templates remain isolated across workspaces.
5. Conversation: human progress, Codex state, message/tool timeline, composer.
6. Expanded session context, requirement body/table/attachments, original prompt.
7. Approval and clarification requests, empty, disconnected, read-only and error states.
8. Desktop, tablet, narrow mobile and long content.
9. Member project/task base directory settings and server directory picker: editable absolute path, drive/root selection, parent/child navigation, pagination, loading/error recovery, and responsive keyboard-accessible modal. Workspace settings show automatically generated repository and task paths read-only.
10. Workspace repository page and per-task Git status: fetch and fast-forward update feedback, unpublished/unknown states, and a destructive Worktree deletion dialog with branch-name confirmation, local-content acknowledgement, stale-state recovery and read-only history. No merge/conflict controls are exposed.
11. Login, required password change, personal defaults, multiple Git accounts and administrator account management. Git forms use shared vertical labels, HTTP warnings, generated public keys and test-before-save feedback. Reuse the same form surfaces and states; keep account identity and workspace ownership distinct.

## Verification

Use fixture data only. Browser regression suites verify behavior; the visual fixture captures all pages and checks viewport overflow, control containment and dialog reachability. Review the resulting screenshots against the prototype set. Generated prototypes and fixture screenshots must never contain live credentials or customer content.

Run `node test/browser/visual.test.cjs` after building. The screenshot index is `state/browser/unified/index.html`; generated AI references are separate in `output/imagegen/unified-pages-20260917/index.html`. The fixture intercepts APIs, uses a fake Codex client, and never calls real task execution or TAPD.

The account browser fixtures in Jenkinsfile also produce login, password, personal settings and account management screenshots under `state/browser/accounts/`. Review those screenshots for account-page changes in addition to the workspace visual fixture.

The repository skill is [web-coding-ui](../../.agents/skills/web-coding-ui/SKILL.md), alongside the [engineering skill](../../.agents/skills/web-coding-engineering/SKILL.md). It preserves the approved sage-workbench style without requiring a personal skill installation. This repository owns `web/src/shared/styles/design-tokens.css`; the Ant Design provider reads those CSS variables so search selects and native controls share one theme.
