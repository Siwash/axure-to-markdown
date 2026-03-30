function estimateTokens(text) {
  const str = String(text || '');
  let tokens = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // CJK characters: ~1.5 tokens each
    if ((code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
        (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
        (code >= 0x3000 && code <= 0x303F) ||  // CJK Symbols and Punctuation
        (code >= 0xFF00 && code <= 0xFFEF)) {  // Fullwidth Forms
      tokens += 1.5;
    } else {
      tokens += 0.25; // ASCII ~4 chars per token
    }
  }
  return Math.ceil(tokens);
}

function splitIntoSections(markdown) {
  const normalized = String(markdown || '');
  if (!normalized) return [];

  const lines = normalized.split(/\r?\n/);
  const sections = [];
  let current = [];

  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      sections.push(current.join('\n'));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections.filter(section => section.trim());
}

function splitSectionByParagraphs(section, maxTokens) {
  if (estimateTokens(section) <= maxTokens) {
    return [section];
  }

  const parts = String(section || '').split(/\n\s*\n/).filter(part => part.trim());
  if (parts.length <= 1) {
    return [section];
  }

  const heading = parts[0].startsWith('## ') ? parts[0] : '';
  const contentParts = heading ? parts.slice(1) : parts;
  const chunks = [];
  let current = heading ? [heading] : [];

  for (const part of contentParts) {
    const next = current.length > 0 ? `${current.join('\n\n')}\n\n${part}` : part;
    if (estimateTokens(next) > maxTokens && current.length > (heading ? 1 : 0)) {
      chunks.push(current.join('\n\n'));
      current = heading ? [heading, part] : [part];
      continue;
    }

    if (estimateTokens(next) > maxTokens && current.length === (heading ? 1 : 0)) {
      chunks.push(next);
      current = heading ? [heading] : [];
      continue;
    }

    if (current.length === 0) {
      current.push(part);
    } else if (current.length === 1 && heading && current[0] === heading) {
      current.push(part);
    } else {
      current.push(part);
    }
  }

  if (current.length > 0 && !(heading && current.length === 1)) {
    chunks.push(current.join('\n\n'));
  }

  return chunks.length > 0 ? chunks : [section];
}

function splitByHeadings(markdown, maxTokens) {
  const normalized = String(markdown || '');
  if (!normalized.trim()) return [];

  if (!maxTokens || maxTokens <= 0 || estimateTokens(normalized) <= maxTokens) {
    return [normalized];
  }

  const sections = splitIntoSections(normalized);
  const chunks = [];
  let current = '';

  for (const section of sections) {
    if (estimateTokens(section) > maxTokens) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitSectionByParagraphs(section, maxTokens));
      continue;
    }

    const next = current ? `${current}\n\n${section}` : section;
    if (estimateTokens(next) > maxTokens) {
      if (current) chunks.push(current);
      current = section;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = { estimateTokens, splitByHeadings };
