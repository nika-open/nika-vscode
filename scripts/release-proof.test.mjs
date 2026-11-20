import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ACCEPTED, judgeAudit } from './release-audit.mjs';
import { runIntegration, runSuite } from './run-integration.mjs';
import {
  assertVersionReceipt,
  checksumForAsset,
  installPinnedEngine,
  readPinnedRelease,
  releaseAsset,
  releaseReceipt,
} from './pinned-engine.mjs';

const root = resolve(import.meta.dirname, '..');

function httpResponse(url, body, headers = {}) {
  const response = new Response(body, { headers });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

for (const mode of ['declared', 'chunked', 'underreported', 'invalid-length']) {
  test(`release download refuses ${mode} oversized metadata before archive fetch or extraction`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nika-pin-bounded-'));
    let extractionCalls = 0;
    const requests = [];
    let cancelled = false;
    try {
      writeFileSync(join(dir, 'ENGINE_PIN'), 'v0.116.2\n');
      const fetchImpl = async (url) => {
        requests.push(url);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
            controller.enqueue(new Uint8Array(1));
          },
          pull(controller) { controller.error(new Error('body consumed past size boundary')); },
          cancel() { cancelled = true; },
        }, { highWaterMark: 0 });
        const length = { declared: '65537', underreported: '1', 'invalid-length': '1e9' }[mode];
        return httpResponse(url, stream, length ? { 'content-length': length } : {});
      };
      await assert.rejects(installPinnedEngine({
        rootDir: dir, tempRoot: dir, fetchImpl,
        execFileSyncImpl: () => { extractionCalls += 1; },
      }), /download limit|invalid content-length/);
      assert.equal(extractionCalls, 0);
      assert.equal(requests.length, 1, 'metadata refusal must precede archive admission');
      assert.ok(cancelled, 'the rejected response body must be cancelled');
      assert.deepEqual(readdirSync(dir), ['ENGINE_PIN'], 'owned scratch must be removed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('an oversized archive header is refused before its first read or extraction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nika-pin-archive-bound-'));
  let reads = 0;
  let cancelled = false;
  try {
    writeFileSync(join(dir, 'ENGINE_PIN'), 'v0.116.2\n');
    const asset = releaseAsset(process.platform, process.arch, '0.116.2');
    const { sha256 } = releaseReceipt('v0.116.2', asset);
    const fetchImpl = async (url) => {
      if (url.endsWith('SHA256SUMS')) return httpResponse(url, `${sha256}  ${asset}\n`);
      return httpResponse(url, new ReadableStream({
        pull() { reads += 1; },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }), { 'content-length': String(256 * 1024 * 1024 + 1) });
    };
    await assert.rejects(installPinnedEngine({
      rootDir: dir, tempRoot: dir, fetchImpl,
      execFileSyncImpl: () => assert.fail('refused archive reached extraction'),
    }), /download limit/);
    assert.equal(reads, 0);
    assert.ok(cancelled);
    assert.deepEqual(readdirSync(dir), ['ENGINE_PIN']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exact-limit metadata in tiny chunks preserves bytes before anchored archive refusal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nika-pin-exact-bound-'));
  const requests = [];
  try {
    writeFileSync(join(dir, 'ENGINE_PIN'), 'v0.116.2\n');
    const asset = releaseAsset(process.platform, process.arch, '0.116.2');
    const { sha256 } = releaseReceipt('v0.116.2', asset);
    const sums = Buffer.from(`${sha256}  ${asset}\n`.padEnd(64 * 1024, ' '));
    const fetchImpl = async (url) => {
      requests.push(url);
      if (!url.endsWith('SHA256SUMS')) return httpResponse(url, 'foreign archive');
      let offset = 0;
      return httpResponse(url, new ReadableStream({
        pull(controller) {
          if (offset === sums.length) controller.close();
          else controller.enqueue(sums.subarray(offset, ++offset));
        },
      }));
    };
    await assert.rejects(installPinnedEngine({
      rootDir: dir, tempRoot: dir, fetchImpl,
      execFileSyncImpl: () => assert.fail('foreign archive reached extraction'),
    }), /archive digest mismatch/);
    assert.equal(requests.length, 2);
    assert.deepEqual(readdirSync(dir), ['ENGINE_PIN']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the publishing runbook names the live standalone release owner', () => {
  const runbook = readFileSync(resolve(root, 'PUBLISHING.md'), 'utf8');
  assert.match(runbook, /https:\/\/github\.com\/nika-open\/nika-vscode/);
  assert.doesNotMatch(runbook, /inert inside|live on split|git subtree split/);
  assert.match(runbook, /not a cross-registry transaction/);
});

test('publishing readiness compiles before the belt and records immutable public receipts', () => {
  const runbook = readFileSync(resolve(root, 'PUBLISHING.md'), 'utf8');
  assert(runbook.indexOf('npm run compile') >= 0);
  assert(runbook.indexOf('npm run compile') < runbook.indexOf('npm test'));
  assert.match(runbook, /scripts\/pinned-engine\.mjs/);
  assert.match(runbook, /RELEASE_RECEIPTS/);
  assert.match(runbook, /tree equality/);
});

test('integration failures cannot bypass owned engine cleanup', () => {
  for (const file of [
    'scripts/run-integration.mjs',
    'src/test-integration/runTests.ts',
    'src/test-integration/runFirstContact.ts',
    'src/test-integration/runRestrictedWorkspace.ts',
  ]) {
    const source = readFileSync(resolve(root, file), 'utf8');
    assert.doesNotMatch(source, /process\.exit\(/, `${file} bypasses finally`);
  }
});

test('integration releases the exact installed engine after any suite fails', async () => {
  const suites = ['out-integration/runRestrictedWorkspace.js', 'out-integration/runTests.js', 'out-integration/runFirstContact.js'];
  for (const failingSuite of [null, ...suites]) {
    let cleanupCount = 0;
    const calls = [];
    const failure = new Error('host failed');
    const run = runIntegration({
      installEngine: async () => ({
        binaryPath: '/owned/verified/nika', version: '0.118.1',
        cleanup: () => { cleanupCount += 1; },
      }),
      environment: { NIKA_BIN: '/unverified/nika', NIKA_ENGINE_VERSION: '0.116.2' },
      log: () => {},
      run: (script, env) => {
        calls.push(script);
        assert.equal(env.NIKA_BIN, '/owned/verified/nika');
        assert.equal(env.NIKA_ENGINE_VERSION, '0.118.1');
        if (script === failingSuite) throw failure;
      },
    });
    if (failingSuite) await assert.rejects(run, (error) => error === failure);
    else await run;
    assert.equal(cleanupCount, 1);
    assert.deepEqual(calls, failingSuite ? suites.slice(0, suites.indexOf(failingSuite) + 1) : suites);
  }
});

test('first-contact-only remains an explicit one-suite run and cleans up', async () => {
  const calls = [];
  await runIntegration({
    firstContactOnly: true,
    installEngine: async () => ({ cleanup: () => calls.push('cleanup') }),
    environment: {}, log: () => {},
    run: (script) => calls.push(script),
  });
  assert.deepEqual(calls, ['out-integration/runFirstContact.js', 'cleanup']);
});

test('suite success, failure and timeout all terminate only their owned process group', () => {
  for (const result of [
    { pid: 42, status: 0 },
    { pid: 42, status: 7 },
    { pid: 42, status: null, signal: 'SIGKILL', error: new Error('timeout') },
  ]) {
    const killed = [];
    const run = () => runSuite('fixture.js', {}, {
      spawn: (_file, _args, options) => {
        assert.equal(options.timeout, 600_000);
        assert.equal(options.killSignal, 'SIGKILL');
        assert.equal(options.detached, true);
        return result;
      },
      kill: (pid) => killed.push(pid),
    });
    if (result.status === 0) run();
    else assert.throws(run, /failed|timeout/);
    assert.deepEqual(killed, [-42]);
  }
});

test('suite deadline terminates a real stalled launcher and refuses invalid bounds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nika-suite-deadline-'));
  try {
    const fixture = join(dir, 'stall.cjs');
    writeFileSync(fixture, 'setInterval(() => {}, 1000);\n');
    const started = Date.now();
    assert.throws(() => runSuite(fixture, {}, { timeoutMs: 200 }), /ETIMEDOUT/);
    assert.ok(Date.now() - started < 5000, 'stalled suite escaped its deadline');
    for (const timeoutMs of [0, -1, Infinity, NaN]) {
      assert.throws(() => runSuite(fixture, {}, { timeoutMs }), /positive finite integer/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the integration launcher cannot fall back to Homebrew or PATH', () => {
  const launcher = readFileSync(resolve(root, 'src/test-integration/runFirstContact.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(launcher, /Cellar|homebrew\/bin|usr\/local\/bin|no released engine|skipped/);
  assert.match(launcher, /process\.env\.NIKA_BIN/);
  assert.match(packageJson.scripts['test:integration'], /scripts\/run-integration\.mjs/);
});

// Both release ceremonies share one shape: a gate that runs every check
// before packaging, then a publish job that holds the only OIDC permission.
function releaseCeremony(file) {
  const workflow = readFileSync(resolve(root, '.github/workflows', file), 'utf8');
  const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const [gate, publish] = workflow.split(/\n {2}publish:\n/);
  assert.ok(publish, `${file} has a publish job after the gate`);
  // Trusted publishing: no Marketplace secret anywhere, and the gate (which
  // runs every dev dependency) can neither mint an OIDC token nor read a secret.
  assert.doesNotMatch(code(workflow), /VSCE_PAT/);
  assert.doesNotMatch(code(gate), /id-token|secrets\./);
  assert.equal(code(publish).match(/id-token: write/g)?.length, 1);
  assert.match(publish, /^\s+needs: gate$/m);
  // The publish job runs the locked CLIs only: no install scripts, no npx fetch.
  assert.match(publish, /^\s+- run: npm ci --ignore-scripts$/m);
  assert.doesNotMatch(code(publish), /uses: HaaLeo\//);
  // An occupied version stays an error in every registry.
  assert.doesNotMatch(workflow, /HAS_OVSX|HAS_VSCE|if: env\.HAS_/);
  assert.doesNotMatch(workflow, /skipDuplicate|skip-duplicate/);
  // The audit is the gate with its named exceptions, never a bare npm audit,
  // and every check precedes packaging.
  assert.doesNotMatch(code(workflow), /npm audit/);
  const order = ['run: node scripts/release-audit.mjs', 'npm run test:integration', 'npx vsce package'];
  order.forEach((step, index) => {
    assert.ok(gate.includes(step), `${file} gate runs ${step}`);
    if (index > 0) { assert.ok(gate.indexOf(order[index - 1]) < gate.indexOf(step), `${step} comes last`); }
  });
  for (const action of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(action[1], /@[0-9a-f]{40}$/, `action is not SHA-pinned: ${action[1]}`);
  }
  return { gate, publish };
}

test('the release ceremony fails closed, gates before packaging and publishes to OpenVSX only', () => {
  const { publish } = releaseCeremony('release.yml');
  assert.match(publish, /^\s+npx --no-install ovsx publish nika\.vsix$/m);
  assert.match(publish, /^\s+npx --no-install ovsx publish nika\.vsix --trusted-publishing$/m);
  // The Marketplace keeps supernovae.nika: it refuses a second extension named nika.
  assert.doesNotMatch(publish, /vsce publish/);
});

test('the legacy ceremony gates both old identifiers before publishing either', () => {
  const { gate, publish } = releaseCeremony('legacy-release.yml');
  for (const job of [gate, publish]) {
    assert.match(job, /^\s+legacy: \[nika, nika-lang\]$/m);
    assert.match(job, /^\s+VSIX: supernovae\.\$\{\{ matrix\.legacy \}\}\.vsix$/m);
  }
  // One identifier failing never cancels the other between its two registries.
  assert.match(publish, /^\s+fail-fast: false$/m);
  assert.match(publish, /^\s+npx --no-install ovsx publish "\$VSIX"$/m);
  assert.match(publish, /^\s+npx --no-install ovsx publish "\$VSIX" --trusted-publishing$/m);
  assert.match(publish, /^\s+run: npx --no-install vsce publish --oidc --packagePath "\$VSIX"$/m);
  assert.ok(publish.indexOf('ovsx publish') < publish.indexOf('vsce publish'));
  // The canonical listings are public before the old identifier's tree exists.
  const listings = gate.indexOf('node scripts/check-canonical-listings.mjs');
  const prepare = gate.indexOf('node scripts/prepare-legacy-release.mjs legacy-source "$LEGACY"');
  assert.ok(listings >= 0 && listings < prepare && prepare < gate.indexOf('node scripts/release-audit.mjs'));
  assert.match(gate, /^\s+test "legacy-v\$v" = "\$GITHUB_REF_NAME"/m);
});

const advisory = (name, id, severity = 'moderate') => ({
  source: 1244623, name, dependency: name, title: 'advisory', severity, range: '>=7.0.0 <11.0.1',
  url: `https://github.com/advisories/${id}`,
});
const auditReport = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities, metadata: {} });
// The shape `npm audit --json` reported on 20 November 2026 for the lockfile of #343.
const minimatchUnderTheClient = () => auditReport({
  'minimatch': { name: 'minimatch', severity: 'moderate', isDirect: false, range: '7.0.0 - 11.0.0',
    via: [advisory('minimatch', 'GHSA-g3hv-75wg-m249')], effects: ['vscode-languageclient'],
    nodes: ['node_modules/minimatch'] },
  'vscode-languageclient': { name: 'vscode-languageclient', severity: 'moderate', isDirect: true,
    range: '>=9.0.2-next.1', via: ['minimatch'], effects: [], nodes: ['node_modules/vscode-languageclient'] },
});
const auditNames = (lines) => lines.map((line) => line.split(' ')[0]).sort();

test('the release audit accepts one advisory through one package and nothing else', () => {
  assert.deepEqual(ACCEPTED.map(({ advisory: id, package: name, dependents }) => [id, name, dependents]),
    [['GHSA-g3hv-75wg-m249', 'minimatch', ['vscode-languageclient']]]);
  const today = judgeAudit(minimatchUnderTheClient());
  assert.deepEqual(today.blocking, []);
  assert.deepEqual(auditNames(today.accepted), ['minimatch', 'vscode-languageclient']);
  assert.deepEqual(today.unused, []);

  // The same advisory reached through any other package blocks the whole chain.
  const wider = minimatchUnderTheClient();
  wider.vulnerabilities.minimatch.effects.push('eslint');
  wider.vulnerabilities.eslint = { name: 'eslint', severity: 'moderate', via: ['minimatch'], effects: [],
    nodes: ['node_modules/eslint'] };
  assert.deepEqual(auditNames(judgeAudit(wider).blocking), ['eslint', 'minimatch', 'vscode-languageclient']);
  assert.deepEqual(judgeAudit(wider).unused, []);

  // Another advisory on minimatch blocks, and so does one on the client itself.
  const second = minimatchUnderTheClient();
  second.vulnerabilities.minimatch.via.push(advisory('minimatch', 'GHSA-aaaa-bbbb-cccc', 'high'));
  assert.deepEqual(auditNames(judgeAudit(second).blocking), ['minimatch', 'vscode-languageclient']);
  const own = minimatchUnderTheClient();
  own.vulnerabilities['vscode-languageclient'].via.push(advisory('vscode-languageclient', 'GHSA-dddd-eeee-ffff'));
  assert.deepEqual(auditNames(judgeAudit(own).blocking), ['vscode-languageclient']);

  // The accepted advisory on another package blocks: an exception names its package.
  const elsewhere = auditReport({ glob: { name: 'glob', severity: 'moderate', effects: [],
    via: [advisory('glob', 'GHSA-g3hv-75wg-m249')], nodes: ['node_modules/glob'] } });
  assert.deepEqual(auditNames(judgeAudit(elsewhere).blocking), ['glob']);

  // Low blocks, as --audit-level=low did; info does not.
  const low = minimatchUnderTheClient();
  low.vulnerabilities.qs = { name: 'qs', severity: 'low', effects: [], nodes: ['node_modules/qs'],
    via: [advisory('qs', 'GHSA-1111-2222-3333', 'low')] };
  assert.deepEqual(auditNames(judgeAudit(low).blocking), ['qs']);
  low.vulnerabilities.qs.severity = 'info';
  assert.deepEqual(judgeAudit(low).blocking, []);

  // A chain through a package the report does not list is not explained.
  const dangling = minimatchUnderTheClient();
  dangling.vulnerabilities['vscode-languageclient'].via.push('ghost');
  assert.deepEqual(auditNames(judgeAudit(dangling).blocking), ['vscode-languageclient']);

  // A fixed upstream leaves the exception unused: reported, not refused.
  const fixed = judgeAudit(auditReport({}));
  assert.deepEqual(fixed.blocking, []);
  assert.deepEqual(fixed.unused, ['GHSA-g3hv-75wg-m249 on minimatch']);

  // No report at all is a refusal.
  for (const broken of [undefined, {}, { error: { code: 'ENOAUDIT', summary: 'audit endpoint error' } }]) {
    assert.equal(judgeAudit(broken).blocking.length, 1);
  }
});

test('ENGINE_PIN must name an exact public stable release', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nika-pin-test-'));
  try {
    writeFileSync(join(dir, 'ENGINE_PIN'), '# comment\nv0.116.2\n');
    assert.deepEqual(readPinnedRelease(dir), { tag: 'v0.116.2', version: '0.116.2' });
    writeFileSync(join(dir, 'ENGINE_PIN'), `${'a'.repeat(40)}\n`);
    assert.throws(() => readPinnedRelease(dir), /public stable release tag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('platform mapping names only real release assets', () => {
  assert.equal(releaseAsset('darwin', 'arm64', '0.116.2'), 'nika-macos-arm64-0.116.2.tar.gz');
  assert.equal(releaseAsset('linux', 'x64', '0.116.2'), 'nika-linux-x64-0.116.2.tar.gz');
  assert.throws(() => releaseAsset('win32', 'x64', '0.116.2'), /no public asset/);
});

test('checksum selection is exact and unique', () => {
  const asset = 'nika-linux-x64-0.116.2.tar.gz';
  const hash = 'ab'.repeat(32);
  assert.equal(checksumForAsset(`${hash}  ${asset}\n`, asset), hash);
  assert.throws(() => checksumForAsset('', asset), /found 0/);
  assert.throws(() => checksumForAsset(`${hash}  ${asset}\n${hash} *${asset}\n`, asset), /found 2/);
});

test('the 0.116.2 public assets have version-controlled immutable anchors', () => {
  const expectedCommit = 'c4cdbeafb58fe3705beb1d1000a14a8d18efc973';
  const receipts = new Map([
    ['nika-linux-arm64-0.116.2.tar.gz', '278f11c927e793cc51cae98ee04dde498a51a8af925733772828053f94d79c20'],
    ['nika-linux-x64-0.116.2.tar.gz', '5b94ebab8ea5a3e915c33d8b712400dd80e9c8f559d652cb288c38af23356024'],
    ['nika-macos-arm64-0.116.2.tar.gz', '5c66aafc4127fcf3383477badf13690614973075a640512136517f376d716f86'],
    ['nika-macos-x64-0.116.2.tar.gz', '6cb60636b21817260f7e6ae06cb1f521f96c07c960e7347467e60692236a2142'],
  ]);
  for (const [asset, sha256] of receipts) {
    assert.deepEqual(releaseReceipt('v0.116.2', asset), { commit: expectedCommit, sha256 });
  }
  assert.throws(
    () => releaseReceipt('v0.116.3', 'nika-linux-x64-0.116.3.tar.gz'),
    /no version-controlled release receipt/,
  );
});

test('version receipt refuses stale or foreign build identities', () => {
  const commit = 'c4cdbeafb58fe3705beb1d1000a14a8d18efc973';
  assert.doesNotThrow(() => assertVersionReceipt('nika 0.116.2 (c4cdbeafb)\n', '0.116.2', commit));
  assert.throws(
    () => assertVersionReceipt('nika 0.116.0 (c4cdbeafb)\n', '0.116.2', commit),
    /identity mismatch/,
  );
  assert.throws(
    () => assertVersionReceipt('nika 0.116.2 (deadbeef0)\n', '0.116.2', commit),
    /identity mismatch/,
  );
  for (const output of [
    'unrelated program\nnika 0.116.2 (c4cdbeafb)\n',
    'nika 0.116.2 (c4cdbeafb)\nnika 0.118.1 (deadbeef0)\n',
    'nika 0.116.2 (c4cdbeafb)\nextra diagnostics\n',
  ]) {
    assert.throws(() => assertVersionReceipt(output, '0.116.2', commit), /identity mismatch/);
  }
});

test('deadbeef0 archive and co-modified SHA256SUMS cannot replace the anchored release', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nika-pin-download-test-'));
  let extractionCalls = 0;
  try {
    writeFileSync(join(dir, 'ENGINE_PIN'), 'v0.116.2\n');
    const asset = releaseAsset(process.platform, process.arch, '0.116.2');
    const archive = Buffer.from('#!/bin/sh\necho "nika 0.116.2 (deadbeef0)"\n');
    const coModifiedHash = createHash('sha256').update(archive).digest('hex');
    const fetchImpl = async (url) => {
      const body = Buffer.from(url.endsWith('SHA256SUMS') ? `${coModifiedHash}  ${asset}\n` : archive);
      return httpResponse(url, body);
    };
    await assert.rejects(
      installPinnedEngine({
        rootDir: dir,
        fetchImpl,
        tempRoot: dir,
        execFileSyncImpl: () => { extractionCalls += 1; return ''; },
      }),
      /SHA256SUMS drift/,
    );
    assert.equal(extractionCalls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('legacy redirects retain functionality, keep their listing names and refuse to overwrite a source tree', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'nika-legacy-source-'));
  try {
    const source = join(fixture, 'repo');
    const script = join(source, 'scripts', 'prepare-legacy-release.mjs');
    mkdirSync(join(source, 'scripts'), { recursive: true });
    mkdirSync(join(source, 'src'));
    const manifest = { name: 'nika', publisher: 'nika-open', displayName: 'Nika', version: '0.120.1',
      main: './out/extension.js', activationEvents: ['onUri', 'onStartupFinished'],
      capabilities: { untrustedWorkspaces: { supported: 'limited' } },
      contributes: { commands: [{ command: 'nika.runWorkflow' }] } };
    writeFileSync(join(source, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(source, 'package-lock.json'), JSON.stringify({ name: 'nika', packages: { '': { name: 'nika' } } }));
    writeFileSync(join(source, 'README.md'), '# Nika\n');
    writeFileSync(join(source, 'CHANGELOG.md'), '## [0.120.1]\n');
    writeFileSync(join(source, 'src', 'extension.ts'),
      "const id = 'nika-open.nika'; const walk = 'nika-open.nika#nika.gettingStarted'; const other = 'nika-open.nika-other';");
    writeFileSync(script, readFileSync(join(root, 'scripts/prepare-legacy-release.mjs')));
    execFileSync('git', ['init', '-q', source]);
    execFileSync('git', ['add', '.'], { cwd: source });
    // Marketplace display names are unique: each old listing keeps the one it owns.
    const listings = { 'nika': 'Nika Workflow Language', 'nika-lang': 'Nika Workflow Language (legacy identifier)' };
    for (const [legacy, displayName] of Object.entries(listings)) {
      const target = join(fixture, legacy);
      const expected = { ...manifest, publisher: 'supernovae', name: legacy, displayName };
      execFileSync(process.execPath, [script, target, legacy]);
      assert.deepEqual(JSON.parse(readFileSync(join(source, 'package.json'))), manifest);
      assert.deepEqual(JSON.parse(readFileSync(join(target, 'package.json'))), expected);
      const lock = JSON.parse(readFileSync(join(target, 'package-lock.json')));
      assert.deepEqual([lock.name, lock.packages[''].name], [legacy, legacy]);
      assert.equal(readFileSync(join(target, 'src/extension.ts'), 'utf8'),
        `const id = 'supernovae.${legacy}'; const walk = 'supernovae.${legacy}#nika.gettingStarted'; const other = 'nika-open.nika-other';`);
      const readme = readFileSync(join(target, 'README.md'), 'utf8');
      assert.match(readme, /^# Nika has moved to nika-open\.nika\n/);
      assert.ok(readme.includes(`the old identifier, supernovae.${legacy}.`));
      assert.ok(readme.includes('(https://marketplace.visualstudio.com/items?itemName=nika-open.nika)'));
      assert.ok(readme.includes('(https://open-vsx.org/extension/nika-open/nika)'));
      assert.match(readme, /disable this old extension/);
      assert.ok(readFileSync(join(target, 'CHANGELOG.md'), 'utf8').includes(`This package remains supernovae.${legacy}.`));
      assert.throws(() => execFileSync(process.execPath, [script, target, legacy], { stdio: 'pipe' }));
      assert.deepEqual(JSON.parse(readFileSync(join(target, 'package.json'))), expected);
    }
    // Only the two old identifiers exist, built from the nika-open.nika manifest only.
    assert.throws(() => execFileSync(process.execPath, [script, join(fixture, 'other'), 'nika-other'], { stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, [script, join(fixture, 'unnamed')], { stdio: 'pipe' }));
    writeFileSync(join(source, 'package.json'), JSON.stringify({ ...manifest, publisher: 'supernovae' }));
    assert.throws(() => execFileSync(process.execPath, [script, join(fixture, 'stale'), 'nika'], { stdio: 'pipe' }));
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
