const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('../config');

const PRD_DEFAULTS = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: null,
  baseUrl: null,
  command: null,
  args: null,
  host: null,
  maxTokens: 4096,
  temperature: 0.3,

  outputDir: './prd-output',
  template: 'prd',
  customTemplate: null,
  language: 'zh-CN',
  format: 'markdown',

  concurrency: 1,
  maxRetries: 3,
  maxContextTokens: 120000,
  query: null,
};

const PRD_KEYS = new Set([...Object.keys(PRD_DEFAULTS), '_help', 'config']);
const AXURE_KEYS = new Set([
  ...Object.keys(DEFAULT_CONFIG),
  'extractImages',
  'downloadImages',
  'extractInteractions',
  'extractAnnotations',
  'extractPageNotes',
  'extractWidgetLabels',
  'requestDelay',
  'requestTimeout',
  'minTextLength',
  'singleFile',
]);

function parsePrdArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const prdConfig = {};
  const axureConfig = {};
  const positional = [];

  function readValue(currentArg, index) {
    const eqIndex = currentArg.indexOf('=');
    if (eqIndex >= 0) {
      return { value: currentArg.slice(eqIndex + 1), nextIndex: index };
    }

    const nextArg = args[index + 1];
    if (nextArg != null && !nextArg.startsWith('-')) {
      return { value: nextArg, nextIndex: index + 1 };
    }

    return { value: '', nextIndex: index };
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      prdConfig._help = true;
      continue;
    }

    if (arg === '--no-images') {
      axureConfig.extractImages = false;
      continue;
    }

    if (arg === '--no-download') {
      axureConfig.downloadImages = false;
      continue;
    }

    if (arg === '--single-file') {
      axureConfig.singleFile = true;
      continue;
    }

    if (arg === '-o' || arg.startsWith('--output')) {
      const result = readValue(arg, i);
      prdConfig.outputDir = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--provider')) {
      const result = readValue(arg, i);
      prdConfig.provider = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--model')) {
      const result = readValue(arg, i);
      prdConfig.model = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--api-key') || arg.startsWith('--apiKey')) {
      const result = readValue(arg, i);
      prdConfig.apiKey = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--base-url')) {
      const result = readValue(arg, i);
      prdConfig.baseUrl = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--command')) {
      const result = readValue(arg, i);
      prdConfig.command = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--args')) {
      const result = readValue(arg, i);
      prdConfig.args = result.value
        ? result.value.split(',').map(item => item.trim()).filter(Boolean)
        : [];
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--host')) {
      const result = readValue(arg, i);
      prdConfig.host = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--template')) {
      const result = readValue(arg, i);
      prdConfig.template = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--custom-template')) {
      const result = readValue(arg, i);
      prdConfig.customTemplate = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--language')) {
      const result = readValue(arg, i);
      prdConfig.language = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--config')) {
      const result = readValue(arg, i);
      prdConfig.config = result.value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--concurrency')) {
      const result = readValue(arg, i);
      const value = parseInt(result.value, 10);
      if (Number.isFinite(value)) {
        prdConfig.concurrency = value;
        axureConfig.concurrency = value;
      }
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--max-tokens')) {
      const result = readValue(arg, i);
      const value = parseInt(result.value, 10);
      if (Number.isFinite(value)) prdConfig.maxTokens = value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--temperature')) {
      const result = readValue(arg, i);
      const value = parseFloat(result.value);
      if (Number.isFinite(value)) prdConfig.temperature = value;
      i = result.nextIndex;
      continue;
    }

    if (arg.startsWith('--query')) {
      const result = readValue(arg, i);
      prdConfig.query = result.value;
      i = result.nextIndex;
      continue;
    }

    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { prdConfig, axureConfig, positional };
}

