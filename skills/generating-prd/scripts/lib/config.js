const DEFAULT_CONFIG = {
  // Content extraction
  extractText: true,
  extractAnnotations: true,
  extractInteractions: true,
  extractWidgetLabels: true,
  extractPageNotes: true,
  extractImages: true,

  // Image handling
  downloadImages: true,    // download images to local assets/
  imageDir: 'assets',      // image output sub-directory
  minImageFileSize: 4096,  // skip downloaded images smaller than this (bytes)

  // Filtering
  minTextLength: 1,

  // Output
  singleFile: false,       // true = merge all pages into one file

  // Network (online mode)
  concurrency: 3,
  requestDelay: 200,       // ms between requests
  requestTimeout: 15000,   // per-request timeout ms
};

/**
 * Parse CLI arguments into config overrides + positional args.
 *
 * Usage: node index.js <source> [output-dir] [options]
 *   --no-images        skip image extraction
 *   --no-download      don't download images locally
 *   --single-file      merge all pages into one file
 *   --concurrency=N    concurrent requests (default 3)
 *   --delay=N          request delay ms (default 200)
 *   --timeout=N        request timeout ms (default 15000)
 *   --min-text=N       min text length filter (default 1)
 *   -h, --help         show help
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const config = { ...DEFAULT_CONFIG };
  const positional = [];

  for (const arg of args) {
    if (arg === '--no-images') {
      config.extractImages = false;
    } else if (arg === '--no-download') {
      config.downloadImages = false;
    } else if (arg === '--single-file') {
      config.singleFile = true;
    } else if (arg.startsWith('--concurrency=')) {
      config.concurrency = parseInt(arg.split('=')[1], 10) || 3;
    } else if (arg.startsWith('--delay=')) {
      config.requestDelay = parseInt(arg.split('=')[1], 10) || 200;
    } else if (arg.startsWith('--timeout=')) {
      config.requestTimeout = parseInt(arg.split('=')[1], 10) || 15000;
    } else if (arg.startsWith('--min-text=')) {
      config.minTextLength = parseInt(arg.split('=')[1], 10) || 1;
    } else if (arg === '--help' || arg === '-h') {
      config._help = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { config, positional };
}

module.exports = { DEFAULT_CONFIG, parseArgs };
