// 历史记录管理服务 by AI.Coding
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_KEY = 'history';

/**
 * 历史记录管理服务，负责元数据查询与输出目录生命周期 by AI.Coding
 */
class HistoryService {
  /**
   * 注入 store 与 userData 路径，便于统一管理输出目录 by AI.Coding
   */
  constructor(store, userData) {
    this.store = store;
    this.userData = userData;
  }

  /**
   * 查询历史记录，并按创建时间倒序返回 by AI.Coding
   */
  list(search) {
    const keyword = String(search || '').trim().toLowerCase();
    const records = this._getRecords();

    const filtered = keyword
      ? records.filter(record => this._matches(record, keyword))
      : records;

    return filtered.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  /**
   * 保存一条新的历史记录，并自动补齐 id、时间和输出目录 by AI.Coding
   */
  save(record) {
    const id = record && record.id ? record.id : crypto.randomUUID();
    const nextRecord = {
      ...record,
      id,
      outputDir: this.getOutputDir(id),
      createdAt: record && record.createdAt ? record.createdAt : Date.now(),
    };

    const records = [...this._getRecords(), nextRecord];
    this.store.set(STORE_KEY, records);
    return nextRecord;
  }

  /**
   * 删除指定历史记录，并同步清理输出目录 by AI.Coding
   */
  delete(id) {
    const records = this._getRecords();
    const target = records.find(record => record.id === id);
    const nextRecords = records.filter(record => record.id !== id);

    this.store.set(STORE_KEY, nextRecords);

    // 删除记录时强制递归清理输出目录，避免磁盘上残留旧产物。
    const outputDir = target && target.outputDir ? target.outputDir : this.getOutputDir(id);
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  /**
   * 根据历史记录 id 计算对应输出目录 by AI.Coding
   */
  getOutputDir(id) {
    return path.join(this.userData, 'prd-output', id);
  }

  /**
   * 从 store 中读取历史记录数组 by AI.Coding
   */
  _getRecords() {
    const records = this.store.get(STORE_KEY);
    return Array.isArray(records) ? records : [];
  }

  /**
   * 判断单条记录是否命中搜索关键字 by AI.Coding
   */
  _matches(record, keyword) {
    const query = String((record && record.query) || '').toLowerCase();
    const sourceUrl = String((record && record.sourceUrl) || '').toLowerCase();
    return query.includes(keyword) || sourceUrl.includes(keyword);
  }
}

module.exports = { HistoryService };
