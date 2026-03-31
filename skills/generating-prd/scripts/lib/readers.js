const fs = require('fs');
const path = require('path');
const { fetchText, encodeURIPath } = require('./utils');

class OnlineReader {
  constructor(baseUrl, config) {
    this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/start\.html$/i, '');
    this.timeout = config.requestTimeout;
  }

  async readText(relativePath) {
    const url = `${this.baseUrl}/${encodeURIPath(relativePath)}`;
    return fetchText(url, this.timeout);
  }

  async exists(relativePath) {
    try {
      await this.readText(relativePath);
      return true;
    } catch {
      return false;
    }
  }
}

class LocalReader {
  constructor(baseDir, config) {
    this.baseDir = path.resolve(baseDir);
    this.timeout = config.requestTimeout;
  }

  async readText(relativePath) {
    const fullPath = path.join(this.baseDir, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
    return fs.readFileSync(fullPath, 'utf-8');
  }

  async exists(relativePath) {
    return fs.existsSync(path.join(this.baseDir, relativePath));
  }
}

function createReader(source, config) {
  const isOnline = /^https?:\/\//i.test(source);
  const reader = isOnline
    ? new OnlineReader(source, config)
    : new LocalReader(source, config);
  return { reader, isOnline };
}

module.exports = { OnlineReader, LocalReader, createReader };
