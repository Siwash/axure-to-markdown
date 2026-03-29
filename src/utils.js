const https = require('https');
const http = require('http');

const MAX_REDIRECTS = 5;

/**
 * Fetch text content from URL with redirect depth limit.
 */
function fetchText(url, timeout = 15000, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}): ${url}`));
      return;
    }
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        fetchText(next, timeout, _redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.setEncoding('utf-8');
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(chunks.join('')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * Fetch binary content from URL (for image download).
 */
function fetchBuffer(url, timeout = 15000, _redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (_redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}): ${url}`));
      return;
    }
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        fetchBuffer(next, timeout, _redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/**
 * Encode URL path segments (keep / intact, encode Chinese and special chars).
 */
function encodeURIPath(p) {
  return p.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Sanitize filename for cross-platform safety.
 * Uses slice (not substring) to avoid splitting multi-byte chars.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

/**
 * Deduplicate filename against a set of already-used names.
 * Returns unique name and adds it to the set.
 */
function deduplicateFilename(name, usedNames) {
  let finalName = name;
  let counter = 1;
  while (usedNames.has(finalName)) {
    finalName = `${name}_${counter}`;
    counter++;
  }
  usedNames.add(finalName);
  return finalName;
}

function encodeAnchor(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Concurrent map with worker pool.
 * Runs fn on each item with at most `concurrency` in parallel.
 */
async function pMap(items, fn, { concurrency = 3 } = {}) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

module.exports = {
  fetchText,
  fetchBuffer,
  encodeURIPath,
  sanitizeFilename,
  deduplicateFilename,
  encodeAnchor,
  sleep,
  pMap,
  MAX_REDIRECTS,
};
