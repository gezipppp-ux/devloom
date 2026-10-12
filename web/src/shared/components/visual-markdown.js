import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Fragment, Slice } from "@tiptap/pm/model";
import { marked } from "marked";
import { isDraftImageUrl } from "../api/attachment-drafts.js";

export function plainTextPasteTransaction(state, text) {
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const transaction = state.tr;
  if (state.selection.$from.parent.type.spec.code)
    transaction.insertText(normalizedText);
  else {
    const marks = state.storedMarks || state.selection.$from.marks();
    const paragraphs = normalizedText
      .split("\n")
      .map((line) =>
        state.schema.nodes.paragraph.create(
          null,
          line ? state.schema.text(line, marks) : null,
        ),
      );
    transaction.replaceSelection(Slice.maxOpen(Fragment.fromArray(paragraphs)));
  }
  return transaction
    .setMeta("paste", true)
    .setMeta("uiEvent", "paste")
    .scrollIntoView();
}

const uuid = "[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}";
const projectImage = new RegExp(
  `^/api/projects/${uuid}/files/${uuid}\\?inline=1$`,
  "i",
);
export function visualImageUrl(source, images) {
  const url = images.find((image) => image.source === source)?.url;
  return typeof url === "string" &&
    (projectImage.test(url) || isDraftImageUrl(url))
    ? url
    : "";
}
function normalized(value) {
  if (Array.isArray(value))
    return value.filter((entry) => entry?.type !== "space").map(normalized);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (["raw", "loose", "links", "escaped"].includes(key)) continue;
    if (key === "text" && value.tokens) continue;
    if (key === "title" && !value[key]) continue;
    if (key === "start" && !value.ordered) continue;
    result[key] = normalized(value[key]);
  }
  return result;
}
export function hasMarkdownHtml(source) {
  let html = false;
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type === "html") html = true;
  });
  return html;
}
export function equivalentMarkdown(source, serialized) {
  if (hasMarkdownHtml(source)) return false;
  return (
    JSON.stringify(normalized(marked.lexer(source))) ===
    JSON.stringify(normalized(marked.lexer(serialized)))
  );
}
export function normalizeVisualDocument(document) {
  if (!document.content) return document;
  const content = [];
  let inlineParagraph = null;
  const blockContainer = [
    "doc",
    "blockquote",
    "listItem",
    "tableCell",
    "tableHeader",
  ].includes(document.type);
  for (const child of document.content) {
    const node = normalizeVisualDocument(child);
    if (blockContainer && ["image", "text", "hardBreak"].includes(node.type)) {
      if (!inlineParagraph) {
        inlineParagraph = { type: "paragraph", content: [] };
        content.push(inlineParagraph);
      }
      inlineParagraph.content.push(node);
    } else {
      inlineParagraph = null;
      content.push(node);
    }
  }
  return { ...document, content };
}
const escapeLabel = (value) =>
  String(value || "")
    .replace(/[\\[\]]/g, "\\$&")
    .replace(/[\r\n]/g, " ");

export function visualMarkdownExtensions({
  getImages = () => [],
  imageViews = new Set(),
} = {}) {
  const SafeImage = Image.extend({
    // Never put the source stored in the document directly into a DOM attribute.
    renderHTML({ node }) {
      const url = visualImageUrl(node.attrs.src, getImages());
      return [
        "img",
        {
          ...(url ? { src: url } : {}),
          alt: node.attrs.alt || "图片（仅安全附件可预览）",
          title: node.attrs.title || "",
        },
      ];
    },
    renderMarkdown(node) {
      const src = String(node.attrs?.src || "");
      // Pasted browser image URLs are not durable document content.
      if (/^(?:blob|data):/i.test(src))
        return escapeLabel(node.attrs?.alt || "图片");
      const title = node.attrs?.title
        ? ` "${String(node.attrs.title).replace(/["\\]/g, "\\$&")}"`
        : "";
      return `![${escapeLabel(node.attrs?.alt)}](${src}${title})`;
    },
    addNodeView() {
      return ({ node }) => {
        let current = node;
        const dom = globalThis.document.createElement("span");
        dom.className = "visual-markdown-image";
        dom.contentEditable = "false";
        const image = globalThis.document.createElement("img");
        const fallback = globalThis.document.createElement("span");
        dom.append(image, fallback);
        const refresh = () => {
          const url = visualImageUrl(current.attrs.src, getImages());
          image.alt = current.attrs.alt || "图片";
          image.title = current.attrs.title || "";
          if (url) image.setAttribute("src", url);
          else image.removeAttribute("src");
          image.hidden = !url;
          fallback.hidden = Boolean(url);
          fallback.textContent = `${current.attrs.alt || "图片"}（仅安全附件可预览）`;
        };
        imageViews.add(refresh);
        refresh();
        return {
          dom,
          update(next) {
            if (next.type !== current.type) return false;
            current = next;
            refresh();
            return true;
          },
          destroy() {
            imageViews.delete(refresh);
          },
        };
      };
    },
  }).configure({ inline: true, allowBase64: false });
  return [
    StarterKit.configure({
      underline: false,
      link: {
        openOnClick: false,
        autolink: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    SafeImage,
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
  ];
}
