import { Slice } from "@tiptap/pm/model";
import { createRequestId } from "../api/request-id.js";
import { visualImageUrl } from "./visual-markdown.js";

const clipboardType = "application/x-web-coding-visual-selection";
// Only a random reference crosses the clipboard boundary. Document JSON comes
// from a live editor in this page, never from untrusted clipboard HTML or JSON.
let copied = null;

export function createVisualClipboard(getImages = () => []) {
  const owner = Symbol("visual-clipboard");
  function clear() {
    if (copied?.owner === owner) copied = null;
  }
  function copy(view, event, cut = false) {
    if (!event.clipboardData || view.state.selection.empty || (cut && !view.editable))
      return false;
    const { dom, text, slice } = view.serializeForClipboard(view.state.selection.content());
    const token = createRequestId(), images = [];
    slice.content.descendants(node => {
      if (node.type.name === "image" && visualImageUrl(node.attrs.src, getImages()))
        images.push(node.attrs.src);
    });
    event.clipboardData.clearData();
    event.clipboardData.setData("text/html", dom.innerHTML);
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData(clipboardType, token);
    copied = { owner, token, slice: slice.toJSON(), images };
    event.preventDefault();
    if (cut)
      view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"));
    return true;
  }
  function paste(view, event) {
    if (!copied || event.clipboardData?.getData(clipboardType) !== copied.token ||
        view.state.selection.$from.parent.type.spec.code ||
        copied.images.some(source => !visualImageUrl(source, getImages())))
      return false;
    const slice = Slice.fromJSON(view.state.schema, copied.slice);
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()
      .setMeta("paste", true).setMeta("uiEvent", "paste"));
    return true;
  }
  return { copy, cut: (view, event) => copy(view, event, true), paste, clear };
}
