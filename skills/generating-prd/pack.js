#!/usr/bin/env node
/**
 * Pack script — builds a self-contained skill directory.
 *
 * Copies source modules from ../../src/ into scripts/lib/,
 * then runs npm install to fetch cheerio.
 *
 * Usage:
 *   node pack.js            # from skills/generating-prd/
 *   node skills/generating-prd/pack.js   # from project root
 *
 * After packing, the entire skills/generating-prd/ directory
 * can be copied to ~/.config/opencode/skills/ and works standalone.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const skillDir = __dirname;
const projectRoot = path.resolve(skillDir, '..', '..');
const srcDir = path.join(projectRoot, 'src');
const libDir = path.join(skillDir, 'scripts', 'lib');

const MODULES = [
  'config.js',
  'readers.js',
  'parser.js',
  'generator.js',
  'utils.js',
  'axure-vm.js',
  'extractors.js',
  'images.js',
];

// Verify project root
if (!fs.existsSync(srcDir)) {
  console.error(`[pack] FATAL: src/ not found at ${srcDir}`);
  console.error('  Run this script from within the axure-to-markdown project.');
  process.exit(1);
}

// Create lib directory
fs.mkdirSync(libDir, { recursive: true });

// Copy source modules
let copied = 0;
for (const mod of MODULES) {
  const src = path.join(srcDir, mod);
  const dst = path.join(libDir, mod);
  if (!fs.existsSync(src)) {
    console.error(`[pack] WARN: ${src} not found, skipping`);
    continue;
  }
  fs.copyFileSync(src, dst);
  copied++;
}
console.log(`[pack] Copied ${copied}/${MODULES.length} modules to scripts/lib/`);

// Copy prompt template
const promptSrc = path.join(projectRoot, 'prompts', 'prd-generator.md');
const promptDir = path.join(skillDir, 'prompts');
const promptDst = path.join(promptDir, 'prd-generator.md');
fs.mkdirSync(promptDir, { recursive: true });
if (fs.existsSync(promptSrc)) {
  fs.copyFileSync(promptSrc, promptDst);
  console.log('[pack] Copied prompts/prd-generator.md');
} else {
  console.error(`[pack] WARN: ${promptSrc} not found`);
}

// Install dependencies
console.log('[pack] Installing dependencies...');
try {
  execSync('npm install --production', { cwd: skillDir, stdio: 'inherit' });
} catch (err) {
  console.error(`[pack] FATAL: npm install failed: ${err.message}`);
  process.exit(1);
}

console.log('[pack] Done. Skill directory is now self-contained.');
console.log(`[pack] Copy ${skillDir} to your skills directory to use.`);
