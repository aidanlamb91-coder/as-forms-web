/**
 * Merge two receipt/statement images into one tall JPEG for expense zip export.
 * Returns null when merge is not possible (PDF, decode failure, etc.).
 */
(function (global) {
  function isRasterMime(mime, name) {
    const m = String(mime || '').toLowerCase();
    const n = String(name || '').toLowerCase();
    if (m === 'application/pdf' || n.endsWith('.pdf')) return false;
    if (m.startsWith('image/')) {
      if (m.includes('heic') || m.includes('heif')) return false;
      return true;
    }
    return /\.(jpe?g|png|webp|gif)$/i.test(n);
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image'));
      };
      img.src = url;
    });
  }

  /**
   * @param {Blob} topBlob
   * @param {Blob} bottomBlob
   * @returns {Promise<Blob|null>} JPEG blob or null
   */
  async function mergeVertical(topBlob, bottomBlob) {
    try {
      const top = await loadImageFromBlob(topBlob);
      const bottom = await loadImageFromBlob(bottomBlob);
      const width = Math.max(top.naturalWidth || top.width, bottom.naturalWidth || bottom.width);
      if (!width) return null;
      const topH = Math.round(((top.naturalHeight || top.height) * width) / (top.naturalWidth || top.width || 1));
      const botH = Math.round(((bottom.naturalHeight || bottom.height) * width) / (bottom.naturalWidth || bottom.width || 1));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = topH + botH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, canvas.height);
      ctx.drawImage(top, 0, 0, width, topH);
      ctx.drawImage(bottom, 0, topH, width, botH);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      return blob || null;
    } catch (_) {
      return null;
    }
  }

  global.AsImageMerge = { isRasterMime, mergeVertical };
})(typeof window !== 'undefined' ? window : globalThis);
