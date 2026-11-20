# Publishing · Marketplace + OpenVSX runbook

> Source workflow reviewed 2026-09-05. Since the move to `nika-open`
> (2026-11-20), the release workflow publishes its one artifact to OpenVSX
> (Cursor · Windsurf · VSCodium) only: VS Code's Marketplace keeps
> `supernovae.nika` 0.120.0 (§Blockers · accounts). Manifest checks
> describe source, not current registry/account state.

## Per-release readiness gate (run before ANY tag)

The tag is the operator's call. Before it, walk this once · it's the
confidence gate between "the pyramid is green" and "a stranger's first
5 minutes won't embarrass us."

```
1. AUTOMATED   npm ci            → the lockfile IS in sync (the exact CI
                                   gate — v0.93.0 died here in 16s: a
                                   feature-branch merge moved a transitive
                                   esbuild without regenerating the lock)
               node scripts/release-audit.mjs → the release gates' audit:
                                   any advisory at low or above outside
                                   its named exceptions blocks the tag
                                   (§Dependency audit)
               npm run compile  → typecheck + build before the belt judges
                                   the extension and browser artifacts
               npm test         → the belt suite whole (vitest · spec
                                   parity · tokens parity · voice gate ·
                                   glyph registry · release coherence ·
                                   walkthrough media · eslint)
               npm run test:integration → real VS Code hosts: the
                                   integration suite + the first-contact
                                   e2e against ENGINE_PIN's public,
                                   checksum-verified release archive
                                   (launch A: zero gestures to
                                   green; the never-twice guards are
                                   unit-pinned — the harness's storage
                                   is memory-backed, cross-launch state
                                   is not observable there)
               npx vsce package  → packages clean, size sane (~2 MB ·
                                   the canvas bundle is the mass) and
                                   NO `.nika/` inside (local run traces
                                   never ship · the ignore is the belt)
2. CROSS-REVIEW a diff review of the release delta (adversarial · the
               integration/compose bugs a single-feature test can't see)
               — every verified finding fixed, not just filed
3. MANUAL F5   the 20-min feel pass below (what automation can't judge)
4. DOCS        CHANGELOG has the version's entry · README hero current ·
               the demo GIF still reflects the UI
5. VERSION     engine lockstep and the registry channel must agree;
               this workflow currently publishes the stable channel
```

### Manual F5 script · 20 min · the feel the smoke test can't judge

`code .` in this repo → F5 (Run Extension). In the dev host:

```
□ EMPTY STATE   open the DAG panel with no file → the card pitches
                (title · 2 buttons · 3-gesture crib · walkthrough link);
                ＋ New workflow scaffolds; the link opens the walkthrough
□ FIRST RUN     use a reviewed mock-only fixture → Show DAG → cards render
                content-first; ▶ mock lights the DAG wave-by-wave;
                aurora sweeps once on a clean close. Mock changes provider
                selection, not tool permits or task-local model overrides
□ THEME         nika.dag.theme: editor → follows your theme; high
                contrast still legible; toggle back to nika
□ AUDIT READ    a bounded workflow shows a green cost chip on the pill;
                drop a max_tokens → it flips amber `≥ $X`; introduce a
                NIKA-VAR-021 (a ${{ tasks.x }} in a verb body — hoist it
                into with:) → the ⚠N card chip appears → click → the
                report opens
□ EDIT LOOP     change a prompt → the △ stale badge + the pill △N; the
                model chip edits (provider picker → one undoable edit);
                drag a port onto empty canvas → the verb cmdk at the
                cursor → pick → a pre-wired task lands in the YAML
□ REPLAY        run for real (or mock) → open the run in the Runs view →
                the scrubber; Space plays, drag scrubs, the DAG state
                tracks the handle; scrubbing back never spams the feed
□ KEYBOARD      Tab cycles cards · ↑↓ walk dependency/dependent · Enter
                opens the YAML · / filters · Esc clears
□ A11Y          a screen-reader pass on the panel; forced-colors mode
□ CLOSE         close the window mid-LSP-start (no unhandled-rejection
                popup — safeStopClient covers it)
```

If every box holds in BOTH skins, the feel is real. Tag when ready.

### Stable or pre-release

