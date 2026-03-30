const { spawn } = require('child_process');

const PRESET_COMMANDS = {
  claude: ['claude', ['-m', '{model}', '-p', '{prompt}', '--output-format', 'text']],
  codex: ['codex', ['--quiet', '--full-auto', '-m', '{model}', '{prompt}']],
  opencode: ['opencode', ['exec', '{prompt}']],
};

class LocalCLIAdapter {
  constructor(config) {
    this.config = { ...config };
  }

  async *generate(prompt, options = {}) {
    const finalConfig = this.mergeConfig(options);
    const { command, args } = this.resolveCommand(prompt, finalConfig);
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
    }
  }

  mergeConfig(options) {
    return {
      ...this.config,
      ...options,
      timeout: options.timeout || this.config.timeout || 300000,
    };
  }

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

    const args = argsTemplate.map(arg => replacePlaceholders(arg, variables));
    return { command, args };
  }
}

function replacePlaceholders(template, variables) {
  return String(template).replace(/\{(prompt|model)\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing value for placeholder: {${key}}`);
    }
    return String(value);
  });
}

module.exports = { LocalCLIAdapter };
