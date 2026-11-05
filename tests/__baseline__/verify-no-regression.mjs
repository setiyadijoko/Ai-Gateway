// Gate: compare a vitest JSON report against the known-fails baseline.
// PASS when no test outside known-fails.txt fails. New tests are allowed.
// Known entries that now pass are reported as stale (non-fatal) so the
// baseline can be shrunk.
//
// Usage (from repo root or tests/ — paths are resolved from this file):
//   cd tests && npx vitest run --reporter=json --outputFile=../vitest-results.json
//   node tests/__baseline__/verify-no-regression.mjs vitest-results.json
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const SUITE_LOAD_FAILED = "<suite failed to load>";
const SUITE_ERROR = "<suite error outside tests>";

const knownFails = new Set(
  readFileSync(resolve(here, "known-fails.txt"), "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"))
);

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("Missing results.json path");
  process.exit(2);
}

const r = JSON.parse(readFileSync(resolve(process.cwd(), resultsPath), "utf8"));

// Repo-relative, forward-slash test file path, independent of where the repo
// is checked out (the previous version split on "/app/", which only matched
// the upstream container layout and silently produced garbage elsewhere).
const toRel = (file) => relative(repoRoot, file).split(sep).join("/");

const nowFails = [];
for (const file of r.testResults) {
  const rel = toRel(file.name);
  const failed = file.assertionResults.filter((a) => a.status === "failed");
  for (const a of failed) nowFails.push(`${rel} :: ${a.fullName}`);
  // A file can fail with no failing assertion: it crashed on import (no
  // assertion results at all) or raised an error outside a test (e.g. an
  // unhandled rejection). Count both, otherwise they pass the gate unnoticed.
  if (file.status === "failed" && failed.length === 0) {
    // Import crashes can still list collected-but-skipped tests, so "nothing
    // passed" is the load-failure signal, not "no results".
    const anyPassed = file.assertionResults.some((a) => a.status === "passed");
    const label = anyPassed ? SUITE_ERROR : SUITE_LOAD_FAILED;
    nowFails.push(`${rel} :: ${label}`);
  }
}

const nowFailSet = new Set(nowFails);
const regressions = nowFails.filter((f) => !knownFails.has(f));
const stale = [...knownFails].filter((k) => !nowFailSet.has(k));

if (stale.length) {
  console.log(`ℹ️  ${stale.length} known-fail entr${stale.length === 1 ? "y" : "ies"} now pass — remove from known-fails.txt:`);
  stale.forEach((f) => console.log("  - " + f));
}

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} failing test(s) not in known-fails.txt:\n`);
  regressions.forEach((f) => console.error("  - " + f));
  process.exit(1);
}

console.log(
  `✅ No regression. (total=${r.numTotalTests}, now fails=${nowFails.length}, baseline known=${knownFails.size})`
);
