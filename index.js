#!/usr/bin/env node
/**
 * Axure-to-Markdown v3.0
 *
 * Converts Axure RP published online/local HTML prototypes into structured
 * Markdown documents for AI (ChatGPT, Claude, etc.) consumption.
 *
 * Usage:
 *   node index.js <source> [output-dir] [options]
 *
 *   Online:  node index.js https://xxx.axshare.com/XXXX
 *   Local:   node index.js ./my-prototype
 *
 * Options:
 *   --no-images        skip image extraction
 *   --no-download      keep image URLs, don't download locally
 *   --single-file      merge all pages into one file
 *   --concurrency=N    concurrent requests (default 3)
 *   --delay=N          request delay ms (default 200)
 *   --timeout=N        request timeout ms (default 15000)
 *   --min-text=N       min text length filter (default 1)
 *   -h, --help         show help
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./src/config');
const { createReader } = require('./src/readers');
const { parseSitemap, parsePage } = require('./src/parser');
const {
  generateIndexMarkdown,
  generatePageMarkdown,
  generateCombinedMarkdown,
} = require('./src/generator');
const { sanitizeFilename, deduplicateFilename, pMap, sleep } = require('./src/utils');

async function main() {
  const { config, positional } = parseArgs(process.argv);

  if (config._help || positional.length === 0) {
    printUsage();
    process.exit(0);
  }

  const source = positional[0];
  const { reader, isOnline } = createReader(source, config);

  const outputDir = positional[1]
    ? path.resolve(positional[1])
    : path.resolve(isOnline ? './axure-prd-output' : path.join(source, '..', 'axure-prd-output'));

  console.log(`\n${'='.repeat(60)}`);
  console.log('  Axure-to-Markdown v3.0');
  console.log(`${'='.repeat(60)}`);
  console.log(`  模式: ${isOnline ? '🌐 在线抓取' : '📂 本地读取'}`);
  console.log(`  来源: ${source}`);
  console.log(`  输出: ${outputDir}`);
  if (config.downloadImages) console.log(`  图片: 下载到 ${config.imageDir}/`);
  console.log(`${'='.repeat(60)}\n`);

  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Parse sitemap
  console.log('🔍 Step 1/3: 解析站点地图...');
  const sitemap = await parseSitemap(reader);
  if (sitemap.pages.length === 0) {
    console.error('❌ 未找到任何页面。请确认来源是 Axure 发布的原型。');
    process.exit(1);
  }
  console.log(`   ✅ 找到 ${sitemap.pages.length} 个页面\n`);

  for (const p of sitemap.pages) {
    console.log(`      ${p.path}`);
  }
  console.log('');

  // Step 2: Parse pages
  console.log('📄 Step 2/3: 逐页解析内容...');

  let allPages;
  if (isOnline) {
    // Online: concurrent parsing with pMap
    allPages = await pMap(
      sitemap.pages,
      async (page, i) => {
        const progress = `[${i + 1}/${sitemap.pages.length}]`;
        process.stdout.write(`   ${progress} ${page.pageName}...`);
        try {
          const pageData = await parsePage(reader, page, config, outputDir);
          printPageStats(pageData);
          return pageData;
        } catch (err) {
          console.log(` ⚠️ 失败: ${err.message}`);
          return null;
        }
      },
      { concurrency: config.concurrency }
    );
    allPages = allPages.filter(Boolean);
  } else {
    // Local: sequential (no network throttling needed)
    allPages = [];
    for (let i = 0; i < sitemap.pages.length; i++) {
      const page = sitemap.pages[i];
      const progress = `[${i + 1}/${sitemap.pages.length}]`;
      process.stdout.write(`   ${progress} ${page.pageName}...`);
      try {
        const pageData = await parsePage(reader, page, config, outputDir);
        allPages.push(pageData);
        printPageStats(pageData);
      } catch (err) {
        console.log(` ⚠️ 失败: ${err.message}`);
      }
    }
  }

  // Build filenameMap for deduplication
  const usedNames = new Set();
  const filenameMap = new Map();
  for (const page of allPages) {
    const safe = sanitizeFilename(page.pageName);
    const unique = deduplicateFilename(safe, usedNames);
    filenameMap.set(page.pageName, unique);
  }

  // Step 3: Generate Markdown
  console.log(`\n📝 Step 3/3: 生成 Markdown...`);

  if (config.singleFile) {
    const md = generateCombinedMarkdown(sitemap, allPages);
    const outPath = path.join(outputDir, 'prd-full.md');
    fs.writeFileSync(outPath, md, 'utf-8');
    console.log(`   ✅ ${outPath}`);
  } else {
    const indexMd = generateIndexMarkdown(sitemap, allPages, source, filenameMap);
    fs.writeFileSync(path.join(outputDir, 'index.md'), indexMd, 'utf-8');
    console.log('   ✅ index.md');

    for (const page of allPages) {
      const md = generatePageMarkdown(page);
      const safeName = filenameMap.get(page.pageName) || sanitizeFilename(page.pageName);
      fs.writeFileSync(path.join(outputDir, `${safeName}.md`), md, 'utf-8');
      console.log(`   ✅ ${safeName}.md`);
    }
  }

  // Stats
  const totalWidgets = allPages.reduce((s, p) => s + p.widgets.length, 0);
  const totalInteractions = allPages.reduce((s, p) => s + p.interactions.length, 0);
  const totalImages = allPages.reduce((s, p) => {
    return s + (p.images ? p.images.filter(i => i.localPath).length : 0);
  }, 0);

  console.log(`\n🎉 完成！${allPages.length} 页 / ${totalWidgets} 组件 / ${totalInteractions} 交互`);
  if (totalImages > 0) console.log(`   📷 下载了 ${totalImages} 张图片到 ${config.imageDir}/`);
  console.log(`📁 输出目录: ${outputDir}\n`);
}

function printPageStats(pageData) {
  const stats = [];
  if (pageData.widgets.length) stats.push(`${pageData.widgets.length}组件`);
  if (pageData.interactions.length) stats.push(`${pageData.interactions.length}交互`);
  if (pageData.notes.length) stats.push(`${pageData.notes.length}注释`);
  const imgCount = pageData.images ? pageData.images.filter(i => i.localPath).length : 0;
  if (imgCount > 0) stats.push(`${imgCount}张图片`);
  console.log(` ✅ ${stats.join(', ') || '(空页面)'}`);
}

function printUsage() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Axure-to-Markdown v3.0                             ║
║                                                              ║
║  用法:                                                       ║
║    node index.js <来源> [输出目录] [选项]                     ║
║                                                              ║
║  在线模式:                                                    ║
║    node index.js https://xxx.axshare.com/XXXX                ║
║                                                              ║
║  本地模式:                                                    ║
║    node index.js ./my-prototype                              ║
║                                                              ║
║  选项:                                                       ║
║    --no-images        跳过图片提取                            ║
║    --no-download      不下载图片（保留 URL 引用）             ║
║    --single-file      合并为一个文件                          ║
║    --concurrency=N    并发请求数（默认 3）                    ║
║    --delay=N          请求间隔 ms（默认 200）                 ║
║    --timeout=N        请求超时 ms（默认 15000）               ║
║    --min-text=N       最短文本长度过滤（默认 1）              ║
║    -h, --help         显示帮助                                ║
║                                                              ║
║  依赖: npm install (cheerio)                                 ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
