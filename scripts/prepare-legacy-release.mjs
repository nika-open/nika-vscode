// Build the final source tree of an old identifier without mutating the canonical manifest.
//
//   node scripts/prepare-legacy-release.mjs <absent destination> <nika | nika-lang>
//
// The canonical extension is nika-open.nika. Two old identifiers live on the supernovae
// publisher: supernovae.nika (until 0.120.0) and supernovae.nika-lang (until 0.116.3).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const CANONICAL = 'nika-open.nika';
const LEGACY_PUBLISHER = 'supernovae';
// Marketplace display names are unique: each old listing keeps the one it already owns.
const LEGACY_DISPLAY_NAMES = {
  'nika': 'Nika Workflow Language',
  'nika-lang': 'Nika Workflow Language (legacy identifier)',
};

const root = resolve(import.meta.dirname, '..');
assert(process.argv[2], 'Pass an absent destination directory');
const destination = resolve(process.argv[2]);
assert(!existsSync(destination), 'Destination must not exist');
const name = process.argv[3];
assert(Object.hasOwn(LEGACY_DISPLAY_NAMES, name ?? ''), 'Pass the old extension name: nika or nika-lang');
const legacyId = LEGACY_PUBLISHER + '.' + name;
const toLegacy = (text) => text.replace(/nika-open\.nika(?![\w-])/g, legacyId);
const source = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.equal(source.publisher + '.' + source.name, CANONICAL);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const relative of tracked) {
  const target = resolve(destination, relative);
  assert(target.startsWith(destination + '/'));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, relative), target);
  if (/\.(ts|mjs|cjs|md|json)$/.test(relative) && !['CHANGELOG.md', 'scripts/prepare-legacy-release.mjs', 'scripts/check-canonical-listings.mjs', 'scripts/release-proof.test.mjs'].includes(relative)) {
    writeFileSync(target, toLegacy(readFileSync(target, 'utf8')));
  }
}
const manifestFile = resolve(destination, 'package.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.publisher = LEGACY_PUBLISHER;
manifest.name = name;
manifest.displayName = LEGACY_DISPLAY_NAMES[name];
assert.equal(manifest.version, source.version);
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
const lockFile = resolve(destination, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
lock.name = name;
lock.packages[''].name = name;
writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
const banner = '# Nika has moved to nika-open.nika\n\n' +
  'This is the final update for the old identifier, ' + legacyId + '. ' +
  'It retains the editor features and your existing settings, journals and extension storage.\n\n' +
  'For future updates, disable this old extension, then install ' +
  '[Nika on VS Marketplace](https://marketplace.visualstudio.com/items?itemName=nika-open.nika) or ' +
  '[Nika on Open VSX](https://open-vsx.org/extension/nika-open/nika). ' +
  'Reload the editor after switching. Keep only one identifier enabled to avoid duplicate commands and engine processes.\n\n' +
  'The new identifier has separate extension storage and may ask for engine-install consent again. ' +
  'Your workspace settings and engine-owned journals stay where they are. ' +
  'Old deep links continue to work while this legacy extension is enabled; new links use vscode://nika-open.nika/.\n\n';
const readmeFile = resolve(destination, 'README.md');
writeFileSync(readmeFile, banner + readFileSync(readmeFile, 'utf8'));
const changelogFile = resolve(destination, 'CHANGELOG.md');
writeFileSync(changelogFile, '# Legacy identifier final update · ' + source.version + '\n\n' +
  'This package remains ' + legacyId + '. Its README points to the new nika-open.nika listing. ' +
  'Existing editor functionality is retained; installation of the new identifier is an explicit user action.\n\n' +
  readFileSync(changelogFile, 'utf8'));
// A redirect must not become a hollow package: compare every functional contribution.
assert.deepEqual(manifest.contributes, JSON.parse(toLegacy(JSON.stringify(source.contributes))));
assert.equal(manifest.main, source.main);
assert.deepEqual(manifest.activationEvents, source.activationEvents);
assert.deepEqual(manifest.capabilities, source.capabilities);
console.log('Legacy source prepared: ' + legacyId + '@' + source.version);
