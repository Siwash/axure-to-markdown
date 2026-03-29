const { sanitizeFilename, encodeAnchor } = require('./utils');

function generateIndexMarkdown(sitemap, pages, source, filenameMap) {
  const lines = [];
  lines.push('# 产品原型文档');
  lines.push('');
  lines.push(`> 自动提取自 Axure 原型: ${source}`);
  lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  lines.push('## 页面目录');
  lines.push('');
  for (const p of pages) {
    const safe = filenameMap
      ? filenameMap.get(p.pageName) || sanitizeFilename(p.pageName)
      : sanitizeFilename(p.pageName);
    const stats = [];
    if (p.widgets.length) stats.push(`${p.widgets.length}组件`);
    if (p.interactions.length) stats.push(`${p.interactions.length}交互`);
    if (p.notes.length) stats.push(`${p.notes.length}注释`);
    const imgCount = p.images ? p.images.length : 0;
    if (imgCount > 0) stats.push(`${imgCount}张截图`);
    lines.push(`- [${p.path || p.pageName}](./${safe}.md)${stats.length ? ' (' + stats.join(', ') + ')' : ''}`);
  }

  lines.push('');
  lines.push('## 统计');
  lines.push('');
  lines.push('| 指标 | 数量 |');
  lines.push('|------|------|');
  lines.push(`| 页面数 | ${pages.length} |`);
  lines.push(`| 组件数 | ${pages.reduce((s, p) => s + p.widgets.length, 0)} |`);
  lines.push(`| 交互数 | ${pages.reduce((s, p) => s + p.interactions.length, 0)} |`);
  lines.push(`| 含注释页面 | ${pages.filter(p => p.notes.length > 0).length} |`);

  return lines.join('\n');
}

function generatePageMarkdown(page) {
  const lines = [];

  lines.push(`# ${page.pageName}`);
  lines.push('');
  if (page.path && page.path !== page.pageName) {
    lines.push(`**路径:** ${page.path}`);
    lines.push('');
  }

  // Page notes
  if (page.notes.length > 0) {
    lines.push('## 页面说明');
    lines.push('');
    for (const n of page.notes) {
      lines.push(n.key !== '备注' ? `**${n.key}:** ${n.value}` : n.value);
    }
    lines.push('');
  }

  // Content: merge widgets (with text) and images, sorted by DOM order
  const contentWidgets = page.widgets.filter(w => w.text);
  const validImages = page.images || [];

  const merged = [
    ...contentWidgets.map(w => ({ _kind: 'widget', ...w })),
    ...validImages.map(i => ({ _kind: 'image', ...i })),
  ].sort((a, b) => (a.domIndex ?? Infinity) - (b.domIndex ?? Infinity));

  if (merged.length > 0) {
    lines.push('## 页面内容');
    lines.push('');
    for (const item of merged) {
      if (item._kind === 'widget') {
        if (item.label) {
          lines.push(`### ${item.label}${item.styleClass ? ` (${item.styleClass})` : ''}`);
          lines.push('');
        } else if (item.styleClass) {
          lines.push(`**[${item.styleClass}]**`);
          lines.push('');
        }
        const textLines = item.text.split('\n').filter(l => l.trim());
        for (const tl of textLines) {
          lines.push(tl);
          lines.push('');
        }
      } else {
        // Image item
        const label = item.label || '截图';
        const size = (item.width && item.height) ? ` (${item.width}x${item.height})` : '';
        const imgSrc = item.localPath || item.src;
        if (imgSrc.startsWith('data:') && !item.localPath) {
          lines.push(`> **${label}**${size}: [内嵌图片]`);
          lines.push('');
        } else {
          lines.push(`![${label}${size}](${imgSrc})`);
          lines.push('');
        }
      }
    }
  }

  // Label-only widgets (images, empty buttons, etc.)
  const labelOnlyWidgets = page.widgets.filter(w => !w.text && w.label);
  if (labelOnlyWidgets.length > 0) {
    lines.push('## 其他组件');
    lines.push('');
    lines.push('| 组件名 | 类型 | 样式 |');
    lines.push('|--------|------|------|');
    for (const w of labelOnlyWidgets) {
      lines.push(`| ${w.label} | ${w.type || '-'} | ${w.styleClass || '-'} |`);
    }
    lines.push('');
  }

  // Widget annotations
  const annotated = page.widgets.filter(w => w.notes?.length > 0);
  if (annotated.length > 0) {
    lines.push('## 组件注释 / 需求说明');
    lines.push('');
    for (const w of annotated) {
      lines.push(`### ${w.label || w.id}`);
      for (const n of w.notes) {
        lines.push(n.key !== '备注' ? `- **${n.key}:** ${n.value}` : `- ${n.value}`);
      }
      lines.push('');
    }
  }

  // Interactions
  if (page.interactions.length > 0) {
    lines.push('## 交互逻辑');
    lines.push('');
    lines.push('| 组件 | 触发 | 动作 | 条件 |');
    lines.push('|------|------|------|------|');
    for (const i of page.interactions) {
      lines.push(`| ${i.widget} | ${i.event} | ${i.actions} | ${i.condition || '-'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateCombinedMarkdown(sitemap, pages) {
  const lines = [];
  lines.push('# 产品原型文档（完整版）');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  lines.push('## 目录');
  lines.push('');
  for (const p of pages) {
    lines.push(`- [${p.path || p.pageName}](#${encodeAnchor(p.pageName)})`);
  }
  lines.push('');

  for (const p of pages) {
    lines.push('---');
    lines.push('');
    lines.push(generatePageMarkdown(p));
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { generateIndexMarkdown, generatePageMarkdown, generateCombinedMarkdown };
