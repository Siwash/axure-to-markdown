const { loadTemplate, renderTemplate } = require('./prompts/loader');
const { assemblePrd } = require('./assembler');

async function selectPages(convertResult, query, prdConfig, callbacks = {}) {
  const createAdapter = loadCreateAdapter();
  const adapter = createAdapter(prdConfig);
  const indexContent = getIndexContent(convertResult);
  const template = loadTemplate('select-pages');
  const prompt = renderTemplate(template, { indexContent, query });

  callbacks.onSelectStart && callbacks.onSelectStart();

  const stream = await adapter.generate(prompt, {
    model: prdConfig.model,
    maxTokens: 2000,
    temperature: 0.1,
    systemPrompt: prdConfig.systemPrompt,
  });

  const output = await collectOutput(stream, piece => {
    if (callbacks.onChunk) callbacks.onChunk('select', piece);
  });

  callbacks.onSelectComplete && callbacks.onSelectComplete(output);

  // Extract JSON array from LLM response
  const match = output.match(/\[[\s\S]*?\]/);
  if (!match) {
    throw new Error('LLM 未返回有效的页面选择结果，原始输出:\n' + output.slice(0, 500));
  }

  try {
    const selected = JSON.parse(match[0]);
    if (!Array.isArray(selected)) {
      throw new Error('解析结果不是数组');
    }
    return selected.map(String);
  } catch (parseErr) {
    throw new Error('解析页面选择 JSON 失败: ' + parseErr.message + '\n原始: ' + match[0].slice(0, 300));
  }
}

async function orchestrate(convertResult, prdConfig, options = {}) {
  const { callbacks = {}, selectedPages = null } = options;
  const startedAt = Date.now();
  const createAdapter = loadCreateAdapter();
  const { estimateTokens, splitByHeadings } = loadTokenUtils();
  const adapter = createAdapter(prdConfig);
  const template = loadTemplate(prdConfig.customTemplate || prdConfig.template || 'prd');
  const sitemap = resolveSitemap(convertResult);
  const allPages = Array.isArray(sitemap.pages) ? sitemap.pages : [];
  const projectName = prdConfig.projectName || sitemap.projectName || '未命名项目';
  const sitemapText = renderSitemapOverview(sitemap);

  // Filter to selected pages only (if provided)
  let pages = allPages;
  if (selectedPages && selectedPages.length > 0) {
    pages = allPages.filter(p => {
      const name = getPageName(p);
      const pagePath = getPagePath(p);
      return selectedPages.some(sel =>
        sel === name ||
        sel === pagePath ||
        sel.endsWith(name) ||
        sel.endsWith('/ ' + name) ||
        sel.endsWith('/' + name) ||
        name === sel.split('/').pop().trim() ||
        name === sel.split(' / ').pop().trim()
      );
    });
  }

  const tasks = await Promise.all(pages.map(async page => {
    const pageName = getPageName(page);
    const pagePath = getPagePath(page);
    const pageMarkdown = await getPageMarkdown(convertResult, page);
    const totalTokens = estimateTokens(pageMarkdown || '');
    const chunks = totalTokens > prdConfig.maxContextTokens
      ? splitByHeadings(pageMarkdown || '', prdConfig.maxContextTokens)
      : [pageMarkdown || ''];

    return {
      page,
      pageName,
      pagePath,
      pageMarkdown,
      totalTokens,
      chunks: chunks.length > 0 ? chunks : [pageMarkdown || ''],
    };
  }));

  callbacks.onProgress && callbacks.onProgress({
    stage: 'queue-built',
    totalPages: pages.length,
    totalTokensEstimated: tasks.reduce((sum, item) => sum + item.totalTokens, 0),
  });

  // Always sequential (concurrency=1)
  const results = [];
  for (const task of tasks) {
    const result = await processPageTask(task, {
      adapter,
      template,
      projectName,
      sitemapText,
      prdConfig,
      callbacks,
    });
    results.push(result);
  }

  const pageOutputs = results.filter(Boolean);
  if (pageOutputs.length === 0) {
    throw new Error('No pages were successfully generated');
  }

  const document = assemblePrd(sitemap, pageOutputs, {
    projectName,
    language: prdConfig.language,
    template: prdConfig.template,
  });

  return {
    document,
    pageOutputs,
    stats: {
      totalPages: allPages.length,
      selectedPages: pages.length,
      processedPages: pageOutputs.length,
      totalTokensEstimated: tasks.reduce((sum, item) => sum + item.totalTokens, 0),
      elapsedMs: Date.now() - startedAt,
    },
  };
}

