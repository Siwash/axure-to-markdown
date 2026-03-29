const cheerio = require('cheerio');
const { executeAxureJs } = require('./axure-vm');
const { extractWidgetMeta, extractNotes } = require('./extractors');
const { extractImages, downloadImages } = require('./images');

/**
 * Parse Axure sitemap from document.js.
 * Returns { projectName, pages[] }.
 */
async function parseSitemap(reader) {
  const result = { projectName: '', pages: [] };

  // Try known paths for document.js
  let documentJs = null;
  for (const p of ['data/document.js', 'document.js']) {
    try {
      documentJs = await reader.readText(p);
      break;
    } catch {
      // try next path
    }
  }

  if (!documentJs) {
    console.error('   ⚠️ 找不到 document.js');
    return result;
  }

  const data = executeAxureJs(documentJs);
  if (data && data.sitemap && data.sitemap.rootNodes) {
    flattenSitemap(data.sitemap.rootNodes, result.pages, '');
    result.projectName = data.configuration?.projectName || '';
  } else {
    // Fallback: extract page URLs from variable declarations via regex
    console.log('   ℹ️ vm 执行失败，尝试正则回退...');
    result.pages = extractPagesFromVarDeclarations(documentJs);
  }

  return result;
}

/**
 * Recursively flatten sitemap tree into a flat page list.
 */
function flattenSitemap(nodes, pages, parentPath) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node) continue;
    const name = node.pageName || '';
    const currentPath = parentPath ? `${parentPath} / ${name}` : name;

    if ((node.type === 'Wireframe' || node.url) && node.url) {
      pages.push({
        pageName: name,
        url: node.url,
        path: currentPath,
        id: node.id || '',
      });
    }
    if (node.children && node.children.length > 0) {
      flattenSitemap(node.children, pages, currentPath);
    }
  }
}

/**
 * Fallback: extract page URLs from Axure's document.js variable declarations.
 * Format: G="场景1.html", E="场景1-xxx"
 */
function extractPagesFromVarDeclarations(jsContent) {
  const pages = [];
  const htmlRegex = /=\s*"([^"]+\.html)"/g;
  const htmlUrls = [];
  for (const m of jsContent.matchAll(htmlRegex)) {
    const url = m[1];
    // Filter out resource files
    if (!url.includes('/') || url.startsWith('files/')) {
      htmlUrls.push(url);
    }
  }

  for (const url of htmlUrls) {
    const name = decodeURIComponent(url.replace('.html', '').replace(/_/g, '/'));
    pages.push({ pageName: name, url, path: name, id: '' });
  }

  return pages;
}

/**
 * Parse a single Axure page: data.js + HTML → structured page object.
 * Optionally extracts and downloads images when config.extractImages / config.downloadImages are set.
 */
async function parsePage(reader, pageInfo, config, outputDir) {
  const result = {
    pageName: pageInfo.pageName,
    path: pageInfo.path,
    url: pageInfo.url,
    notes: [],
    widgets: [],
    interactions: [],
    textContent: [],
    images: [],
  };

  // ---- 1. Parse data.js ----
  let pageData = null;
  const pageBaseName = pageInfo.url.replace(/\.html$/i, '');

  const dataJsPaths = [
    `files/${pageBaseName}/data.js`,
    `files/${encodeURIComponent(pageBaseName)}/data.js`,
    `files/${pageInfo.pageName}/data.js`,
  ];

  for (const djsPath of dataJsPaths) {
    try {
      const jsContent = await reader.readText(djsPath);
      pageData = executeAxureJs(jsContent);
      if (pageData) break;
    } catch {
      // try next path
    }
  }

  // Extract metadata from data.js
  const widgetMeta = {};
  const scriptIdMap = {}; // objectPaths: widgetId → scriptId

  if (pageData) {
    if (pageData.notes) {
      result.notes = extractNotes(pageData.notes);
    }

    if (pageData.diagram && pageData.diagram.objects) {
      extractWidgetMeta(pageData.diagram.objects, widgetMeta, result.interactions);
    }

    if (pageData.objectPaths) {
      for (const [widgetId, info] of Object.entries(pageData.objectPaths)) {
        const sid = typeof info === 'object' ? info.scriptId : info;
        if (sid) {
          scriptIdMap[sid] = widgetId;
        }
      }
    }
  }

  // ---- 2. Parse HTML ----
  let $ = null;
  let domOrderMap = null;
  try {
    const html = await reader.readText(pageInfo.url);
    $ = cheerio.load(html, { decodeEntities: false });

    // Build DOM order map for interleaved image/text output.
    // Assigns a sequential index to every top-level widget div and img element,
    // preserving the original page layout order.
    domOrderMap = new Map();
    let domIdx = 0;
    $('div[id^="u"], img').each((_, el) => {
      domOrderMap.set(el, domIdx++);
    });

    $('div[id^="u"]').each((_, el) => {
      const $el = $(el);
      const scriptId = $el.attr('id');

      // Skip sub-elements (e.g. u21_div, u21_text)
      if (scriptId && scriptId.includes('_')) return;

      // Get text
      const $textDiv = $el.find(`#${scriptId}_text`);
      let text = '';
      if ($textDiv.length > 0) {
        const paragraphs = [];
        $textDiv.find('p').each((_, p) => {
          const pText = $(p).text().trim();
          if (pText) paragraphs.push(pText);
        });
        text = paragraphs.join('\n');
      }

      // Style type from class
      const classes = ($el.attr('class') || '').split(/\s+/);
      const styleClass = classes.find(c => c.startsWith('_') && c !== '_') || '';
      const styleType = styleClass.replace(/^_/, '').replace(/_/g, ' ');

      // Label from HTML comment (format: <!-- Label (Type) -->)
      let commentLabel = '';
      const prevNode = el.previousSibling;
      if (prevNode && prevNode.type === 'comment') {
        const commentText = prevNode.data.trim();
        commentLabel = commentText.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (commentLabel === 'Unnamed') commentLabel = '';
      }

      const widgetId = scriptIdMap[scriptId] || scriptId;
      const meta = widgetMeta[widgetId] || {};
      const label = meta.label || commentLabel || '';

      if (text.length >= config.minTextLength || label || meta.notes?.length > 0) {
        result.widgets.push({
          id: scriptId,
          label,
          type: meta.styleType || meta.type || '',
          styleClass: styleType,
          text,
          notes: meta.notes || [],
          hasInteraction: meta.hasInteraction || false,
          domIndex: domOrderMap.get(el) ?? Infinity,
        });
      }
    });
  } catch {
    // HTML read failed — rely on data.js only
  }

  // ---- 2.5 Extract images ----
  if (config.extractImages && $) {
    result.images = extractImages($, pageInfo, reader, widgetMeta, scriptIdMap, domOrderMap);

    // Download images to local assets if enabled (mutates images in-place)
    if (config.downloadImages && outputDir && result.images.length > 0) {
      await downloadImages(result.images, outputDir, pageInfo.pageName, config);
    }
  }

  // ---- 3. Supplement widgets from data.js not found in HTML ----
  for (const [wid, meta] of Object.entries(widgetMeta)) {
    if (
      (meta.label || meta.notes?.length > 0) &&
      !result.widgets.find(w => w.id === wid || w.label === meta.label)
    ) {
      result.widgets.push({
        id: wid,
        label: meta.label || '',
        type: meta.styleType || meta.type || '',
        styleClass: '',
        text: '',
        notes: meta.notes || [],
        hasInteraction: meta.hasInteraction || false,
        domIndex: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  return result;
}

module.exports = { parseSitemap, flattenSitemap, extractPagesFromVarDeclarations, parsePage };
