---
name: generating-prd
description: >-
  Generates structured PRD documents from Axure prototypes. Runs the parse
  script to extract raw markdown from Axure HTML, then synthesizes a complete
  PRD using the built-in prompt template. Use when the user says "generate PRD",
  "create PRD from prototype", "Axure to PRD", or "help me write a PRD from
  this prototype".
---

# Generating PRD from Axure Prototype

Parse an Axure prototype into structured markdown, then generate a professional PRD document.

## Prerequisites

- Project root `node_modules/` must have `cheerio` installed (`npm install` at project root)
- All parsing modules are pre-bundled in `scripts/lib/` — no setup needed

## Keeping Modules in Sync

If source modules in `src/` are updated, run from project root:

```bash
npm run sync:skill
```

This copies the latest `src/*.js` modules into `scripts/lib/` and updates the prompt template.

## Workflow

Copy this checklist:

```
PRD Generation Progress:
- [ ] Get Axure source URL/path from user
- [ ] Run parse script to extract raw markdown
- [ ] Read parsed output files
- [ ] Read PRD prompt template
- [ ] Generate PRD document
- [ ] Write output file
```

## Step 1: Get Axure Source

Ask the user for the Axure prototype source. Supported formats:

| Type | Example |
|------|---------|
| Online URL | `https://xxx.axshare.com/demo` |
| Local directory | `D:\my-prototype` or `./my-prototype` |

Also ask for a project name (used in the PRD title). If not provided, infer from the prototype content.

## Step 2: Run Parse Script

Execute the parse script from the skill directory:

```bash
node {skill-dir}/scripts/parse-axure.js <source> <output-dir> [options]
```

**Parameters:**
- `<source>` — The Axure URL or local path from Step 1
- `<output-dir>` — Where to write parsed `.md` files (e.g., `./axure-parsed`)
- `--single-file` — (Optional) Merge all pages into one `prd-full.md`

**Modules:** All parsing modules are bundled in `{skill-dir}/scripts/lib/`. No external project dependency beyond `cheerio`.

**Output structure:**

```
<output-dir>/
  index.md          # Sitemap overview with page list and stats
  page-name-1.md    # Per-page markdown (widgets, interactions, notes)
  page-name-2.md
  ...
```

The script exits with code 0 on success. Non-zero means failure — check stderr.

## Step 3: Read Parsed Files

Read all `.md` files from the output directory:

1. Read `index.md` first — it contains the sitemap and page statistics
2. Read each per-page `.md` file listed in `index.md`

Concatenate all content. This is the raw material for PRD generation.

## Step 4: Read PRD Prompt Template

Read the prompt template at:

```
{skill-dir}/prompts/prd-generator.md
```

The template is between the triple-backtick code block under the `## Prompt` heading (lines 15–119). Extract the prompt text and replace `{{项目名称}}` with the user's project name.

## Step 5: Generate PRD

You ARE the LLM. Apply the prompt template instructions directly to the parsed markdown material:

1. **Replace** `{{项目名称}}` in the prompt with the actual project name
2. **Follow** the template's 4 processing strategies:
   - Information consolidation: reorganize by product logic, not page structure
   - Information tiering: separate facts from speculation
   - Information enrichment: add tables, ASCII diagrams, flowcharts
   - Information traceability: cite source page filenames
3. **Output** following the 8-section PRD structure from the template
4. **Respect** all 6 output requirements (Chinese, tables-first, preserve terminology, etc.)

## Step 6: Write Output

Write the generated PRD to a file:

- Default filename: `PRD-{project-name}.md`
- Default location: same directory as parsed output, or user-specified path
- Encoding: UTF-8

Report completion with:
- Output file path
- Page count processed
- Any sections skipped due to insufficient material

## Error Handling

| Error | Action |
|-------|--------|
| Parse script not found | Check path: `{skill-dir}/scripts/parse-axure.js` |
| Cannot find module 'cheerio' | Run `npm install` at project root |
| Cannot find module './lib/config' | Run `npm run sync:skill` at project root |
| Source URL unreachable | Ask user to verify the URL is accessible |
| No pages found | Axure source may not be a valid published prototype |
| Parse script crash | Show stderr output to user |

## Notes

- The parse script has **no LLM dependency** — it only does HTML→Markdown extraction
- Modules in `scripts/lib/` are copies of `src/*.js`. After modifying source, run `npm run sync:skill` to update
- For large prototypes (20+ pages), the `--single-file` flag produces a single concatenated file which may be easier to process
- "Waste basket" (废稿) folders in the prototype may contain valuable research data — do not skip them
