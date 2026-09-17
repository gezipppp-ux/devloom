const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 20;

function imageExtension(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  throw new Error(
    'Image is not PNG, JPEG or WebP (it may be a login page or an unsupported format).',
  );
}
module.exports = { imageExtension, MAX_IMAGE_BYTES, MAX_IMAGES };