function loadConfigFile(filePath) {
  if (!filePath) {
    return {};
  }

  const resolvedPath = path.resolve(filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf-8');

  try {
    const yaml = require('js-yaml');
    const parsed = yaml.load(raw) || {};
    return flattenConfig(parsed);
  } catch (error) {
    try {
      const parsed = JSON.parse(raw);
      return flattenConfig(parsed || {});
    } catch {
      throw new Error(`Failed to parse config file: ${resolvedPath}. Install js-yaml or provide valid JSON.`);
    }
  }
}

function flattenConfig(yamlConfig) {
  const sourceConfig = yamlConfig && yamlConfig.source ? yamlConfig.source : {};
  const llmConfig = yamlConfig && yamlConfig.llm ? yamlConfig.llm : {};
  const outputConfig = yamlConfig && yamlConfig.output ? yamlConfig.output : {};
  const advancedConfig = yamlConfig && yamlConfig.advanced ? yamlConfig.advanced : {};

  const flat = {};

  if (sourceConfig.url) flat.source = sourceConfig.url;
  if (sourceConfig.local) flat.source = sourceConfig.local;

  if (llmConfig.provider != null) flat.provider = llmConfig.provider;
  if (llmConfig.apiKey != null) flat.apiKey = llmConfig.apiKey;
  if (llmConfig.model != null) flat.model = llmConfig.model;
  if (llmConfig.baseUrl != null) flat.baseUrl = llmConfig.baseUrl;
  if (llmConfig.command != null) flat.command = llmConfig.command;
  if (llmConfig.args != null) flat.args = llmConfig.args;
  if (llmConfig.host != null) flat.host = llmConfig.host;
  if (llmConfig.maxTokens != null) flat.maxTokens = llmConfig.maxTokens;
  if (llmConfig.temperature != null) flat.temperature = llmConfig.temperature;

  if (outputConfig.dir != null) flat.outputDir = outputConfig.dir;
  if (outputConfig.format != null) flat.format = outputConfig.format;
  if (outputConfig.template != null) flat.template = outputConfig.template;
  if (outputConfig.customTemplate != null) flat.customTemplate = outputConfig.customTemplate;
  if (outputConfig.language != null) flat.language = outputConfig.language;

  if (advancedConfig.concurrency != null) flat.concurrency = advancedConfig.concurrency;
  if (advancedConfig.downloadImages != null) flat.downloadImages = advancedConfig.downloadImages;
  if (advancedConfig.includeInteractions != null) flat.extractInteractions = advancedConfig.includeInteractions;
  if (advancedConfig.includeAnnotations != null) flat.extractAnnotations = advancedConfig.includeAnnotations;
  if (advancedConfig.maxRetries != null) flat.maxRetries = advancedConfig.maxRetries;
  if (advancedConfig.maxContextTokens != null) flat.maxContextTokens = advancedConfig.maxContextTokens;

  return flat;
}

function resolveEnvVars(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => resolveEnvVars(item));
  }

  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] || '');
    }
    return obj;
  }

  const resolved = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      resolved[key] = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] || '');
      continue;
    }

    resolved[key] = resolveEnvVars(value);
  }

  return resolved;
}

function buildConfig(argv) {
  const { prdConfig: cliPrdConfig, axureConfig: cliAxureConfig, positional } = parsePrdArgs(argv);
  const configFilePath = cliPrdConfig.config;
  const fileConfig = configFilePath ? loadConfigFile(configFilePath) : {};

  const filePrdConfig = pickConfig(fileConfig, PRD_KEYS);
  const fileAxureConfig = pickConfig(fileConfig, AXURE_KEYS);

  const mergedPrdConfig = resolveEnvVars({
    ...PRD_DEFAULTS,
    ...filePrdConfig,
    ...cliPrdConfig,
  });

  const mergedAxureConfig = resolveEnvVars({
    ...DEFAULT_CONFIG,
    ...fileAxureConfig,
    ...cliAxureConfig,
  });

  if (!mergedPrdConfig.apiKey) {
    mergedPrdConfig.apiKey = inferApiKey(mergedPrdConfig.provider);
  }

  const source = resolveEnvVars(positional[0] != null ? positional[0] : fileConfig.source || null);

  return {
    prdConfig: mergedPrdConfig,
    axureConfig: mergedAxureConfig,
    source,
  };
}

function pickConfig(config, keys) {
  const result = {};
  for (const key of Object.keys(config || {})) {
    if (keys.has(key)) {
      result[key] = config[key];
    }
  }
  return result;
}

function inferApiKey(provider) {
  const name = String(provider || '').toLowerCase();
  if (name === 'openai') return process.env.OPENAI_API_KEY || null;
  if (name === 'anthropic' || name === 'claude') return process.env.ANTHROPIC_API_KEY || null;
  if (name === 'deepseek') return process.env.DEEPSEEK_API_KEY || null;
  return null;
}

module.exports = {
  PRD_DEFAULTS,
  parsePrdArgs,
  loadConfigFile,
  flattenConfig,
  resolveEnvVars,
  buildConfig,
};
