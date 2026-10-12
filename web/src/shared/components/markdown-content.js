import createDOMPurify from "dompurify";
import { marked } from "marked";
import { isDraftImageUrl } from "../api/attachment-drafts.js";

const uuid = "[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}";
const projectImage = new RegExp(
  `^/api/projects/${uuid}/files/${uuid}\\?inline=1$`,
  "i",
);

export function safeRequirementLink(value, base) {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value, base || undefined);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function renderMarkdown(requirement, { sessionImages = false } = {}) {
  const sources = new Map(
    (requirement.images || []).map((image) => [image.source, image.url]),
  );
  const purifier = createDOMPurify(globalThis.window);
  const approvedImages = new WeakMap();
  purifier.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "img") return;
    const source =
      node.getAttribute("data-src") ||
      node.getAttribute("data-original") ||
      node.getAttribute("src");
    const local = sources.get(source);
    for (const attribute of [...node.attributes])
      if (!["alt", "title"].includes(attribute.name))
        node.removeAttribute(attribute.name);
    if (
      local &&
      (sessionImages
        ? /^\/api\/(?:workspaces\/[a-f\d-]{36}\/)?runs\/[a-z\d-]+\/images\/\d+$/.test(
            local,
          )
        : projectImage.test(local) || isDraftImageUrl(local))
    )
      approvedImages.set(node, local);
    else
      node.setAttribute(
        "alt",
        `${node.getAttribute("alt") || "需求图片"}（见下方图片附件）`,
      );
  });
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "IMG" && approvedImages.has(node))
      node.setAttribute("src", approvedImages.get(node));
    if (node.tagName !== "A") return;
    const href = safeRequirementLink(
      node.getAttribute("href") || "",
      requirement.sourceUrl ||
        (sessionImages ? undefined : globalThis.window.location.href),
    );
    node.removeAttribute("href");
    if (href) {
      node.setAttribute("href", href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return purifier.sanitize(
    marked.parse(requirement.markdown || requirement.description || "", {
      gfm: true,
      breaks: true,
    }),
    {
      ALLOWED_TAGS: [
        "p",
        "div",
        "span",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "del",
        "blockquote",
        "pre",
        "code",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "a",
        "img",
        "sup",
        "sub",
        "details",
        "summary",
      ],
      ALLOWED_ATTR: [
        "href",
        "src",
        "alt",
        "title",
        "colspan",
        "rowspan",
        "start",
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    },
  );
}
