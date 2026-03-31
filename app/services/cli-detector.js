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
   *
   * macOS GUI 应用不继承终端 PATH（只有 /usr/bin:/bin:/usr/sbin:/sbin），
   * 需要通过 login shell 获取完整 PATH 后再检测。
   */
  _check(name) {
    try {
      if (process.platform === 'win32') {
        execSync(`where ${name}`, { stdio: 'ignore' });
        return true;
      }
      // macOS/Linux: 通过 login shell 获取完整 PATH
      const fullPath = this._getLoginShellPath();
      execSync(`which ${name}`, {
        stdio: 'ignore',
        env: { ...process.env, PATH: fullPath },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从 login shell 获取完整 PATH（macOS GUI 应用专用）by AI.Coding
   */
  _getLoginShellPath() {
    if (this._fullPath) return this._fullPath;
    try {
      const userShell = process.env.SHELL || '/bin/zsh';
      this._fullPath = execSync(`${userShell} -lc "echo \\$PATH"`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch {
      this._fullPath = process.env.PATH || '';
    }
    return this._fullPath;
  }
}

module.exports = { CliDetector };
