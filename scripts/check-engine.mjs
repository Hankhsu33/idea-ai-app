/**
 * Syntax-check the engine page.
 *
 * `tsc` never sees assets/webview/inference.html — Metro treats it as a binary asset,
 * so nothing in the toolchain reads the several hundred lines of JavaScript inside it.
 * Every other file in this project has a compiler standing behind it; this one has had
 * nothing, which makes it the one place an edit can be broken and silent.
 *
 * The script is compiled, not run. `new vm.Script(...)` parses and throws on a syntax
 * error without executing a line, so the browser globals the page depends on are never
 * touched and never need to exist here.
 *
 *   node scripts/check-engine.mjs [path-to-html]
 */

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] ?? 'assets/webview/inference.html';

let html;
try {
  html = readFileSync(file, 'utf8');
} catch {
  console.error(`cannot read ${file}`);
  process.exit(1);
}

// Only inline scripts. A `src=` script has no body to check and would yield an empty
// match that looks like a pass.
const blocks = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];

if (blocks.length === 0) {
  console.error(`${file}: no inline <script> found — is this the right file?`);
  process.exit(1);
}

let failed = false;

blocks.forEach((match, index) => {
  const body = match[1];
  // Line number within the file, so a reported error can be found by eye.
  const startLine = html.slice(0, match.index).split('\n').length;

  try {
    new vm.Script(body, { filename: file });
    const lines = body.split('\n').length;
    console.log(`  script #${index + 1} at line ${startLine}: ${lines} lines, parses cleanly`);
  } catch (e) {
    failed = true;
    console.error(`  script #${index + 1} starting at line ${startLine} of ${file}:`);
    console.error(`    ${e.message}`);
  }
});

if (failed) {
  console.error('\nengine page is broken — the app will not start with this.');
  process.exit(1);
}

console.log('\nengine page parses.');
