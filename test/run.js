const assert = require('assert');
const {
  sanitizeFilename,
  deduplicateFilename,
  encodeAnchor,
  encodeURIPath,
  pMap,
} = require('../src/utils');
const { parseArgs } = require('../src/config');
const { executeAxureJs } = require('../src/axure-vm');
const { extractNotes, extractAnnotation, describeInteractions } = require('../src/extractors');
const { flattenSitemap, extractPagesFromVarDeclarations } = require('../src/parser');
const { shouldIncludeImage } = require('../src/images');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ---- sanitizeFilename ----
console.log('\nsanitizeFilename:');

test('removes illegal characters', () => {
  assert.strictEqual(sanitizeFilename('foo<bar>baz'), 'foo_bar_baz');
});

test('collapses consecutive underscores', () => {
  assert.strictEqual(sanitizeFilename('a::b//c'), 'a_b_c');
});

test('trims leading/trailing underscores', () => {
  assert.strictEqual(sanitizeFilename('  hello  '), 'hello');
});

test('truncates to 80 chars via slice (safe for multibyte)', () => {
  const long = '测试'.repeat(50); // 100 chars (each 1 char in JS)
  const result = sanitizeFilename(long);
  assert.ok(result.length <= 80);
});

test('handles empty string', () => {
  assert.strictEqual(sanitizeFilename(''), '');
});

// ---- deduplicateFilename ----
console.log('\ndeduplicateFilename:');

test('returns name unchanged when unique', () => {
  const used = new Set();
  assert.strictEqual(deduplicateFilename('page', used), 'page');
  assert.ok(used.has('page'));
});

test('appends counter on collision', () => {
  const used = new Set(['page']);
  assert.strictEqual(deduplicateFilename('page', used), 'page_1');
});

test('increments counter for multiple collisions', () => {
  const used = new Set(['page', 'page_1']);
  assert.strictEqual(deduplicateFilename('page', used), 'page_2');
});

// ---- encodeAnchor ----
console.log('\nencodeAnchor:');

test('lowercases and replaces spaces with dashes', () => {
  assert.strictEqual(encodeAnchor('Hello World'), 'hello-world');
});

test('preserves Chinese characters', () => {
  assert.strictEqual(encodeAnchor('首页 设计'), '首页-设计');
});

test('strips special characters', () => {
  assert.strictEqual(encodeAnchor('Page (v2)!'), 'page-v2');
});

// ---- encodeURIPath ----
console.log('\nencodeURIPath:');

test('encodes path segments but preserves slashes', () => {
  assert.strictEqual(encodeURIPath('files/页面/data.js'), 'files/%E9%A1%B5%E9%9D%A2/data.js');
});

test('handles single segment', () => {
  assert.strictEqual(encodeURIPath('hello world'), 'hello%20world');
});

// ---- parseArgs ----
console.log('\nparseArgs:');

test('parses positional args', () => {
  const { positional } = parseArgs(['node', 'index.js', 'https://example.com', './output']);
  assert.deepStrictEqual(positional, ['https://example.com', './output']);
});

test('parses --no-images flag', () => {
  const { config } = parseArgs(['node', 'index.js', 'src', '--no-images']);
  assert.strictEqual(config.extractImages, false);
});

test('parses --no-download flag', () => {
  const { config } = parseArgs(['node', 'index.js', 'src', '--no-download']);
  assert.strictEqual(config.downloadImages, false);
});

test('parses --concurrency=N', () => {
  const { config } = parseArgs(['node', 'index.js', 'src', '--concurrency=5']);
  assert.strictEqual(config.concurrency, 5);
});

test('parses --single-file', () => {
  const { config } = parseArgs(['node', 'index.js', 'src', '--single-file']);
  assert.strictEqual(config.singleFile, true);
});

test('sets _help on -h', () => {
  const { config } = parseArgs(['node', 'index.js', '-h']);
  assert.strictEqual(config._help, true);
});

// ---- executeAxureJs ----
console.log('\nexecuteAxureJs:');

test('captures loadDocument callback data', () => {
  const js = '$axure.loadDocument({ sitemap: { rootNodes: [] } });';
  const result = executeAxureJs(js);
  // VM objects cross context boundaries, so use JSON round-trip for comparison
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { sitemap: { rootNodes: [] } });
});

test('captures loadCurrentPage callback data', () => {
  const js = '$axure.loadCurrentPage({ notes: "hello" });';
  const result = executeAxureJs(js);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), { notes: 'hello' });
});

test('returns null on invalid JS', () => {
  const result = executeAxureJs('throw new Error("boom")');
  assert.strictEqual(result, null);
});

test('returns null on empty input', () => {
  const result = executeAxureJs('');
  assert.strictEqual(result, null);
});

// ---- extractNotes ----
console.log('\nextractNotes:');

test('handles string notes', () => {
  const notes = extractNotes('hello');
  assert.deepStrictEqual(notes, [{ key: '备注', value: 'hello' }]);
});

test('handles array notes with name/text', () => {
  const notes = extractNotes([{ name: 'Note1', text: 'value1' }]);
  assert.deepStrictEqual(notes, [{ key: 'Note1', value: 'value1' }]);
});

test('handles object notes', () => {
  const notes = extractNotes({ key1: 'val1', key2: 'val2' });
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].key, 'key1');
});

test('returns empty for null', () => {
  assert.deepStrictEqual(extractNotes(null), []);
});

// ---- extractAnnotation ----
console.log('\nextractAnnotation:');

test('extracts fields array', () => {
  const result = extractAnnotation({ fields: [{ name: 'F1', value: 'V1' }] });
  assert.deepStrictEqual(result, [{ key: 'F1', value: 'V1' }]);
});

