const fs = require('fs');
const path = require('path');
const { fetchBuffer, sanitizeFilename } = require('./utils');

// Noise image filename patterns — arrows, spacers, decorative dots, etc.
const NOISE_PATTERN = /arrow|bullet|spacer|shim|pixel|blank|transparent|line_|dot_|caret|cursor/i;

/**
 * Decide whether an image is worth including in the output.
 * Filters out Axure UI chrome, tiny icons, decorative noise, and degenerate dimensions.
 */
function shouldIncludeImage(src, w, h) {
  if (!src) return false;

  // Axure resource/plugin images
  if (src.includes('resources/') || src.includes('plugins/')) return false;
  // Small data URI icons (typically < 500 bytes)
  if (src.startsWith('data:') && src.length < 500) return false;
  // Known blank/transparent fillers
  if (src.includes('blank.gif') || src.includes('transparent')) return false;

  // Noise filename patterns
  const basename = src.split('/').pop().split('?')[0];
  if (NOISE_PATTERN.test(basename)) return false;

  // Dimension-based filters (only when dimensions are known)
  if (w > 0 && h > 0) {
    // Too small to be meaningful content
    if (w < 50 && h < 50) return false;
    // Thin strips — decorative lines/borders
    if (w < 15 || h < 15) return false;
    // Extreme aspect ratio — rulers, separators
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > 15) return false;
  }

  return true;
}

/**
 * Extract images from parsed HTML using cheerio.
 * Uses duck-typing (reader.baseUrl / reader.baseDir) to detect online/local mode.
 * When domOrderMap is provided, assigns domIndex to each image for interleaved output.
 */
function extractImages($, pageInfo, reader, widgetMeta, scriptIdMap, domOrderMap) {
  const images = [];
  const seenSrc = new Set();

  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src) return;

    // Get dimensions from attributes or inline style
    const width = parseInt($(el).attr('width') || '0', 10);
    const height = parseInt($(el).attr('height') || '0', 10);
    const style = $(el).attr('style') || '';
    const styleW = parseInt((style.match(/width:\s*(\d+)/i) || [])[1] || '0', 10);
    const styleH = parseInt((style.match(/height:\s*(\d+)/i) || [])[1] || '0', 10);
    const w = width || styleW;
    const h = height || styleH;

    // Apply inclusion filter
    if (!shouldIncludeImage(src, w, h)) return;

    // Build full URL / path
    let fullUrl = src;
    if (!src.startsWith('http') && !src.startsWith('data:')) {
      if (reader.baseUrl) {
        const pageDir = pageInfo.url.replace(/[^/]*\.html$/i, '');
        fullUrl = `${reader.baseUrl}/${pageDir}${src}`.replace(/\/\.\//g, '/');
      } else if (reader.baseDir) {
        fullUrl = path.resolve(
          reader.baseDir,
          pageInfo.url.replace(/[^/\\]*\.html$/i, ''),
          src
        );
      }
    }

    if (seenSrc.has(fullUrl)) return;
    seenSrc.add(fullUrl);

    // Find associated label from widget metadata
    const parentId = $(el).closest('div[id^="u"]').attr('id') || '';
    const commentLabel = parentId
      ? (widgetMeta[scriptIdMap[parentId] || parentId]?.label || '')
      : '';

    // Assign DOM order index for interleaved rendering
    const domIndex = domOrderMap ? (domOrderMap.get(el) ?? Infinity) : Infinity;

    images.push({
      src: fullUrl,
      originalSrc: src,
      width: w || null,
      height: h || null,
      label: commentLabel,
      domIndex,
    });
  });

  return images;
}

/**
 * Download images to local assets directory.
 * Mutates each image object in-place, setting `localPath` on success.
 * Filters out images whose file data is smaller than config.minImageFileSize
 * (Axure UI chrome: borders, backgrounds, tiny icons).
 */
async function downloadImages(images, outputDir, pageName, config) {
  if (!images.length) return;

  const pageDir = sanitizeFilename(pageName);
  const assetDir = path.join(outputDir, config.imageDir, pageDir);
  fs.mkdirSync(assetDir, { recursive: true });

  const urlToLocal = new Map(); // dedup: same URL → same local file
  const minSize = config.minImageFileSize || 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    // Dedup: already downloaded this URL
    if (urlToLocal.has(img.src)) {
      const cached = urlToLocal.get(img.src);
      if (cached === false) {
        img._tooSmall = true; // same URL was too small before
      } else {
        img.localPath = cached;
      }
      continue;
    }

    try {
      const ext = guessImageExtension(img.src);
      const labelPart = sanitizeFilename(img.label || `截图${i + 1}`);
      const filename = `img-${String(i + 1).padStart(3, '0')}-${labelPart}${ext}`;

      let buffer;
      if (img.src.startsWith('data:')) {
        const match = img.src.match(/^data:[^;]+;base64,(.+)$/);
        if (match) {
          buffer = Buffer.from(match[1], 'base64');
        }
      } else if (img.src.startsWith('http')) {
        buffer = await fetchBuffer(img.src, config.requestTimeout);
      } else {
        // Local file: read and copy
        if (fs.existsSync(img.src)) {
          buffer = fs.readFileSync(img.src);
        }
      }

      if (buffer) {
        // Skip images that are too small (Axure UI chrome)
        if (minSize > 0 && buffer.length < minSize) {
          urlToLocal.set(img.src, false);
          img._tooSmall = true;
          continue;
        }

        const localFile = path.join(assetDir, filename);
        fs.writeFileSync(localFile, buffer);
        const relativePath = `./${config.imageDir}/${pageDir}/${filename}`;
        urlToLocal.set(img.src, relativePath);
        img.localPath = relativePath;
      }
    } catch (err) {
      console.log(`      ⚠️ Image download failed: ${err.message}`);
      // keep original src as fallback — no localPath set
    }
  }

  // Remove images that were too small — filter array in-place
  let write = 0;
  for (let read = 0; read < images.length; read++) {
    if (!images[read]._tooSmall) {
      images[write++] = images[read];
    }
  }
  images.length = write;
}

function guessImageExtension(src) {
  if (src.startsWith('data:')) {
    const mimeMatch = src.match(/^data:image\/(\w+)/);
    if (mimeMatch) return `.${mimeMatch[1] === 'jpeg' ? 'jpg' : mimeMatch[1]}`;
    return '.png';
  }
  try {
    const pathname = new URL(src).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return ext;
  } catch {
    const ext = path.extname(src).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return ext;
  }
  return '.png';
}

module.exports = { extractImages, downloadImages, shouldIncludeImage };
