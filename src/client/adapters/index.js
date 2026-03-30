const { RemoteAPIAdapter } = require('./remote-api');
const { LocalCLIAdapter } = require('./local-cli');
const { OllamaAdapter } = require('./ollama');

function createAdapter(config) {
  if (!config || !config.provider) {
    throw new Error('Adapter provider is required');
  }

  switch (config.provider) {
    case 'openai':
    case 'claude':
    case 'deepseek':
    case 'qwen':
      return new RemoteAPIAdapter(config);
    case 'local-cli':
      return new LocalCLIAdapter(config);
    case 'ollama':
      return new OllamaAdapter(config);
    case 'claude-cli':
      return new LocalCLIAdapter({ ...config, provider: 'local-cli', command: 'claude' });
    case 'codex-cli':
      return new LocalCLIAdapter({ ...config, provider: 'local-cli', command: 'codex' });
    case 'opencode-cli':
      return new LocalCLIAdapter({ ...config, provider: 'local-cli', command: 'opencode' });
    default:
      throw new Error(`Unknown adapter provider: ${config.provider}`);
  }
}

module.exports = { createAdapter };
