#!/usr/bin/env node
/**
 * Standalone Axure-to-Markdown parser for skill invocation.
 *
 * Extracts structured markdown from Axure RP published HTML prototypes.
 * No LLM dependency — pure parsing only.
 *
 * Usage:
 *   node parse-axure.js <source> [output-dir] [options]
 *
 *   Online:  node parse-axure.js https://xxx.axshare.com/demo ./output
 *   Local:   node parse-axure.js ./my-prototype ./output
 *
 * Options:
 *   --single-file      Merge all pages into one prd-full.md
 *   --no-images        Skip image extraction
 *   --no-download      Keep image URLs, don't download locally
 *   --concurrency=N    Concurrent requests (default 3)
 *   --timeout=N        Request timeout ms (default 15000)
 */

const fs = require('fs');
const path = require('path');

// Resolve project root (two levels up from scripts/)
const projectRoot = path.resolve(__dirname, '..', '..', '..');

// Load project modules
const { parseArgs } = require(path.join(projectRoot, 'src', 'config'));
const { createReader } = require(path.join(projectRoot, 'src', 'readers'));
const { parseSitemap, parsePage } = require(path.join(projectRoot, 'src', 'parser'));
const {
  generateIndexMarkdown,
  generatePageMarkdown,
  generateCombinedMarkdown,
} = require(path.join(projectRoot, 'src', 'generator'));
const { sanitizeFilename, deduplicateFilename, pMap } = require(path.join(projectRoot, 'src', 'utils'));

async function main() {
  const { config, positional } = parseArgs(process.argv);

  if (config._help || positional.length === 0) {
    console.log(`
Usage: node parse-axure.js <source> [output-dir] [options]

  <source>        Axure prototype URL or local directory
  [output-dir]    Output directory (default: ./axure-parsed)

Options:
  --single-file      Merge all pages into one file
  --no-images        Skip image extraction
  --no-download      Keep image URLs, don't download
  --concurrency=N    Concurrent requests (default 3)
  --timeout=N        Request timeout ms (default 15000)
  -h, --help         Show this help
`);
    process.exit(0);
  }

  const source = positional[0];
  const { reader, isOnline } = createReader(source, config);

  const outputDir = positional[1]
    ? path.resolve(positional[1])
    : path.resolve('./axure-parsed');

  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Parse sitemap
  console.error('[parse] Parsing sitemap...');
  const sitemap = await parseSitemap(reader);
  if (sitemap.pages.length === 0) {
    console.error('[parse] ERROR: No pages found. Is this a valid Axure prototype?');
    process.exit(1);
  }
  console.error(`[parse] Found ${sitemap.pages.length} pages`);

  // Step 2: Parse each page
  console.error('[parse] Parsing pages...');
  let allPages;
  if (isOnline) {
    allPages = await pMap(
      sitemap.pages,
      async (page, i) => {
        console.error(`[parse] [${i + 1}/${sitemap.pages.length}] ${page.pageName}`);
        try {
          return await parsePage(reader, page, config, outputDir);
        } catch (err) {
          console.error(`[parse] WARN: Failed to parse ${page.pageName}: ${err.message}`);
          return null;
        }
      },
      { concurrency: config.concurrency }
    );
    allPages = allPages.filter(Boolean);
  } else {
    allPages = [];
    for (let i = 0; i < sitemap.pages.length; i++) {
      const page = sitemap.pages[i];
      console.error(`[parse] [${i + 1}/${sitemap.pages.length}] ${page.pageName}`);
      try {
        allPages.push(await parsePage(reader, page, config, outputDir));
      } catch (err) {
        console.error(`[parse] WARN: Failed to parse ${page.pageName}: ${err.message}`);
      }
    }
  }

  // Build filename map
  const usedNames = new Set();
  const filenameMap = new Map();
  for (const page of allPages) {
    const safe = sanitizeFilename(page.pageName);
    const unique = deduplicateFilename(safe, usedNames);
    filenameMap.set(page.pageName, unique);
  }

  // Step 3: Generate markdown files
  console.error('[parse] Generating markdown...');

  if (config.singleFile) {
    const md = generateCombinedMarkdown(sitemap, allPages);
    const outPath = path.join(outputDir, 'prd-full.md');
    fs.writeFileSync(outPath, md, 'utf-8');
    console.error(`[parse] Written: ${outPath}`);
  } else {
    const indexMd = generateIndexMarkdown(sitemap, allPages, source, filenameMap);
    fs.writeFileSync(path.join(outputDir, 'index.md'), indexMd, 'utf-8');

    for (const page of allPages) {
      const md = generatePageMarkdown(page);
      const safeName = filenameMap.get(page.pageName) || sanitizeFilename(page.pageName);
      fs.writeFileSync(path.join(outputDir, `${safeName}.md`), md, 'utf-8');
    }
    console.error(`[parse] Written: index.md + ${allPages.length} page files`);
  }

  // Summary to stdout (structured, for agent consumption)
  const summary = {
    source,
    outputDir,
    pageCount: allPages.length,
    totalWidgets: allPages.reduce((s, p) => s + p.widgets.length, 0),
    totalInteractions: allPages.reduce((s, p) => s + p.interactions.length, 0),
    files: config.singleFile
      ? ['prd-full.md']
      : ['index.md', ...allPages.map(p => `${filenameMap.get(p.pageName)}.md`)],
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(`[parse] FATAL: ${err.message}`);
  process.exit(1);
});
