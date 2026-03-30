const http = require('http');
const https = require('https');

class OllamaAdapter {
  constructor(config) {
    this.config = {
      host: 'http://localhost:11434',
      ...config,
    };
  }

  async *generate(prompt, options = {}) {
    const finalConfig = {
      ...this.config,
      ...options,
    };

    if (!finalConfig.model) {
      throw new Error('Model is required for Ollama adapter');
    }

    const response = await sendOllamaRequest(finalConfig.host, {
      model: finalConfig.model,
      prompt,
      system: finalConfig.systemPrompt || finalConfig.system,
      stream: true,
    }, finalConfig.timeout || 300000);

    let buffer = '';
    for await (const chunk of response) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let data;
        try {
          data = JSON.parse(line);
        } catch (error) {
          throw new Error(`Failed to parse Ollama response: ${error.message}`);
        }
        if (data.response) {
          yield data.response;
        }
        if (data.done) {
          return;
        }
      }
    }

    if (buffer.trim()) {
      let data;
      try {
        data = JSON.parse(buffer.trim());
      } catch (error) {
        throw new Error(`Failed to parse Ollama response: ${error.message}`);
      }
      if (data.response) {
        yield data.response;
      }
    }
  }
}

function sendOllamaRequest(host, bodyObject, timeout) {
  return new Promise((resolve, reject) => {
    const base = new URL(host);
    const client = base.protocol === 'https:' ? https : http;
    const body = JSON.stringify(removeUndefined(bodyObject));
    const req = client.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || undefined,
        path: '/api/generate',
        method: 'POST',
        timeout,
        headers: {
          'content-type': 'application/json',
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

module.exports = { OllamaAdapter };
