const { loadTemplate, renderTemplate } = require('./prompts/loader');

async function selectPages(convertResult, query, prdConfig, callbacks = {}) {
  const createAdapter = loadCreateAdapter();
  const adapter = createAdapter(prdConfig);
  const indexContent = getIndexContent(convertResult);
  const template = loadTemplate('select-pages');
  const prompt = renderTemplate(template, { indexContent, query });

  callbacks.onSelectStart && callbacks.onSelectStart();

  // 页面选择使用独立的 system prompt，不继承用户的 PRD 生成配置，
  // 避免用户 systemPrompt 干扰页面筛选指令。
  const stream = await adapter.generate(prompt, {
    model: prdConfig.model,
    maxTokens: 2000,
    temperature: 0.1,
    systemPrompt: '你是 JSON 数据提取器。严格按照用户指令从文档中提取信息，只输出 JSON 数组，不要输出任何解释、提问或多余文字。',
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
  const { estimateTokens } = loadTokenUtils();
  const adapter = createAdapter(prdConfig);
  const template = loadTemplate(prdConfig.customTemplate || prdConfig.template || 'prd');
  const sitemap = resolveSitemap(convertResult);
  const allPages = Array.isArray(sitemap.pages) ? sitemap.pages : [];
  const projectName = prdConfig.projectName || sitemap.projectName || '未命名项目';
  const sitemapText = renderSitemapOverview(sitemap);
  const query = prdConfig.query || '';

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

  // Concatenate all selected pages' markdown into one block
  const pageMarkdowns = [];
  for (const page of pages) {
    const pageName = getPageName(page);
    const pagePath = getPagePath(page);
    const md = await getPageMarkdown(convertResult, page);
    if (md && md.trim()) {
      pageMarkdowns.push(`\n---\n\n### 页面：${pagePath || pageName}\n\n${md.trim()}`);
    }
  }

  const allPagesMarkdown = pageMarkdowns.join('\n');
  const totalTokensEstimated = estimateTokens(allPagesMarkdown);

  callbacks.onProgress && callbacks.onProgress({
    stage: 'material-ready',
    totalPages: pages.length,
    totalTokensEstimated,
  });

  callbacks.onGenerateStart && callbacks.onGenerateStart();

  // Render template with all pages concatenated
  const prompt = renderTemplate(template, {
    projectName,
    sitemap: sitemapText,
    query: query || '请分析以上页面并生成完整 PRD',
    allPagesMarkdown,
  });

  let attempt = 0;
  let lastError = null;

  while (attempt <= (prdConfig.maxRetries || 0)) {
    try {
      const stream = await adapter.generate(prompt, {
        model: prdConfig.model,
        maxTokens: prdConfig.maxTokens,
        temperature: prdConfig.temperature,
        systemPrompt: prdConfig.systemPrompt,
      });

      const document = await collectOutput(stream, piece => {
        if (callbacks.onChunk) callbacks.onChunk('prd', piece);
      });

      callbacks.onGenerateComplete && callbacks.onGenerateComplete(document);

      return {
        document: document.trim(),
        pageOutputs: [],
        stats: {
          totalPages: allPages.length,
          selectedPages: pages.length,
          processedPages: pages.length,
          totalTokensEstimated,
          elapsedMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      lastError = error;
      attempt += 1;

      callbacks.onProgress && callbacks.onProgress({
        stage: 'retry',
        attempt,
        error: error.message,
      });

      if (attempt > (prdConfig.maxRetries || 0)) {
        break;
      }
    }
  }

  throw lastError || new Error('PRD generation failed');
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
    if (moduleExports && typeof moduleExports.estimateTokens === 'function') {
      return { estimateTokens: moduleExports.estimateTokens };
    }
  } catch (error) {
    if (!isModuleMissing(error, './token-utils')) {
      throw error;
    }
  }

  return { estimateTokens: fallbackEstimateTokens };
}

function fallbackEstimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function isModuleMissing(error, request) {
  return error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes(request);
}

module.exports = { orchestrate, selectPages };
