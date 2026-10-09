import createDOMPurify from "dompurify";
import { Marked } from "marked";

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Replies may discuss HTML source. Display it literally, never execute it.
    html: ({ text }) => escapeHtml(text),
    // Message attachments have their own validated routes; Markdown cannot load images.
    image: ({ text }) => escapeHtml(text),
  },
});

export function renderMessage(text) {
  const purifier = createDOMPurify(globalThis.window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href");
    node.removeAttribute("href");
    try {
      const url = new URL(href);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return;
      node.setAttribute("href", url.href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } catch {
      // Unsafe or relative destinations remain readable text.
    }
  });
  return purifier.sanitize(markdown.parse(text), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
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
      "tr",
      "th",
      "td",
      "a",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "align"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
