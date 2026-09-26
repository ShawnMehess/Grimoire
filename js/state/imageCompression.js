// imageCompression.js
//
// Client-side image compression using HTML5 Canvas.
// Resizes images to max 500px width (preserving aspect ratio)
// and exports as WebP Base64 Data URL with 0.7 quality.

/**
 * Compress an image File to a Base64 Data URL.
 * @param {File} file - The image file to compress
 * @param {Object} [options]
 * @param {number} [options.maxWidth=500] - Maximum width in pixels
 * @param {number} [options.quality=0.7] - WebP quality (0-1)
 * @returns {Promise<string>} - Base64 Data URL (e.g., "data:image/webp;base64,...")
 */
export async function compressImageToBase64(file, { maxWidth = 500, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Not an image file"));
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions preserving aspect ratio
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Export as WebP Base64
      try {
        const dataUrl = canvas.toDataURL("image/webp", quality);
        resolve(dataUrl);
      } catch (err) {
        // Fallback to JPEG if WebP not supported
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Compress a data URL image to a smaller Base64 Data URL.
 * @param {string} dataUrl - The image data URL to compress
 * @param {Object} [options]
 * @param {number} [options.maxWidth=500]
 * @param {number} [options.quality=0.7]
 * @returns {Promise<string>} - Compressed Base64 Data URL
 */
export async function compressDataUrl(dataUrl, { maxWidth = 500, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      resolve(dataUrl); // Pass through non-image data URLs
      return;
    }

    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      try {
        const compressed = canvas.toDataURL("image/webp", quality);
        resolve(compressed);
      } catch {
        const compressed = canvas.toDataURL("image/jpeg", quality);
        resolve(compressed);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image from data URL"));
    img.src = dataUrl;
  });
}