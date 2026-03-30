const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PRESET_COMMANDS = {
  claude: ['claude', ['--bare', '-p', '{prompt}', '--output-format', 'text']],
  codex: ['codex', ['exec', '{prompt}', '--json', '--full-auto']],
  opencode: ['opencode', ['run', '{prompt}', '--format', 'json']],
};

const MAX_INLINE_PROMPT_BYTES = 32768;

class LocalCLIAdapter {
  constructor(config) {
    this.config = { ...config };
  }

  /**
   * 调用本地 CLI 并按行产出响应内容 by AI.Coding
   */
  async *generate(prompt, options = {}) {
    const finalConfig = this.mergeConfig(options);
    const { command, args, cleanup, useShell } = this.resolveCommand(prompt, finalConfig);
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell || process.platform === 'win32',
    });

    const stderrChunks = [];
    child.stderr.on('data', chunk => stderrChunks.push(chunk));

    let timeoutId = null;
    let timedOut = false;
    if (finalConfig.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, finalConfig.timeout);
    }

    const exitPromise = new Promise((resolve, reject) => {
      child.on('error', error => reject(new Error(`Failed to start CLI command: ${error.message}`)));
      child.on('close', code => resolve(code));
    });

    try {
      let buffer = '';
      for await (const chunk of child.stdout) {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          yield line;
        }
      }

      if (buffer) {
        yield buffer;
      }

      const exitCode = await exitPromise;
      if (timedOut) {
        throw new Error(`CLI command timed out after ${finalConfig.timeout}ms`);
      }
      if (exitCode !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        throw new Error(stderr || `CLI command exited with code ${exitCode}`);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // 生成结束后清理临时 prompt 文件，避免堆积系统临时目录。
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }
  }

  /**
   * 合并运行时配置，确保 CLI 超时策略稳定 by AI.Coding
   */
  mergeConfig(options) {
    return {
      ...this.config,
      ...options,
      timeout: options.timeout || this.config.timeout || 300000,
    };
  }

  /**
   * 根据 provider 和 prompt 长度解析最终命令 by AI.Coding
   */
  resolveCommand(prompt, config) {
    const preset = PRESET_COMMANDS[config.command];
    const command = preset ? preset[0] : config.command;
    const argsTemplate = Array.isArray(config.args)
      ? config.args
      : preset
        ? preset[1]
        : ['{prompt}'];

    if (!command) {
      throw new Error('CLI command is required for local-cli provider');
    }

    const variables = {
      prompt,
      model: config.model,
    };

    const promptBytes = Buffer.byteLength(prompt || '', 'utf-8');
    if (promptBytes > MAX_INLINE_PROMPT_BYTES) {
      return this.resolveLongPromptCommand(command, config, variables);
    }

    const args = argsTemplate
      .map(arg => replacePlaceholders(arg, variables))
      .filter(arg => arg !== null);
    return { command, args, cleanup: null, useShell: false };
  }

  /**
   * 对超长 prompt 使用临时文件输入，避免命令行长度限制 by AI.Coding
   */
  resolveLongPromptCommand(command, config, variables) {
    const tmpFile = path.join(os.tmpdir(), `axure-to-markdown-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(tmpFile, variables.prompt, 'utf-8');

    const cleanup = () => {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    };

    // 预设 CLI 在长文本下统一改走 stdin 管道，避免不同平台的参数长度问题。
    // Windows 用 type 替代 cat，确保跨平台兼容。
    const catCmd = process.platform === 'win32' ? 'type' : 'cat';
    if (config.command === 'claude') {
      return {
        command: `${catCmd} "${tmpFile}" | claude --bare --output-format text`,
        args: [],
        cleanup,
        useShell: true,
      };
    }

    if (config.command === 'codex') {
      return {
        command: `${catCmd} "${tmpFile}" | codex exec --json --full-auto`,
        args: [],
        cleanup,
        useShell: true,
      };
    }

    if (config.command === 'opencode') {
      return {
        command: `${catCmd} "${tmpFile}" | opencode run --format json`,
        args: [],
        cleanup,
        useShell: true,
      };
    }

    const preset = PRESET_COMMANDS[config.command];
    const argsTemplate = Array.isArray(config.args)
      ? config.args
      : preset
        ? preset[1]
        : ['{prompt}'];

    const nextVariables = {
      ...variables,
      prompt: tmpFile,
    };

    const args = argsTemplate
      .map(arg => replacePlaceholders(arg, nextVariables))
      .filter(arg => arg !== null);

    return { command, args, cleanup, useShell: false };
  }
}

/**
 * 替换命令模板中的占位符，并允许可选 model 参数缺省 by AI.Coding
 */
function replacePlaceholders(template, variables) {
  const rawTemplate = String(template);
  if (rawTemplate.includes('{model}')) {
    const model = variables.model;
    if (model === undefined || model === null || model === '') {
      return null;
    }
  }

  return rawTemplate.replace(/\{(prompt|model)\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing value for placeholder: {${key}}`);
    }
    return String(value);
  });
}

module.exports = { LocalCLIAdapter };
