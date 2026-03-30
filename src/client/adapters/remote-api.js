const http = require('http');
const https = require('https');

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com',
  claude: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode',
};

class RemoteAPIAdapter {
  constructor(config) {
    this.config = { ...config };
  }

  async *generate(prompt, options = {}) {
    const finalConfig = this.mergeConfig(options);
    const requestConfig = this.buildRequest(prompt, finalConfig);
    const response = await sendRequest(requestConfig, finalConfig.timeout);

    let buffer = '';
    let currentEvent = '';

    for await (const chunk of response) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          currentEvent = '';
          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          continue;
        }

        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          return;
        }

        let data;
        try {
          data = JSON.parse(payload);
        } catch (error) {
          throw new Error(`Failed to parse SSE payload: ${error.message}`);
        }

        const text = extractDeltaText(finalConfig.provider, currentEvent, data);
        if (text) {
          yield text;
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payload = buffer.trim().slice(5).trim();
      if (payload && payload !== '[DONE]') {
        let data;
        try {
          data = JSON.parse(payload);
        } catch (error) {
          throw new Error(`Failed to parse SSE payload: ${error.message}`);
        }
        const text = extractDeltaText(finalConfig.provider, currentEvent, data);
        if (text) {
          yield text;
        }
      }
    }
  }

  mergeConfig(options) {
    const provider = options.provider || this.config.provider;
    if (!provider) {
      throw new Error('Remote API provider is required');
    }

    const apiKey = options.apiKey || this.config.apiKey;
    if (!apiKey) {
      throw new Error(`API key is required for provider: ${provider}`);
    }

    const model = options.model || this.config.model;
    if (!model) {
      throw new Error(`Model is required for provider: ${provider}`);
    }

    return {
      ...this.config,
      ...options,
      provider,
      apiKey,
      model,
      baseUrl: options.baseUrl || this.config.baseUrl || DEFAULT_BASE_URLS[provider],
      maxTokens: options.maxTokens || this.config.maxTokens,
      temperature: options.temperature ?? this.config.temperature,
      systemPrompt: options.systemPrompt || this.config.systemPrompt || '',
      timeout: options.timeout || this.config.timeout || 300000,
    };
  }

  buildRequest(prompt, config) {
    if (!config.baseUrl) {
      throw new Error(`Unsupported remote API provider: ${config.provider}`);
    }

    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (config.provider === 'claude') {
      const claudePath = baseUrl.endsWith('/v1') ? '/messages' : '/v1/messages';
      return {
        url: `${baseUrl}${claudePath}`,
        body: {
          model: config.model,
          system: config.systemPrompt || undefined,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
        },
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
      };
    }

    const messages = [];
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const openaiPath = baseUrl.endsWith('/v1') ? '/chat/completions' : '/v1/chat/completions';
    return {
      url: `${baseUrl}${openaiPath}`,
      body: {
        model: config.model,
        messages,
        stream: true,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      },
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${config.apiKey}`,
      },
    };
  }
}

function extractDeltaText(provider, eventName, data) {
  if (provider === 'claude') {
    if ((eventName === 'content_block_delta' || data.type === 'content_block_delta') && data.delta) {
      return data.delta.text || '';
    }
    return '';
  }

  return data.choices && data.choices[0] && data.choices[0].delta
    ? data.choices[0].delta.content || ''
    : '';
}

function sendRequest(requestConfig, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestConfig.url);
    const client = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(removeUndefined(requestConfig.body));
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        timeout,
        headers: {
          ...requestConfig.headers,
          'content-length': Buffer.byteLength(body),
        },
      },
      res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          collectResponseBody(res)
            .then(responseBody => {
              reject(new Error(`HTTP ${res.statusCode}: ${responseBody || 'Request failed'}`));
            })
            .catch(reject);
          return;
        }

        res.on('error', error => reject(new Error(`Response stream failed: ${error.message}`)));
        resolve(res);
      }
    );

    req.on('error', error => reject(new Error(`Request failed: ${error.message}`)));
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeout}ms`));
    });
    req.write(body);
    req.end();
  });
}

async function collectResponseBody(stream) {
  let body = '';
  for await (const chunk of stream) {
    body += chunk.toString('utf-8');
  }
  return body.trim();
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = removeUndefined(item);
    }
  }
  return result;
}

module.exports = { RemoteAPIAdapter };