test('skips empty field values', () => {
  const result = extractAnnotation({ fields: [{ name: 'F1', value: '  ' }] });
  assert.deepStrictEqual(result, []);
});

test('handles plain object annotation', () => {
  const result = extractAnnotation({ note1: 'text1' });
  assert.deepStrictEqual(result, [{ key: 'note1', value: 'text1' }]);
});

test('returns empty for null', () => {
  assert.deepStrictEqual(extractAnnotation(null), []);
});

// ---- describeInteractions ----
console.log('\ndescribeInteractions:');

test('describes basic onClick interaction', () => {
  const map = {
    onClick: {
      cases: [{
        actions: [{ action: 'linkWindow', target: { pageName: 'Home' } }],
      }],
    },
  };
  const result = describeInteractions(map, 'btn');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].widget, 'btn');
  assert.strictEqual(result[0].event, '点击时');
  assert.ok(result[0].actions.includes('跳转页面'));
  assert.ok(result[0].actions.includes('Home'));
});

test('handles unknown event/action gracefully', () => {
  const map = {
    onCustom: {
      cases: [{
        actions: [{ action: 'customAction' }],
      }],
    },
  };
  const result = describeInteractions(map, 'w');
  assert.strictEqual(result[0].event, 'onCustom');
  assert.strictEqual(result[0].actions, 'customAction');
});

// ---- flattenSitemap ----
console.log('\nflattenSitemap:');

test('flattens nested tree', () => {
  const nodes = [
    {
      pageName: 'Parent',
      type: 'Wireframe',
      url: 'parent.html',
      id: '1',
      children: [
        { pageName: 'Child', type: 'Wireframe', url: 'child.html', id: '2', children: [] },
      ],
    },
  ];
  const pages = [];
  flattenSitemap(nodes, pages, '');
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].pageName, 'Parent');
  assert.strictEqual(pages[1].path, 'Parent / Child');
});

test('skips nodes without url', () => {
  const nodes = [{ pageName: 'Folder', type: 'Folder', children: [] }];
  const pages = [];
  flattenSitemap(nodes, pages, '');
  assert.strictEqual(pages.length, 0);
});

// ---- extractPagesFromVarDeclarations ----
console.log('\nextractPagesFromVarDeclarations:');

test('extracts page URLs from variable declarations', () => {
  const js = 'var G="page1.html", H="page2.html";';
  const pages = extractPagesFromVarDeclarations(js);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].url, 'page1.html');
});

test('filters out URLs with path separators', () => {
  const js = 'var A="resources/icons/icon.html", B="page.html";';
  const pages = extractPagesFromVarDeclarations(js);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].url, 'page.html');
});

// ---- shouldIncludeImage ----
console.log('\nshouldIncludeImage:');

test('accepts normal content image', () => {
  assert.strictEqual(shouldIncludeImage('images/screenshot.png', 400, 300), true);
});

test('accepts image with unknown dimensions', () => {
  assert.strictEqual(shouldIncludeImage('photo.jpg', 0, 0), true);
});

test('rejects Axure resource images', () => {
  assert.strictEqual(shouldIncludeImage('resources/icons/check.png', 24, 24), false);
});

test('rejects plugin images', () => {
  assert.strictEqual(shouldIncludeImage('plugins/sitemap/icon.png', 16, 16), false);
});

test('rejects small data URIs', () => {
  assert.strictEqual(shouldIncludeImage('data:image/png;base64,abc', 0, 0), false);
});

test('rejects blank.gif', () => {
  assert.strictEqual(shouldIncludeImage('images/blank.gif', 1, 1), false);
});

test('rejects images under 50x50', () => {
  assert.strictEqual(shouldIncludeImage('icon.png', 32, 32), false);
});

test('rejects thin horizontal strips', () => {
  assert.strictEqual(shouldIncludeImage('line.png', 800, 3), false);
});

test('rejects thin vertical strips', () => {
  assert.strictEqual(shouldIncludeImage('divider.png', 2, 600), false);
});

test('rejects extreme aspect ratio', () => {
  assert.strictEqual(shouldIncludeImage('ruler.png', 1600, 20), false);
});

test('rejects noise filename patterns', () => {
  assert.strictEqual(shouldIncludeImage('images/arrow_right.png', 100, 100), false);
  assert.strictEqual(shouldIncludeImage('images/spacer.gif', 100, 100), false);
  assert.strictEqual(shouldIncludeImage('images/bullet_dot.png', 100, 100), false);
});

test('rejects empty src', () => {
  assert.strictEqual(shouldIncludeImage('', 0, 0), false);
});

// ---- pMap ----
console.log('\npMap:');

test('maps with concurrency', async () => {
  const items = [1, 2, 3, 4];
  const results = await pMap(items, async (x) => x * 2, { concurrency: 2 });
  assert.deepStrictEqual(results, [2, 4, 6, 8]);
});

test('handles empty array', async () => {
  const results = await pMap([], async (x) => x, { concurrency: 2 });
  assert.deepStrictEqual(results, []);
});

// ---- Summary ----
async function runAsyncTests() {
  // Run async pMap tests
  console.log('\npMap (async):');
  await (async () => {
    test('respects concurrency limit', async () => {
      let running = 0;
      let maxRunning = 0;
      const results = await pMap(
        [1, 2, 3, 4, 5],
        async (x) => {
          running++;
          if (running > maxRunning) maxRunning = running;
          await new Promise(r => setTimeout(r, 10));
          running--;
          return x;
        },
        { concurrency: 2 }
      );
      assert.ok(maxRunning <= 2, `Max concurrency was ${maxRunning}, expected <=2`);
      assert.deepStrictEqual(results, [1, 2, 3, 4, 5]);
    });
  })();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  Tests: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  if (failed > 0) process.exit(1);
}

runAsyncTests();
