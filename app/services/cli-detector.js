// CLI 工具检测服务 by AI.Coding
const { execSync } = require('child_process');

/**
 * CLI 工具检测服务，负责扫描本机 PATH 中的命令 by AI.Coding
 */
class CliDetector {
  /**
   * 初始化检测服务并准备缓存容器 by AI.Coding
   */
  constructor() {
    // 缓存最近一次扫描结果，避免设置页频繁重复执行系统命令。
    this._cache = null;
  }

  /**
   * 检测系统中是否存在支持的 CLI 工具 by AI.Coding
   */
  detect() {
    if (this._cache) {
      return this._cache;
    }

    this._cache = {
      claude: this._check('claude'),
      codex: this._check('codex'),
      opencode: this._check('opencode'),
    };

    return this._cache;
  }

  /**
   * 清空缓存并重新执行一次检测 by AI.Coding
   */
  redetect() {
    this._cache = null;
    return this.detect();
  }

  /**
   * 按当前平台使用 where 或 which 检测单个命令 by AI.Coding
   */
  _check(name) {
    try {
      const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { CliDetector };
