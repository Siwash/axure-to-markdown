const assert = require('assert');
const path = require('path');

const { estimateTokens, splitByHeadings } = require('../../src/client/token-utils');
const { loadTemplate, renderTemplate } = require('../../src/client/prompts/loader');
const {
  PRD_DEFAULTS,
  parsePrdArgs,
  flattenConfig,
  resolveEnvVars,
  buildConfig,
} = require('../../src/client/config');
const { createAdapter } = require('../../src/client/adapters');
const { RemoteAPIAdapter } = require('../../src/client/adapters/remote-api');
const { LocalCLIAdapter } = require('../../src/client/adapters/local-cli');
const { OllamaAdapter } = require('../../src/client/adapters/ollama');
const { assemblePrd } = require('../../src/client/assembler');
const { convert } = require('../../src/api');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

function isAsyncGeneratorFunction(fn) {
  return typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncGeneratorFunction';
}

function countOccurrences(text, fragment) {
  return String(text).split(fragment).length - 1;
}

function withEnv(patch, fn) {
  const previous = new Map();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const finalize = () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(finalize);
    }
    finalize();
    return result;
  } catch (error) {
    finalize();
    throw error;
  }
}

async function main() {
  const fixtureDir = path.resolve(__dirname, 'fixtures/mock-prototype');
  const buildConfigFixture = path.resolve(__dirname, 'fixtures/build-config.json');

  console.log('\ntoken-utils:');

  await test('estimateTokens handles empty string', async () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  await test('estimateTokens handles English text', async () => {
    assert.strictEqual(estimateTokens('abcd'), 1);
  });

  await test('estimateTokens handles Chinese text', async () => {
    assert.strictEqual(estimateTokens('你好世界'), 1);
  });

  await test('estimateTokens handles null', async () => {
    assert.strictEqual(estimateTokens(null), 0);
  });

  await test('splitByHeadings returns a single chunk when under limit', async () => {
    const markdown = '# Title\n\nShort content';
    assert.deepStrictEqual(splitByHeadings(markdown, 100), [markdown]);
  });

  await test('splitByHeadings splits large markdown by ## headings', async () => {
    const markdown = '## A\n\nAAAAAAAA\n\n## B\n\nBBBBBBBB';
    assert.deepStrictEqual(splitByHeadings(markdown, 4), ['## A\n\nAAAAAAAA\n', '## B\n\nBBBBBBBB']);
  });

  await test('splitByHeadings returns empty array for empty input', async () => {
    assert.deepStrictEqual(splitByHeadings('', 10), []);
  });

  await test('splitByHeadings splits oversized single section by paragraphs', async () => {
    const markdown = '## A\n\np1\n\np2\n\np3';
    assert.deepStrictEqual(splitByHeadings(markdown, 2), ['## A\n\np1', '## A\n\np2', '## A\n\np3']);
  });

  console.log('\nprompts/loader:');

  await test('loadTemplate prd returns a non-empty template containing pageMarkdown', async () => {
    const template = loadTemplate('prd');
    assert.ok(template.length > 0);
    assert.ok(template.includes('{{pageMarkdown}}'));
  });

  await test('loadTemplate api-design returns a non-empty template', async () => {
    const template = loadTemplate('api-design');
    assert.ok(template.length > 0);
  });

  await test('loadTemplate test-cases returns a non-empty template', async () => {
    const template = loadTemplate('test-cases');
    assert.ok(template.length > 0);
  });

  await test('loadTemplate throws for null name', async () => {
    assert.throws(() => loadTemplate(null), /Template name is required/);
  });

  await test('loadTemplate throws for nonexistent template', async () => {
    assert.throws(() => loadTemplate('nonexistent'), /Template not found/);
  });

  await test('renderTemplate replaces provided variables and preserves missing or null placeholders', async () => {
    const rendered = renderTemplate('A {{key}} B {{missing}} C {{nullable}}', {
      key: 'VALUE',
      nullable: null,
    });

    assert.strictEqual(rendered, 'A VALUE B {{missing}} C {{nullable}}');
  });

  console.log('\nconfig:');

  await test('parsePrdArgs parses provider model api-key concurrency positional args and help', async () => {
    const result = parsePrdArgs([
      'node',
      'axure-prd.js',
      '--provider',
      'openai',
      '--model=gpt-4o-mini',
      '--api-key',
      'secret-key',
      '--concurrency',
      '4',
      'prototype-dir',
      'output-dir',
      '--help',
    ]);

    assert.deepStrictEqual(result.prdConfig, {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'secret-key',
      concurrency: 4,
      _help: true,
    });
    assert.deepStrictEqual(result.axureConfig, { concurrency: 4 });
    assert.deepStrictEqual(result.positional, ['prototype-dir', 'output-dir']);
  });

  await test('flattenConfig flattens nested config structure', async () => {
    const flat = flattenConfig({
      source: { url: 'https://example.com/prototype' },
      llm: { provider: 'openai', apiKey: 'k1', model: 'm1' },
      output: { dir: './dist' },
      advanced: { concurrency: 5 },
    });

    assert.deepStrictEqual(flat, {
      source: 'https://example.com/prototype',
      provider: 'openai',
      apiKey: 'k1',
      model: 'm1',
      outputDir: './dist',
      concurrency: 5,
    });
  });

  await test('resolveEnvVars replaces env placeholders and preserves non-string values', async () => {
    await withEnv({ E2E_TOKEN: 'resolved-value', E2E_MISSING: null }, async () => {
      const resolved = resolveEnvVars({
        direct: '${E2E_TOKEN}',
        mixed: 'prefix-${E2E_MISSING}-suffix',
        nested: { value: '${E2E_TOKEN}' },
        list: ['${E2E_TOKEN}', 123],
        count: 42,
        enabled: true,
      });

      assert.deepStrictEqual(resolved, {
        direct: 'resolved-value',
        mixed: 'prefix--suffix',
        nested: { value: 'resolved-value' },
        list: ['resolved-value', 123],
        count: 42,
        enabled: true,
      });
    });
  });

  await test('buildConfig merges defaults file cli and env-derived values in order', async () => {
    await withEnv({ E2E_PRD_API_KEY: 'env-api-key' }, async () => {
      const result = buildConfig([
        'node',
        'axure-prd.js',
        '--config',
        buildConfigFixture,
        '--model',
        'cli-model',
        '--concurrency',
        '9',
        'cli-source',
      ]);

      assert.strictEqual(result.prdConfig.provider, 'openai');
      assert.strictEqual(result.prdConfig.model, 'cli-model');
      assert.strictEqual(result.prdConfig.apiKey, 'env-api-key');
      assert.strictEqual(result.prdConfig.outputDir, './file-output');
      assert.strictEqual(result.prdConfig.concurrency, 9);
      assert.strictEqual(result.prdConfig.template, PRD_DEFAULTS.template);
      assert.strictEqual(result.axureConfig.concurrency, 9);
      assert.strictEqual(result.source, 'cli-source');
    });
  });

  console.log('\nadapters/index:');

  await test('createAdapter returns RemoteAPIAdapter for openai', async () => {
    const adapter = createAdapter({ provider: 'openai', apiKey: 'test' });
    assert.ok(adapter instanceof RemoteAPIAdapter);
    assert.ok(isAsyncGeneratorFunction(adapter.generate));
  });

  await test('createAdapter returns RemoteAPIAdapter for claude', async () => {
    const adapter = createAdapter({ provider: 'claude', apiKey: 'test' });
    assert.ok(adapter instanceof RemoteAPIAdapter);
    assert.ok(isAsyncGeneratorFunction(adapter.generate));
  });

  await test('createAdapter returns RemoteAPIAdapter for deepseek', async () => {
    const adapter = createAdapter({ provider: 'deepseek', apiKey: 'test' });
    assert.ok(adapter instanceof RemoteAPIAdapter);
    assert.ok(isAsyncGeneratorFunction(adapter.generate));
  });

  await test('createAdapter returns OllamaAdapter for ollama', async () => {
    const adapter = createAdapter({ provider: 'ollama', model: 'llama3' });
    assert.ok(adapter instanceof OllamaAdapter);
    assert.ok(isAsyncGeneratorFunction(adapter.generate));
  });

  await test('createAdapter returns LocalCLIAdapter for local-cli', async () => {
    const adapter = createAdapter({ provider: 'local-cli', command: 'echo' });
    assert.ok(adapter instanceof LocalCLIAdapter);
    assert.ok(isAsyncGeneratorFunction(adapter.generate));
  });

  await test('createAdapter throws for null config', async () => {
    assert.throws(() => createAdapter(null), /Adapter provider is required/);
  });

  await test('createAdapter throws for unknown provider', async () => {
    assert.throws(() => createAdapter({ provider: 'unknown' }), /Unknown adapter provider/);
  });

  console.log('\nassembler:');

  await test('assemblePrd includes title toc footer and anchor links', async () => {
    const sitemap = {
      pages: [
        { pageName: '首页', path: '首页' },
        { pageName: '子页面', path: '首页 / 子页面' },
      ],
    };
    const pageOutputs = [
      { pageName: '子页面', path: '首页 / 子页面', llmOutput: '## 子页面\n\n子页面内容' },
      { pageName: '首页', path: '首页', llmOutput: '## 首页\n\n首页内容' },
    ];

    const document = assemblePrd(sitemap, pageOutputs, {
      projectName: '测试项目',
      template: 'prd',
      language: 'zh-CN',
    });

    assert.ok(document.includes('# 测试项目 - PRD文档'));
    assert.ok(document.includes('## 目录'));
    assert.ok(document.includes('- [首页](#首页)'));
    assert.ok(document.includes('  - [子页面](#首页--子页面)'));
    assert.ok(document.includes('<a id="首页"></a>'));
    assert.ok(document.includes('<a id="首页--子页面"></a>'));
    assert.ok(document.includes('## 生成信息'));
  });

  await test('assemblePrd orders pages by sitemap order', async () => {
    const sitemap = {
      pages: [
        { pageName: '首页', path: '首页' },
        { pageName: '子页面', path: '首页 / 子页面' },
      ],
    };
    const pageOutputs = [
      { pageName: '子页面', path: '首页 / 子页面', llmOutput: '## 子页面\n\n子页面内容' },
      { pageName: '首页', path: '首页', llmOutput: '## 首页\n\n首页内容' },
    ];

    const document = assemblePrd(sitemap, pageOutputs, { projectName: '测试项目', template: 'prd' });
    const homeIndex = document.indexOf('## 首页');
    const childIndex = document.indexOf('## 子页面');

    assert.ok(homeIndex >= 0);
    assert.ok(childIndex >= 0);
    assert.ok(homeIndex < childIndex);
  });

  await test('assemblePrd generates document skeleton for empty page outputs', async () => {
    const document = assemblePrd(
      { pages: [{ pageName: '首页', path: '首页' }] },
      [],
      { projectName: '空文档项目', template: 'prd', language: 'zh-CN' }
    );

    assert.ok(document.includes('# 空文档项目 - PRD文档'));
    assert.ok(document.includes('## 目录'));
    assert.ok(document.includes('- 待生成'));
    assert.ok(document.includes('## 生成信息'));
    assert.ok(!document.includes('## 首页'));
  });

  console.log('\napi.js integration:');

  await test('convert returns sitemap pages filenameMap and markdown generators for local fixture', async () => {
    const result = await convert(fixtureDir, { extractImages: false, downloadImages: false });

    assert.ok(result.sitemap);
    assert.ok(Array.isArray(result.pages));
    assert.ok(result.filenameMap instanceof Map);
    assert.strictEqual(typeof result.generateIndex, 'function');
    assert.strictEqual(typeof result.generatePage, 'function');
    assert.strictEqual(typeof result.generateCombined, 'function');
    assert.strictEqual(result.sitemap.pages.length, 2);
    assert.strictEqual(result.pages.length, 2);
  });

  await test('convert generateIndex returns markdown with page links', async () => {
    const result = await convert(fixtureDir, { extractImages: false, downloadImages: false });
    const markdown = result.generateIndex();

    assert.ok(markdown.includes('- [首页](./首页.md)'));
    assert.ok(markdown.includes('- [首页 / 子页面](./子页面.md)'));
  });

  await test('convert generatePage returns page markdown', async () => {
    const result = await convert(fixtureDir, { extractImages: false, downloadImages: false });
    const homePage = result.pages.find(page => page.pageName === '首页');
    const markdown = result.generatePage(homePage);

    assert.ok(markdown.includes('# 首页'));
    assert.ok(markdown.includes('## 页面说明'));
    assert.ok(markdown.includes('首页说明：这是产品的首页'));
    assert.ok(markdown.includes('欢迎使用产品'));
    assert.ok(markdown.includes('REQ-001'));
  });

  await test('convert generateCombined returns complete markdown', async () => {
    const result = await convert(fixtureDir, { extractImages: false, downloadImages: false });
    const markdown = result.generateCombined();

    assert.ok(markdown.includes('# 产品原型文档（完整版）'));
    assert.ok(markdown.includes('# 首页'));
    assert.ok(markdown.includes('# 子页面'));
    assert.ok(markdown.includes('点击跳转'));
  });

  console.log('\norchestrator:');

  await test('orchestrate returns document pageOutputs stats and invokes callbacks with mocked adapter', async () => {
    const converted = await convert(fixtureDir, { extractImages: false, downloadImages: false });
    const pagesByPath = new Map(converted.pages.map(page => [page.path, page]));
    const convertResult = {
      sitemap: converted.sitemap,
      async generatePage(page) {
        const parsedPage = pagesByPath.get(page.path) || pagesByPath.get(page.pageName);
        return converted.generatePage(parsedPage);
      },
    };
    const adaptersPath = require.resolve('../../src/client/adapters');
    const orchestratorPath = require.resolve('../../src/client/orchestrator');
    const originalAdaptersCache = require.cache[adaptersPath];
    const originalOrchestratorCache = require.cache[orchestratorPath];

    delete require.cache[orchestratorPath];
    require.cache[adaptersPath] = {
      id: adaptersPath,
      filename: adaptersPath,
      loaded: true,
      exports: {
        createAdapter: () => ({
          async *generate(prompt) {
            const match = String(prompt).match(/当前页面：(.+)/);
            const pageName = match ? match[1].trim() : '测试页面';
            yield `## ${pageName}\n\n`;
            yield '这是LLM生成的PRD内容。\n';
          },
        }),
      },
    };

    try {
      const { orchestrate } = require('../../src/client/orchestrator');
      const startedPages = [];
      const completedPages = [];
      const progressEvents = [];

      const result = await orchestrate(
        convertResult,
        {
          provider: 'openai',
          model: 'mock-model',
          template: 'prd',
          maxContextTokens: 1000,
          maxRetries: 0,
          concurrency: 2,
          language: 'zh-CN',
          projectName: 'Mock Project',
        },
        {
          onPageStart(pageName) {
            startedPages.push(pageName);
          },
          onPageComplete(pageName) {
            completedPages.push(pageName);
          },
          onProgress(event) {
            progressEvents.push(event);
          },
        }
      );

      assert.ok(result.document.includes('## 首页'));
      assert.ok(result.document.includes('## 子页面'));
      assert.ok(result.document.includes('这是LLM生成的PRD内容。'));
      assert.strictEqual(result.pageOutputs.length, 2);
      assert.strictEqual(result.stats.totalPages, 2);
      assert.strictEqual(result.stats.processedPages, 2);
      assert.ok(result.stats.totalTokensEstimated > 0);
      assert.ok(result.stats.elapsedMs >= 0);
      assert.deepStrictEqual(startedPages.slice().sort(), ['子页面', '首页']);
      assert.deepStrictEqual(completedPages.slice().sort(), ['子页面', '首页']);
      assert.ok(progressEvents.some(event => event.stage === 'queue-built'));
      assert.strictEqual(progressEvents.filter(event => event.stage === 'page-complete').length, 2);
      assert.strictEqual(countOccurrences(result.document, '这是LLM生成的PRD内容。'), 2);
    } finally {
      delete require.cache[orchestratorPath];
      if (originalOrchestratorCache) {
        require.cache[orchestratorPath] = originalOrchestratorCache;
      }

      if (originalAdaptersCache) {
        require.cache[adaptersPath] = originalAdaptersCache;
      } else {
        delete require.cache[adaptersPath];
      }
    }
  });

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  Tests: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.log(`  ❌ Unhandled error`);
  console.log(`     ${error.message}`);
  process.exit(1);
});
