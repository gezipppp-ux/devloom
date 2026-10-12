import {
  renderMarkdown,
  safeRequirementLink,
} from "../../shared/components/markdown-content.js";

export { safeRequirementLink };

export function renderRequirement(requirement) {
  return renderMarkdown(requirement, { sessionImages: true });
}
