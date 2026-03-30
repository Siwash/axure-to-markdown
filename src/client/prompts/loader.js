const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = __dirname;

function loadTemplate(templateName) {
  if (!templateName || typeof templateName !== 'string') {
    throw new Error('Template name is required');
  }

  const isFilePath = path.isAbsolute(templateName) || /[\\/]/.test(templateName);
  const filePath = isFilePath
    ? path.resolve(templateName)
    : path.join(PROMPTS_DIR, `${templateName}.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

function renderTemplate(template, variables) {
  if (typeof template !== 'string') {
    throw new Error('Template must be a string');
  }

  const context = variables && typeof variables === 'object' ? variables : {};
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(context, key) || context[key] == null) {
      return match;
    }

    const value = context[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  });
}

module.exports = { loadTemplate, renderTemplate };
