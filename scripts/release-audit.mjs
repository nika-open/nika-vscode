// release-audit.mjs · the dependency audit of both release gates.
//
// Runs `npm audit --json` in the current directory and refuses publication
// on any advisory at low or above, as `npm audit --audit-level=low` did,
// except the exceptions in ACCEPTED. An exception names one advisory, the
// package it affects and the only packages allowed to depend on the affected
// copy: the same advisory reached through any other package still blocks,
// and so does any other advisory on the same packages. PUBLISHING.md
// §Dependency audit gives each exception's reason and when it goes.
//
//   node scripts/release-audit.mjs
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const ACCEPTED = [
  {
    // minimatch: denial of service through globparts amplification,
    // affects >=7.0.0 <11.0.1. vscode-languageclient 10.1.1 (and every
    // release up to upstream main) declares minimatch ^10.2.6 and calls
    // Minimatch#makeRe(), which minimatch 11 removed, so the fixed line
    // breaks the client. The client compiles a pattern only for file
    // operation, pull diagnostic and notebook filters that a language server
    // declares, and `nika lsp` declares none of them.
    advisory: 'GHSA-g3hv-75wg-m249',
    package: 'minimatch',
    dependents: ['vscode-languageclient'],
    upstream: 'https://github.com/microsoft/vscode-languageserver-node/issues/1938',
  },
];

// `npm audit --audit-level=low` refuses every severity except info.
const BLOCKING = new Set(['low', 'moderate', 'high', 'critical']);

function advisoryId(via) {
  return /\/advisories\/(GHSA-[\w-]+)$/.exec(via.url ?? '')?.[1] ?? `advisory ${via.source}`;
}

function describe(name, entry) {
  const reasons = (entry.via ?? []).map((via) =>
    typeof via === 'string' ? `through ${via}` : advisoryId(via));
  return `${name} (${entry.severity}) · ${reasons.join(', ')} · ${(entry.nodes ?? []).join(', ')}`;
}

/**
 * Judge an `npm audit --json` report (auditReportVersion 2).
 *
 * An entry is explained when each of its own advisories is accepted for
 * that package with every dependent allowed, and each package it reaches
 * an advisory through is itself explained.
 *
 * @returns {{ blocking: string[], accepted: string[], unused: string[] }}
 */
export function judgeAudit(report, accepted = ACCEPTED) {
  const entries = report?.vulnerabilities;
  if (report?.auditReportVersion !== 2 || typeof entries !== 'object' || entries === null) {
    const detail = report?.error ? `: ${report.error.summary ?? report.error.code}` : '';
    return { blocking: [`npm audit returned no version 2 report${detail}`], accepted: [], unused: [] };
  }
  const memo = new Map();
  const explained = (name, trail) => {
    if (memo.has(name)) { return memo.get(name); }
    const entry = entries[name];
    if (!entry || trail.has(name)) { return false; }
    trail.add(name);
    let ok = true;
    for (const via of entry.via ?? []) {
      if (typeof via === 'string') {
        ok = explained(via, trail) && ok;
        continue;
      }
      const exception = accepted.find((candidate) => candidate.advisory === advisoryId(via)
        && candidate.package === name && via.name === name);
      const dependents = entry.effects ?? [];
      ok = ok && exception !== undefined
        && dependents.every((dependent) => exception.dependents.includes(dependent));
    }
    trail.delete(name);
    memo.set(name, ok);
    return ok;
  };
  const verdict = { blocking: [], accepted: [], unused: [] };
  const present = new Set();
  for (const [name, entry] of Object.entries(entries)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'string') { present.add(`${name} ${advisoryId(via)}`); }
    }
    if (!BLOCKING.has(entry.severity)) { continue; }
    verdict[explained(name, new Set()) ? 'accepted' : 'blocking'].push(describe(name, entry));
  }
  verdict.unused = accepted.filter((exception) => !present.has(`${exception.package} ${exception.advisory}`))
    .map((exception) => `${exception.advisory} on ${exception.package}`);
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { report = undefined; }
  const verdict = judgeAudit(report);
  for (const line of verdict.accepted) { console.log(`accepted · ${line}`); }
  for (const line of verdict.unused) {
    console.log(`::warning::exception ${line} no longer matches the audit: remove it from scripts/release-audit.mjs`);
  }
  if (verdict.blocking.length > 0) {
    for (const line of verdict.blocking) { console.log(`::error::${line}`); }
    process.exit(1);
  }
  console.log('Dependency audit: no advisory at low or above outside the accepted exceptions');
}
