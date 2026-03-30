const { encodeAnchor } = require('../utils');

let packageVersion = 'unknown';
try {
  packageVersion = require('../../package.json').version || 'unknown';
} catch {
  packageVersion = 'unknown';
}

const TEMPLATE_LABELS = {
  prd: 'PRD',
  'api-design': 'API 设计',
  'test-cases': '测试用例',
};

function assemblePrd(sitemap, pageOutputs, config) {
  const lines = [];
  const pages = Array.isArray(sitemap && sitemap.pages) ? sitemap.pages : [];
  const orderedOutputs = orderPageOutputs(pages, pageOutputs);
  const projectName = config && config.projectName ? config.projectName : '未命名项目';
  const templateName = config && config.template ? config.template : 'prd';
  const templateLabel = TEMPLATE_LABELS[templateName] || templateName;

  lines.push(`# ${projectName} - ${templateLabel}文档`);
  lines.push('');
  lines.push('## 目录');
  lines.push('');
  lines.push(...renderToc(pages, orderedOutputs));
  lines.push('');

  for (const item of orderedOutputs) {
    lines.push('---');
    lines.push('');
    lines.push(`<a id="${item.anchor}"></a>`);
    lines.push('');
    lines.push(normalizeOutput(item.pageName, item.llmOutput));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 生成信息');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toLocaleString(config && config.language ? config.language : 'zh-CN')}`);
  lines.push(`- 工具版本：axure-to-markdown v${packageVersion}`);
  lines.push(`- 页面数：${orderedOutputs.length}/${pages.length || orderedOutputs.length}`);
  lines.push(`- 模板：${templateName}`);

  return lines.join('\n');
}

function orderPageOutputs(sitemapPages, pageOutputs) {
  const items = Array.isArray(pageOutputs) ? pageOutputs.slice() : [];
  const byPath = new Map();
  const byName = new Map();

  for (const output of items) {
    if (output && output.path) byPath.set(output.path, output);
    if (output && output.pageName) byName.set(output.pageName, output);
  }

  const ordered = [];
  for (const page of sitemapPages || []) {
    const output = byPath.get(page.path) || byName.get(page.pageName);
    if (!output) continue;
    ordered.push({
      ...output,
      anchor: encodeAnchor(output.path || output.pageName),
    });
  }

  if (ordered.length > 0) {
    return ordered;
  }

  return items.map(output => ({
    ...output,
    anchor: encodeAnchor(output.path || output.pageName || 'page'),
  }));
}

function renderToc(sitemapPages, orderedOutputs) {
  if (!Array.isArray(sitemapPages) || sitemapPages.length === 0) {
    return orderedOutputs.map(item => `- [${item.pageName || item.path || '未命名页面'}](#${item.anchor})`);
  }

  const available = new Set(orderedOutputs.map(item => item.path || item.pageName));
  const lines = [];

  for (const page of sitemapPages || []) {
    const key = page.path || page.pageName;
    if (!available.has(key)) continue;

    const segments = String(key || '').split(' / ').filter(Boolean);
    const depth = Math.max(segments.length - 1, 0);
    const label = segments[segments.length - 1] || page.pageName || key;
    const anchor = encodeAnchor(key);
    lines.push(`${'  '.repeat(depth)}- [${label}](#${anchor})`);
  }

  return lines.length > 0 ? lines : ['- 待生成'];
}

function normalizeOutput(pageName, llmOutput) {
  const text = String(llmOutput || '').trim();
  if (!text) {
    return `## ${pageName || '未命名页面'}\n\n待确认`;
  }

  if (/^##\s+/m.test(text)) {
    return text;
  }

  return `## ${pageName || '未命名页面'}\n\n${text}`;
}

module.exports = { assemblePrd };
