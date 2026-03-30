const { DEFAULT_CONFIG } = require('./config');
const { createReader } = require('./readers');
const { parseSitemap, parsePage } = require('./parser');
const {
  generateIndexMarkdown,
  generatePageMarkdown,
  generateCombinedMarkdown,
} = require('./generator');
const { sanitizeFilename, deduplicateFilename, pMap } = require('./utils');

function mergeConfig(options) {
  return {
    ...DEFAULT_CONFIG,
    ...options,
  };
}

async function withSilentConsole(fn) {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    return await fn();
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}

async function parsePageSilently(reader, page, config, outputDir) {
  return withSilentConsole(() => parsePage(reader, page, config, outputDir));
}

function buildFilenameMap(pages) {
  const usedNames = new Set();
  const filenameMap = new Map();

  for (const page of pages) {
    const safeName = sanitizeFilename(page.pageName);
    const uniqueName = deduplicateFilename(safeName, usedNames);
    filenameMap.set(page.pageName, uniqueName);
  }

  return filenameMap;
}

async function convert(source, options = {}) {
  const config = mergeConfig(options);
  const outputDir = Object.prototype.hasOwnProperty.call(options, 'outputDir')
    ? options.outputDir
    : null;

  const { reader, isOnline } = createReader(source, config);
  const sitemap = await withSilentConsole(() => parseSitemap(reader));

  if (!sitemap.pages || sitemap.pages.length === 0) {
    return {
      sitemap,
      pages: [],
      filenameMap: new Map(),
      generateIndex() {
        return generateIndexMarkdown(sitemap, [], source, new Map());
      },
      generatePage(page) {
        return generatePageMarkdown(page);
      },
      generateCombined() {
        return generateCombinedMarkdown(sitemap, []);
      },
    };
  }

  let pages;
  if (isOnline) {
    const concurrency = outputDir ? 1 : config.concurrency;
    pages = await pMap(sitemap.pages, page => parsePageSilently(reader, page, config, outputDir), {
      concurrency,
    });
  } else {
    pages = [];
    for (const page of sitemap.pages) {
      pages.push(await parsePageSilently(reader, page, config, outputDir));
    }
  }

  const filenameMap = buildFilenameMap(pages);

  return {
    sitemap,
    pages,
    filenameMap,
    generateIndex() {
      return generateIndexMarkdown(sitemap, pages, source, filenameMap);
    },
    generatePage(page) {
      return generatePageMarkdown(page);
    },
    generateCombined() {
      return generateCombinedMarkdown(sitemap, pages);
    },
  };
}

module.exports = { convert };
