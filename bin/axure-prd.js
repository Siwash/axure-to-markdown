#!/usr/bin/env node
// Axure-to-PRD Client CLI

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { buildConfig } = require('../src/client/config');
const { sanitizeFilename, deduplicateFilename } = require('../src/utils');

async function main() {
  const { prdConfig, axureConfig, source } = buildConfig(process.argv);

  if (prdConfig._help || !source) {
    printUsage();
    process.exit(0);
  }

  const { convert } = loadApiModule();
  const { orchestrate, selectPages } = require('../src/client/orchestrator');

  console.log(`\n${'='.repeat(60)}`);
  console.log('  Axure-to-PRD Client v1.1');
  console.log(`${'='.repeat(60)}`);
  console.log(`  来源: ${source}`);
  console.log(`  模型: ${prdConfig.provider}/${prdConfig.model}`);
  console.log(`  输出: ${prdConfig.outputDir}`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Parse Axure prototype
  console.log('🔍 Step 1/4: 解析 Axure 原型...');
  const convertResult = await convert(source, axureConfig);
  const indexContent = convertResult.generateIndex();
  const totalPages = countPages(convertResult);
  console.log(`   ✅ ${totalPages} 个页面\n`);

  // Write index.md immediately so user can review
  const outputDir = path.resolve(prdConfig.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const indexFile = path.join(outputDir, 'index.md');
  fs.writeFileSync(indexFile, indexContent, 'utf-8');

  // Step 2: Show page list and get user query
  console.log('📋 Step 2/4: 页面目录');
  console.log('─'.repeat(50));
  console.log(indexContent);
  console.log('─'.repeat(50));
  console.log(`   📁 已保存: ${indexFile}\n`);

  let query = prdConfig.query;
  if (!query) {
    query = await askUser('💬 请描述您需要生成什么 PRD（例如"AI控件相关的需求文档"）:\n> ');
  }

  if (!query || !query.trim()) {
    console.log('❌ 未输入需求描述，退出。');
    process.exit(0);
  }

  // Step 3: LLM selects relevant pages
  console.log('\n🤖 Step 3/4: AI 筛选相关页面...');
  const selected = await selectPages(convertResult, query, prdConfig, {
    onChunk: () => process.stdout.write('.'),
  });
  console.log(` ✅\n`);

  console.log(`   选中 ${selected.length} 个页面:`);
  for (const name of selected) {
    console.log(`   • ${name}`);
  }

  // Confirm with user
  const confirm = await askUser(`\n   确认生成以上 ${selected.length} 个页面的 PRD？(Y/n) `);
  if (confirm && confirm.toLowerCase() === 'n') {
    console.log('已取消。');
    process.exit(0);
  }

  // Step 4: Generate PRD for selected pages only
  console.log('\n📝 Step 4/4: 逐页生成 PRD...');
  const result = await orchestrate(convertResult, prdConfig, {
    selectedPages: selected,
    callbacks: {
      onPageStart: name => process.stdout.write(`   [${name}]`),
      onPageComplete: () => console.log(' ✅'),
      onChunk: () => process.stdout.write('.'),
    },
  });

  // Write output files
  console.log('\n💾 写入文件...');
  const outputBaseName = prdConfig.template || 'prd';
  const outputFile = path.join(outputDir, `${outputBaseName}-output.md`);
  fs.writeFileSync(outputFile, result.document, 'utf-8');
  console.log(`   ✅ ${outputFile}`);

  const usedNames = new Set();
  for (const po of result.pageOutputs) {
    const baseName = sanitizeFilename(po.pageName || 'page');
    const uniqueName = deduplicateFilename(baseName || 'page', usedNames);
    const pageFile = path.join(outputDir, `${uniqueName}.md`);
    fs.writeFileSync(pageFile, po.llmOutput || '', 'utf-8');
    console.log(`   ✅ ${pageFile}`);
  }

  console.log(`\n🎉 完成！${result.stats.processedPages}/${result.stats.selectedPages} 页 | ${(result.stats.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`📁 输出目录: ${outputDir}\n`);
}

function askUser(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function countPages(convertResult) {
  if (convertResult && convertResult.sitemap && Array.isArray(convertResult.sitemap.pages)) {
    return convertResult.sitemap.pages.length;
  }
  if (convertResult && Array.isArray(convertResult.pages)) {
    return convertResult.pages.length;
  }
  return 0;
}

function printUsage() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Axure-to-PRD Client v1.1                       ║
╠══════════════════════════════════════════════════════════════╣
║ 用法                                                         ║
║   axure-prd <source> [options]                              ║
║                                                              ║
║ 示例                                                         ║
║   axure-prd https://xxx.axshare.com/demo                     ║
║   axure-prd ./prototype --provider openai --model gpt-4o    ║
║   axure-prd https://xxx --query "AI控件相关需求"              ║
║   axure-prd --config ./axure-prd.config.yaml                ║
║                                                              ║
║ 选项                                                         ║
║   --query=TEXT             PRD 需求描述（跳过交互）           ║
║   --provider=NAME          openai | anthropic | ollama       ║
║   --model=NAME             模型名称                          ║
║   --api-key=VALUE          API key                           ║
║   --base-url=URL           自定义 API 端点                   ║
║   --template=NAME          prd | api-design | test-cases     ║
║   --output=DIR, -o DIR     输出目录                          ║
║   --language=LOCALE        输出语言，默认 zh-CN              ║
║   --config=FILE            YAML/JSON 配置文件                ║
║   --max-tokens=N           单次 LLM 最大输出 token           ║
║   --temperature=N          生成温度                          ║
║   -h, --help               显示帮助                          ║
║                                                              ║
║ 流程                                                         ║
║   1. 解析 Axure 原型 → 生成 index.md                        ║
║   2. 显示页面目录 → 用户描述 PRD 需求                        ║
║   3. AI 筛选相关页面 → 用户确认                              ║
║   4. 逐页生成 PRD → 输出文件                                 ║
╚══════════════════════════════════════════════════════════════╝
`);
}

function loadApiModule() {
  try {
    const apiModule = require('../src/api');
    if (apiModule && typeof apiModule.convert === 'function') {
      return apiModule;
    }
  } catch (error) {
    if (!(error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('../src/api'))) {
      throw error;
    }
  }

  throw new Error('Missing dependency: src/api.js should export convert(source, options)');
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
