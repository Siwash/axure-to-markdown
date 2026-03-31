const vm = require('vm');

/**
 * Safely execute Axure's IIFE-style JS using Node.js vm module.
 * Captures data from $axure.loadDocument() / $axure.loadCurrentPage() callbacks.
 *
 * Hardened sandbox: timer stubs prevent async escapes,
 * microtaskMode ensures promises settle before returning.
 */
function executeAxureJs(jsContent) {
  let capturedData = null;

  const sandbox = {
    $axure: {
      loadDocument: (data) => { capturedData = data; },
      loadCurrentPage: (data) => { capturedData = data; },
      load: (data) => { capturedData = data; },
    },
    window: {},
    document: { location: { href: '' } },
    navigator: { userAgent: '' },
    Date,
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  try {
    const context = vm.createContext(sandbox);
    vm.runInContext(jsContent, context, {
      timeout: 10000,
      microtaskMode: 'afterEvaluate',
    });
    return capturedData;
  } catch {
    // VM execution failed — Axure JS may use unsupported globals
    return null;
  }
}

module.exports = { executeAxureJs };
