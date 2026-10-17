/**
 * 1.1.0-web — Receipt photo shrink (port of Android util/ReceiptImageShrinker.kt).
 *
 * In plain English: phone photos are often 4–8 MB. Before a receipt photo is saved it is
 * resized so its longest side is at most 1600 px and saved as a JPEG at quality 80
 * (usually 200–500 KB, still easy to read). PDFs and small images (under 400 KB) are left
 * alone, and if the "shrunk" copy would somehow be bigger, the original is kept.
 */
(function (global) {
  const MAX_SIDE_PX = 1600;
  const JPEG_QUALITY = 0.8;
  const SKIP_UNDER_BYTES = 400000;

  /** New width/height keeping the shape, longest side ≤ max (never enlarges). */
  function targetSize(w, h, max) {
    max = max || MAX_SIDE_PX;
    const long = Math.max(w, h);
    if (!long || long <= max) return { w, h, scaled: false };
    const k = max / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
  }

  const isImage = (type, name) => /^image\//.test(type || '') || /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(name || '');

  /** "IMG_1234.PNG" → "IMG_1234.jpg" */
  const jpegName = (name) => String(name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';

  /**
   * Shrink one picked file. Returns { blob, name, type, shrunk } — the original when it is not
   * an image, already small, or the browser can't decode it (e.g. HEIC on Chrome).
   */
  async function shrink(blob, name) {
    const type = blob && blob.type;
    const same = { blob, name, type, shrunk: false };
    if (!blob || !isImage(type, name) || /gif/i.test(type || '')) return same;
    if (blob.size < SKIP_UNDER_BYTES) return same;
    let bmp;
    try {
      // 'from-image' turns sideways phone photos upright (EXIF orientation)
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (_) {
      return same;
    }
    try {
      const t = targetSize(bmp.width, bmp.height);
      const canvas = document.createElement('canvas');
      canvas.width = t.w;
      canvas.height = t.h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNG areas become white, not black
      ctx.fillRect(0, 0, t.w, t.h);
      ctx.drawImage(bmp, 0, 0, t.w, t.h);
      const out = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
      if (!out || out.size >= blob.size) return same;
      return { blob: out, name: jpegName(name), type: 'image/jpeg', shrunk: true };
    } finally {
      if (bmp.close) bmp.close();
    }
  }

  global.AsImageShrink = { shrink, targetSize, isImage, jpegName, MAX_SIDE_PX, JPEG_QUALITY, SKIP_UNDER_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);
