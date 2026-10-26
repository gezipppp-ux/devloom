// Keep prose and errors in their original positions. Only adjacent previews
// (separated by whitespace) belong to the same browsing group.
export function previewParts(parts) {
  const result = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.type !== "preview") { result.push(part); continue; }
    const previews = [part];
    let next = index + 1;
    while (next < parts.length) {
      let candidate = next;
      while (parts[candidate]?.type === "text" && !parts[candidate].text?.trim()) candidate++;
      if (parts[candidate]?.type !== "preview") break;
      previews.push(parts[candidate]);
      next = candidate + 1;
    }
    result.push({ type: "preview-group", id: part.id, previews });
    index = next - 1;
  }
  return result;
}
