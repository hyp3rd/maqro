#!/usr/bin/env node
/**
 * Bundle-size budget enforcement.
 *
 * Next 16 + Turbopack removed the per-route "First Load JS" column
 * from build output, so we can't parse it. Instead, we sum the
 * size of all client-side JS chunks under `.next/static/chunks/`
 * (raw + gzipped) and assert against a single deployment-wide
 * budget. Less precise than per-route, but it catches the only
 * regression that really matters: "did this change ship a lot
 * more JavaScript than before?"
 *
 * For per-page diagnosis, use `npm run analyze` — that runs the
 * full bundle analyzer and drops interactive HTML reports into
 * `.next/analyze/`.
 *
 * Run after `npm run build`. The script assumes `.next/` exists.
 * `make ci` chains them: build → check:budget.
 */
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Budgets in KB. `gz` is the wire-cost ceiling — what users
 *  actually download. `raw` is the parsed-bytes ceiling — what
 *  the browser has to execute. Either being over fails the
 *  check. Bump deliberately when a regression is justified. */
const BUDGET = { totalRawKb: 5500, totalGzKb: 1700 };

const NEXT_DIR = ".next";
const CHUNKS_DIR = join(NEXT_DIR, "static", "chunks");

async function walkJsFiles(dir) {
  let out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(await walkJsFiles(p));
    } else if (e.isFile() && e.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

try {
  statSync(NEXT_DIR);
} catch {
  console.error(
    `[budget] ${NEXT_DIR}/ not found. Run \`npm run build\` first.`,
  );
  process.exit(1);
}

let files;
try {
  files = await walkJsFiles(CHUNKS_DIR);
} catch {
  console.error(
    `[budget] ${CHUNKS_DIR}/ not found — Next.js layout has changed and this script needs an update.`,
  );
  process.exit(1);
}

if (files.length === 0) {
  console.warn(
    `[budget] No JS chunks found in ${CHUNKS_DIR}/ — skipping check.`,
  );
  process.exit(0);
}

let rawBytes = 0;
let gzBytes = 0;
for (const f of files) {
  const buf = readFileSync(f);
  rawBytes += buf.length;
  // gzip with default level (6). The wire cost in prod depends on
  // your CDN's compression setting; this is a reasonable proxy
  // for "what the browser actually pays."
  gzBytes += gzipSync(buf).length;
}

const rawKb = rawBytes / 1024;
const gzKb = gzBytes / 1024;

console.log(`[budget] Client JS chunks (${files.length} files):`);
console.log(
  `  Raw:     ${rawKb.toFixed(1).padStart(8)} KB / ${BUDGET.totalRawKb} KB budget`,
);
console.log(
  `  Gzipped: ${gzKb.toFixed(1).padStart(8)} KB / ${BUDGET.totalGzKb} KB budget`,
);

const violations = [];
if (rawKb > BUDGET.totalRawKb) {
  violations.push(
    `Raw bundle ${rawKb.toFixed(1)} KB exceeds ${BUDGET.totalRawKb} KB`,
  );
}
if (gzKb > BUDGET.totalGzKb) {
  violations.push(
    `Gzipped bundle ${gzKb.toFixed(1)} KB exceeds ${BUDGET.totalGzKb} KB`,
  );
}

if (violations.length > 0) {
  console.error("\n[budget] BUDGET EXCEEDED:");
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    "\nFix: either reduce the bundle size, or bump the budget in scripts/check-bundle-budget.mjs (only if the increase is justified).\n" +
      "Diagnose with: npm run analyze",
  );
  // Bundle analyzer's HTML is in .next/analyze/ — point the user there too.
  process.exit(1);
}

console.log("\n[budget] All budgets met.");
