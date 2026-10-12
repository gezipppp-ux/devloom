const imageUrls = new Set();

export function createDraftImageUrl(file) {
  const url = URL.createObjectURL(file);
  imageUrls.add(url);
  return url;
}

export function revokeDraftImageUrl(url) {
  if (!imageUrls.delete(url)) return;
  URL.revokeObjectURL(url);
}

export function isDraftImageUrl(url) {
  return imageUrls.has(url);
}