async function processPageTask(task, context) {
  const {
    adapter,
    template,
    projectName,
    sitemapText,
    prdConfig,
    callbacks,
  } = context;

  callbacks.onPageStart && callbacks.onPageStart(task.pageName);

  let attempt = 0;
  let lastError = null;

  while (attempt <= prdConfig.maxRetries) {
    try {
      const chunkOutputs = [];

      for (let index = 0; index < task.chunks.length; index += 1) {
        const chunk = task.chunks[index];
        const prompt = renderTemplate(template, {
          projectName,
          pageName: task.pageName,
          pagePath: task.pagePath,
          sitemap: sitemapText,
          pageMarkdown: task.chunks.length > 1
            ? `> 当前为分片 ${index + 1}/${task.chunks.length}\n\n${chunk}`
            : chunk,
        });

        const stream = await adapter.generate(prompt, {
          model: prdConfig.model,
          maxTokens: prdConfig.maxTokens,
          temperature: prdConfig.temperature,
          systemPrompt: prdConfig.systemPrompt,
        });

        const output = await collectOutput(stream, piece => {
          if (callbacks.onChunk) {
            callbacks.onChunk(task.pageName, piece);
          }
        });
        chunkOutputs.push(output.trim());
      }

      const mergedOutput = chunkOutputs.filter(Boolean).join('\n\n');
      const pageOutput = {
        pageName: task.pageName,
        path: task.pagePath,
        llmOutput: mergedOutput,
      };

      callbacks.onPageComplete && callbacks.onPageComplete(task.pageName, mergedOutput);
      callbacks.onProgress && callbacks.onProgress({
        stage: 'page-complete',
        pageName: task.pageName,
      });

      return pageOutput;
    } catch (error) {
      lastError = error;
      attempt += 1;

      callbacks.onProgress && callbacks.onProgress({
        stage: 'page-retry',
        pageName: task.pageName,
        attempt,
        error: error.message,
      });

      if (attempt > prdConfig.maxRetries) {
        break;
      }
    }
  }

  callbacks.onProgress && callbacks.onProgress({
    stage: 'page-failed',
    pageName: task.pageName,
    error: lastError ? lastError.message : 'Unknown error',
  });

  return null;
}

async function collectOutput(stream, onChunk) {
  if (stream == null) {
    return '';
  }

  if (typeof stream === 'string') {
    if (stream && onChunk) onChunk(stream);
    return stream;
  }

  if (typeof stream[Symbol.asyncIterator] === 'function') {
    let output = '';
    for await (const chunk of stream) {
      const piece = chunk == null ? '' : String(chunk);
      output += piece;
      if (piece && onChunk) onChunk(piece);
    }
    return output;
  }

  const value = String(stream);
  if (value && onChunk) onChunk(value);
  return value;
}

function getIndexContent(convertResult) {
  if (convertResult && typeof convertResult.generateIndex === 'function') {
    return convertResult.generateIndex();
  }

  const sitemap = resolveSitemap(convertResult);
  return renderSitemapOverview(sitemap);
}

function resolveSitemap(convertResult) {
  if (convertResult && convertResult.sitemap && Array.isArray(convertResult.sitemap.pages)) {
    return convertResult.sitemap;
  }

  if (convertResult && Array.isArray(convertResult.pages)) {
    return {
      projectName: convertResult.projectName || '',
      pages: convertResult.pages,
    };
  }

  return { projectName: '', pages: [] };
}

async function getPageMarkdown(convertResult, page) {
  if (convertResult && typeof convertResult.generatePage === 'function') {
    const resolved = resolveParsedPage(convertResult, page);
    return await Promise.resolve(convertResult.generatePage(resolved));
  }

  if (page && typeof page.markdown === 'string') return page.markdown;
  if (page && typeof page.content === 'string') return page.content;
  return '';
}

function resolveParsedPage(convertResult, page) {
  if (page && (Array.isArray(page.widgets) || page.textContent != null)) {
    return page;
  }

  if (Array.isArray(convertResult.pages)) {
    const match = convertResult.pages.find(p =>
      (p.pageName && p.pageName === page.pageName) ||
      (p.url && p.url === page.url)
    );
    if (match) return match;
  }

  return page;
}

function getPageName(page) {
  return page.pageName || page.name || page.title || '未命名页面';
}

function getPagePath(page) {
  return page.path || getPageName(page);
}

function renderSitemapOverview(sitemap) {
  const pages = Array.isArray(sitemap && sitemap.pages) ? sitemap.pages : [];
  if (pages.length === 0) {
    return '- 待确认';
  }

  return pages.map(page => `- ${page.path || page.pageName || '未命名页面'}`).join('\n');
}

function loadCreateAdapter() {
  try {
    const moduleExports = require('./adapters');
    if (moduleExports && typeof moduleExports.createAdapter === 'function') {
      return moduleExports.createAdapter;
    }
  } catch (error) {
    if (!isModuleMissing(error, './adapters')) {
      throw error;
    }
  }

  throw new Error('Missing dependency: src/client/adapters/index.js should export createAdapter(config)');
}

function loadTokenUtils() {
  try {
    const moduleExports = require('./token-utils');
    if (moduleExports) {
      return {
        estimateTokens: typeof moduleExports.estimateTokens === 'function'
          ? moduleExports.estimateTokens
          : fallbackEstimateTokens,
        splitByHeadings: typeof moduleExports.splitByHeadings === 'function'
          ? moduleExports.splitByHeadings
          : fallbackSplitByHeadings,
      };
    }
  } catch (error) {
    if (!isModuleMissing(error, './token-utils')) {
      throw error;
    }
  }

  return {
    estimateTokens: fallbackEstimateTokens,
    splitByHeadings: fallbackSplitByHeadings,
  };
}

function fallbackEstimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function fallbackSplitByHeadings(markdown, maxContextTokens) {
  const text = String(markdown || '');
  if (!text.trim()) return [''];

  const sections = text.split(/\n(?=##\s+)/g);
  const chunks = [];
  let current = '';

  for (const section of sections) {
    const candidate = current ? `${current}\n${section}` : section;
    if (fallbackEstimateTokens(candidate) <= maxContextTokens || !current) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = section;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [text];
}

function isModuleMissing(error, request) {
  return error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes(request);
}

module.exports = { orchestrate, selectPages };