The version tracks the engine announce line. Microsoft's
[publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#pre-release-extensions)
recommends even/odd minor lines for stable/pre-release auto-updates; this is a
recommendation, not a requirement to fork the engine's version. Marketplace
pre-release publication uses an explicit flag and a distinct numeric version,
not a SemVer suffix.

The current tag workflow packages and publishes a regular VSIX. A future
pre-release lane must be implemented and tested across packaging and both
registries before its tag. Do not improvise a separate manual publish or
change the source version to satisfy the even/odd recommendation.

Source convergence is not publication. Advancing `package.json`, both pins,
generated projections, and the changelog makes a release candidate; only the
operator-owned tag ceremony can make the registries claim that version.

## Blockers · accounts (do these FIRST · lead time)

- [x] **[VSM]** Publisher `nika-open` at marketplace.visualstudio.com/manage.
      Name + displayName are globally unique and burned forever on removal.
      It holds no extension. On 2026-11-20 the Marketplace refused
      `nika-open.nika` 0.120.1: « The extension 'nika' already exists in the
      Marketplace ». Extension names are unique across publishers and an
      extension never moves to another publisher
      ([vsmarketplace#504](https://github.com/microsoft/vsmarketplace/issues/504)),
      so VS Code keeps `supernovae.nika` 0.120.0, frozen.
- [x] **[VSM]** Trusted Publishing policy « Release workflow » on `nika-open`:
      GitHub Actions · `nika-open/nika-vscode` · `release.yml` · no
      environment. Unused since `release.yml` publishes to OpenVSX only. Its
      one attempt (run 44766596613) also showed that the locked vsce 4.0.0
      cannot publish through OIDC: « Marketplace OIDC token exchange failed
      with 400 Bad Request: No api-version was supplied ». vsce 4.1.0
      changed that exchange; bump vsce before any `vsce publish --oidc`.
      The repository holds no Azure DevOps token any more: `VSCE_PAT` was
      deleted on 2026-11-20.
- [x] **[VSM]** Trusted Publishing policy « Legacy release workflow » on the
      old publisher `supernovae`: GitHub Actions · `nika-open/nika-vscode` ·
      `legacy-release.yml` · no environment (§Final old-identifier redirect
      release). Neither release workflow reads `VSCE_PAT`. The historical
      one-offs `listing-patch.yml` and `marketplace-recover.yml` require it,
      and `listing-patch.yml` also `OVSX_PAT`; both secrets were deleted on
      2026-11-20, so neither one-off can run any more.
- [x] **[OVSX]** Eclipse account (GitHub username field filled) → log in to
      open-vsx.org via GitHub → link account → **sign the Open VSX Publisher
      Agreement** (not the ECA). Publishing blocked until signed.
- [x] **[OVSX]** Token at open-vsx.org/user-settings/tokens (`OVSX_PAT`) and
      namespace `nika-open`. The token published the FIRST `nika-open.nika`
      version, 0.120.1, on 2026-11-20 (run 44766596613). The secret was
      deleted the same day, once the trusted publisher below existed.
- [x] **[OVSX]** Namespace OWNERSHIP: EclipseFdn/open-vsx.org#16019, closed
      on 2026-11-20, so `nika-open` is verified. Only an owner can register a
      trusted publisher.
- [x] **[OVSX]** open-vsx.org/user-settings/trusted-publishers → namespace
      `nika-open` → GitHub · `nika-open` · `nika-vscode` · `release.yml` ·
      no environment, for `nika-open.nika`, which had the version OpenVSX
      requires before a registration. Registered on 2026-11-20, then the
      `OVSX_PAT` secret was deleted. No release has published through it
      yet.
- [ ] **[VSM]** Verified-publisher badge = month-6 project, not launch:
      publisher ≥ 6 months on VSM **and** domain registration ≥ 6 months ·
      apex domain TXT record · manual review. Display-name change revokes it.

## Manifest gates · state of THIS repo

- [x] `name`/`version`/`publisher`/`engines.vscode` present (no `*`)
- [x] License: `AGPL-3.0-or-later` field + LICENSE file · **OpenVSX
      hard-fails CI publishes without one** (VSM: optional)
- [x] Icon PNG 256×256 (SVG icons are rejected; 128 min, 256 = Retina)
- [x] `repository` set → vsce rewrites relative README links; feeds the
      Resources sidebar (with `bugs` + `homepage`)
- [x] `@types/vscode` (1.75) ≤ `engines.vscode` (1.75) · vsce validates
- [x] Bundled `main` (esbuild · 0 runtime deps · no node_modules in VSIX) ·
      `vscode:prepublish` runs clean+typecheck+build
- [x] `capabilities.untrustedWorkspaces: limited` with
      `restrictedConfigurations: [nika.server.path, nika.server.extraArgs]`
      · registration of the active extension also waits for actual workspace
      trust. Before trust: syntax/snippets only, no engine process or files.
      `firstContactRestricted` uses a native launcher without the standard
      test helper's `--disable-workspace-trust`. Normal first-contact and
      smoke suites are trusted-host tests, not evidence for Restricted Mode.
- [x] `capabilities.virtualWorkspaces: limited` (undeclared default is
      `true`, wrong for a binary-backed extension)
- [x] activationEvents: `onLanguage:` implicit since 1.74 · only
      `workspaceContains` kept (powers the tree pre-open)
- [x] Categories from the documented list (+ Visualization) · keywords ≤ 30
      (hard cap · publish fails above)
- [x] README/CHANGELOG: https-only images · no SVG (badges from approved
      hosts only · vsmarketplacebadges.dev, shields.io…) · CHANGELOG.md
      renders as the Changelog tab
- [x] Binary auto-download policy compliance: HTTPS + SHA-256 verified +
      documented in README + **first-run modal consent** (globalState).
      Registries sandbox-scan runtime behavior; rust-analyzer precedent =
      prefer platform-specific VSIX (below) once the engine ships `run`
- [x] No telemetry → nothing to declare (there is NO manifest telemetry
      field); README states it
- [x] Demo GIF in README (page-load friendly · the listing sells with it)
      · the media pipeline embeds `media/dag-execution.gif` in the hero

## Version strategy

The extension source tracks the released engine's exact semver line. Advance
the manifest and lockfile with `npm version <engine-version> --no-git-tag-version`,
set `ENGINE_PIN` to that immutable engine tag, set
`SPEC_PIN` to the exact commit recorded by that engine tag, then run the spec
projectors. Add the changelog entry and complete every automated and manual
readiness gate before an operator creates the matching tag.

When the source candidate exists before its public engine tag, `ENGINE_PIN`
uses the exact 40-character engine commit and carries a strict
`# CANDIDATE_VERSION: <semver>` marker. Never write a tag that does not exist.
Once the engine tag is public, verify its source against the reviewed candidate
(including tree equality when a squash changed the commit identity), then
replace the marker and SHA with the immutable tag before the extension ceremony.
Add that tag's full commit and four independently verified archive hashes to
`RELEASE_RECEIPTS` in `scripts/pinned-engine.mjs`, with matching receipt tests.
These are public artifact anchors, never hashes from a local candidate build.
The integration installer refuses an unrecorded tag even if GitHub's downloaded
archive and checksum file agree with each other.

`vsce publish minor|patch` auto-bumps and tags, so it is not the admitted
lockstep path. The tag is created manually only after source, engine pin, spec
pin, generated surfaces, package artifact, and feel pass agree.

`npm run release-coherence` is the local ratchet: it refuses a manifest,
lockfile, `ENGINE_PIN`, `SPEC_PIN`, or changelog that no longer describes one
coherent source release. Registry versions stay an explicit post-tag check;
they are external state, not source truth.

## Platform-specific VSIX (when the engine binary bundles)

`vsce publish --target win32-x64 win32-arm64 linux-x64 linux-arm64
linux-armhf alpine-x64 alpine-arm64 darwin-x64 darwin-arm64` · targetless
VSIX = fallback. **Package on Linux/macOS only · Windows-built VSIXes drop
the POSIX executable bit and the bundled binary won't run.** Canonical CI:
microsoft/vscode-platform-specific-sample.

## Live release CI

The [standalone repository](https://github.com/nika-open/nika-vscode)
runs [the tag workflow](.github/workflows/release.yml):
tag-gated → audit (§Dependency audit) → typecheck · tests · parity → real VS Code integration
against the checksum-verified `ENGINE_PIN` artifact → package → publish the
VSIX to OpenVSX with the `ovsx` CLI of the lockfile (`npm ci --ignore-scripts`,
`npx --no-install`). Nothing publishes to the Marketplace (§Blockers ·
accounts). Only the publish job may request an OIDC token. OpenVSX publishes
through its trusted publisher (`ovsx publish --trusted-publishing`). Only the
first version needed the `OVSX_PAT` secret, deleted since; the step uses that
secret instead whenever one is stored again. An identity a registry does not
recognize fails its publish step. Duplicate versions fail loudly; the ceremony
never treats « already exists » as proof that the registry's bytes equal the
VSIX built by this run.

A release to two registries is not a cross-registry transaction. The first
`nika-open.nika` tag reached OpenVSX and then failed at the Marketplace (run
44766596613), and the legacy workflow below can split the same way. Preserve
the built VSIX and diagnose each registry's actual state;
neither a missing second publication nor an occupied version justifies deleting
published bytes, moving the tag or asking a registry to skip duplicates.
Readiness and manual checks are operator gates before the tag; CI does not
certify that somebody completed them.

## Dependency audit

Both release gates run `node scripts/release-audit.mjs` in place of
`npm audit --audit-level=low`. It reads `npm audit --json` and refuses
publication on any advisory at low or above, except the exceptions it names.
An exception names one advisory, the package it affects and the only packages
allowed to depend on the affected copy: the same advisory reached through any
other package still blocks, and so does any other advisory on those packages.
An exception that no longer matches the audit prints a warning; remove it then.
Adding one changes `ACCEPTED` in the script and the test that pins it.

**GHSA-g3hv-75wg-m249** · `minimatch` 10.2.6, only through
`vscode-languageclient` 10.1.1 (moderate: denial of service through globparts
amplification, fixed in minimatch 11.0.1).

- Every `vscode-languageclient` release up to upstream `main` declares
  minimatch ^10.2.6 and calls `Minimatch#makeRe()`, which minimatch 11
  removed: forcing 11 breaks the client (`matcher.makeRe is not a function`).
- The client compiles a pattern only for the file operation, pull diagnostic
  and notebook filters a language server declares. `nika lsp` declares none of
  them and registers no capability at run time (engine v0.120.1, v0.124.5 and
  `main`, `crates/nika-lsp/src/capabilities.rs`). Such a pattern would come
  from the language server, a process the user already runs.
- Remove the exception when a client release accepts minimatch 11.0.1 or later
  ([microsoft/vscode-languageserver-node#1938](https://github.com/microsoft/vscode-languageserver-node/issues/1938)).
  Assess it again if `nika lsp` starts declaring one of those filters.

## Lifecycle traps (learned from others' scars)

- Deleting a published VERSION burns that version number forever
- Prefer **unpublish** over remove (remove destroys install stats and
  reserves the name permanently)
- OpenVSX publish-time scans: secret detection · hash blocklist ·
  typosquat similarity · keep tokens scoped, rotate (2025 leak arc)
- VSM signs all extensions at publish; clients verify · zero action

## Sources

Official: code.visualstudio.com/api (publishing-extension ·
extension-manifest · workspace-trust · virtual-workspaces · webview ·
web-extensions · telemetry · activation-events · bundling · CI) ·
github.com/eclipse-openvsx wiki (Publishing · Namespace-Access ·
Trusted-Publishing) · aka.ms/vsm/trustedpublishing (Marketplace Trusted
Publishing) · microsoft/vscode-vsce (Trusted publishing) ·
HaaLeo/publish-vscode-extension (the historical recovery workflows) ·
developer.microsoft.com security-and-trust blog (2025 scanning pipeline).


## Final old-identifier redirect release

**Blocked since 2026-11-20.** The Marketplace has no `nika-open.nika`
(§Blockers · accounts), so the first gate, `check-canonical-listings.mjs`,
refuses, and a Marketplace redirect would point at no listing. An
OpenVSX-only redirect of the two old identifiers needs its own change to
this workflow and that script. The rest of this section describes the
workflow as written.

Two old identifiers live on the old publisher `supernovae`:
`supernovae.nika` (0.120.0, the canonical listing before the move to
`nika-open`) and `supernovae.nika-lang` (0.116.3). After `nika-open.nika` is
public in BOTH registries at a version, a `legacy-v<version>` tag on the code
of `v<version>` runs `legacy-release.yml`. It refuses an absent canonical
listing, generates one legacy source tree per old identifier without editing
the root manifest, runs the complete audit/compile/test/integration/package
gates on each, and only then publishes each VSIX to both registries under its
old identifier. Each keeps the display name its listing already owns, because
Marketplace display names are unique. Existing-version collisions still fail.
Never move either tag or rerun by suppressing duplicates.

Registry identity: the publisher `supernovae` trusts `legacy-release.yml`
through its own policy « Legacy release workflow » (`vsce publish --oidc`). On
OpenVSX the workflow publishes with `OVSX_PAT` if that secret exists, and
through a trusted publisher otherwise. The secret was deleted on 2026-11-20,
and the namespace `supernovae` is not verified, so it offers no trusted
publisher: a legacy tag first needs a new token of a member of that namespace
stored as `OVSX_PAT`, or an ownership claim on it and a trusted publisher for
`legacy-release.yml`.

The legacy source retains functional contributions, settings, activation events,
workspace trust policy and old deep links. Its README directs users to disable
the legacy extension before installing the new identifier. Migration is explicit;
the legacy artifact does not delete storage, uninstall itself or claim that VS Code
moves extension storage across identifiers. Keep the old listings available.

Local preparation: `node scripts/prepare-legacy-release.mjs <absent-directory>
<nika | nika-lang>`, then `npm ci`, `node scripts/release-audit.mjs`,
`npm run compile`, `npm test`, `npm run test:integration`, and
`npx vsce package --no-dependencies` in that generated source. Generate it
inside a git checkout, as CI does: the file identity ratchet of `npm test`
reads `git ls-files`. The same manual readiness pass applies before a legacy
tag. Registry presence is a prerequisite, not evidence that any tag was
published.
