# Release Readiness Plan — `agentconfiging`

Status date: 2026-08-01. Branch at assessment: `code-review-fixes` (clean tree).
This is a planning document; nothing in it has been executed.

---

## 1. Current State Assessment

### Version & publish status

| Fact | Value |
|---|---|
| `package.json` version | `0.1.0` |
| Published to npm? | **No** — `npm view agentconfiging` returns 404 (name currently unclaimed) |
| Git tags | **None** (`git tag` is empty) |
| Remote | `https://github.com/junoddev/agentconfiging.git` |
| License | MIT (root `LICENSE`, Copyright (c) 2026 Aaron Junod; matches `package.json`) |
| Node support | `engines.node >= 20.19` |
| Bin | `agentconfiging` → `dist/cli/index.js` |
| Files whitelist | `"files": ["dist"]` (plus npm-implicit LICENSE/README/package.json) |

### What PUBLISHING.md already covers (verified accurate)

`/Users/tranqy/projects/agentconfig/PUBLISHING.md` is a real runbook, and its
claims check out against the repo:

- Pre-flight done: `publishConfig.access: public`, `prepublishOnly` runs a fresh
  build, and the packaging e2e checks required/forbidden tarball content without
  pinning volatile hashed filenames, file counts, or byte sizes.
- Optional native deps (`better-sqlite3`, `node-pty`) in `optionalDependencies`; core CLI proven to work without them via `npm run e2e` (`scripts/e2e-smoke.mjs`: pack → clean-dir `--omit=optional` install → assert modules absent → report/server degradation checks).
- Naming caveat: unscoped `agentconfiging` must be owned by the publishing account; `@capabletooling/agentconfiging` is the scoped fallback (bead `agentconfig-fy8.3`).
- Recommended path: tag-driven CI publish with provenance via `.github/workflows/publish.yml` (exists; triggers on `v*.*.*`, runs lint/typecheck/test/build/e2e, then `npm publish --provenance --access public` with `NPM_TOKEN`).
- Manual local publish documented as the no-provenance fallback.
- Post-publish verification: `npx agentconfiging@latest report` in a scratch repo.

### License posture

`docs/LICENSE-AUDIT.md` (2026-07-27) is thorough and current:

- Project MIT; all runtime + optional deps are MIT/ISC/BSD-3-Clause, zero copyleft.
- `lightningcss` (MPL-2.0) is build-time-only via Vite devDependency, not shipped — recorded, no action needed.
- Provenance of ported code is exclusively the team-owned `../markdowning` (sanctioned); clean-room statement for WS server, diff generator, cron parser.
- No NOTICE file required for this dependency set.

**Posture: license work is done.** Only re-run the audit if dependencies change before tag.

### Gaps found during this assessment

- **`package.json` now includes `repository`, `bugs`, and `homepage`.** The
  repository URL matches the GitHub remote, so package metadata no longer blocks
  `npm publish --provenance`. `author` and `keywords` are still missing.
- No `SECURITY.md`, no `CHANGELOG.md`, no `CONTRIBUTING.md`, no `.github/ISSUE_TEMPLATE/`.
- CI (`.github/workflows/ci.yml`) runs the complete release gate on Node 20.x
  and 22.x across `ubuntu-latest` and `macos-latest`.
- Windows remains outside the claimed matrix; its optional-native-dependency and
  path behavior is best-effort until a Windows job is added.

---

## 2. Versioning Strategy

**Launch at `0.1.0`** (the current version). Rationale:

- Semver 0.x correctly signals a young public API: the CLI surface (`launch`/`report`/`daemon`), the `report` JSON schema, and the `main`/`exports` core entry are all new and may need breaking adjustments based on early feedback. 0.x lets those land as minor bumps without violating semver.
- `1.0.0` at launch would promise stability the project hasn't earned in the wild yet (zero external users, zero published releases).
- Do **not** go below 0.1.0 (e.g. 0.0.x); the e2e-proven package and the audit justify a "usable first release" signal.

Policy after launch (document in README or CONTRIBUTING):

- 0.x: breaking changes bump **minor**, fixes bump **patch**.
- Treat the `report` command's JSON output and exit-code contract as the de-facto public API for CI users — call out changes to it explicitly in release notes.
- Promote to `1.0.0` once the report schema and CLI flags have survived a few releases unchanged.

---

## 3. Release Checklist

### 3.1 Quality gates (all must pass at the release commit)

```bash
npm ci                # from lockfile, clean node_modules
npm run release:gate  # lint → typecheck → test → build → packaging e2e → browser e2e
```

- [ ] The release gate passes locally on the exact commit to be tagged. It uses
  npm scripts/direct binaries, not an editor, RTK, or proxy wrapper.
- [ ] CI green on `main` for that commit (Node 20.x and 22.x on Linux and macOS).
- [ ] Merge or explicitly defer the `code-review-fixes` branch — do not tag a release while review fixes sit unmerged.

### 3.2 Package contents verification

- [x] The packaging e2e reads npm's generated manifest and requires
  `dist/{cli,server,core}` JS, the web shell and all recursively referenced web
  assets, `LICENSE`, `README.md`, and `package.json`.
- [ ] Confirm **absent**: `src/`, tests, `*.map`, `fixtures/`, `opendesign/`, `.beads/`, docs, any `.env`-like or local-config files.
- [x] The packaging e2e imports the installed core bundle and validates its
  embedded, nonempty offline registry seed. The gate derives the entry count at
  runtime rather than duplicating a stale hardcoded count.
- [ ] `npm pack` (real tarball), then `tar -tzf` as a second pair of eyes; the e2e script already installs from this tarball.

### 3.3 npx cold-start testing (clean machine/directory)

The e2e script covers pack→install→report. Before launch, additionally test the human path:

- [ ] In a scratch directory that is **not** a repo and has no agent config: `npx agentconfiging` — should start, print the tokenized URL, open the browser, and render an empty-but-sane UI (no crash on zero detections).
- [ ] In a real repo with Claude Code config: full launch, inspector renders, terminal (PTY) works, a write shows a diff preview.
- [ ] With optional deps failing to build (simulate: `npm install --omit=optional` of the tarball): `launch` and `report` still work; features needing `node-pty`/`better-sqlite3` degrade with a clear message rather than crash.
- [ ] Cold npx cache: `npx --ignore-existing`-style fresh fetch after publish (`npx agentconfiging@latest report`) — this is the post-publish smoke in PUBLISHING.md; keep it.
- [ ] Node 20.19 (minimum) and Node 22 (current supported line) at least once each.

### 3.4 Cross-platform notes

- **macOS and Linux** — every push and pull request runs the full gate on both
  Node lines. GitHub-hosted runner Chrome is located explicitly, its version is
  printed, and absence fails the job before `e2e:browser`; there is no skip path.
- **Windows** — **currently untested anywhere.** Risks specific to this codebase:
  - `node-pty` on Windows needs prebuilds (or windows-build-tools); it's optional, so the terminal must degrade gracefully — verify the degradation path on Windows, not just the absence path on macOS.
  - Path handling: the static-file traversal guard already handles `\` separators (good sign of intent); verify scanner/global-scope paths (`~/.claude` → `%USERPROFILE%`) resolve on Windows.
  - `127.0.0.1` binding and browser open (`start` vs `open` vs `xdg-open`).
  - Windows remains an explicit limitation: add `windows-latest` after the CDP
    launcher and optional-native-dependency behavior are verified there.

---

## 4. npm Publishing Hygiene

- [x] **Repository metadata required for provenance is present:**
  - `repository`: `{ "type": "git", "url": "git+https://github.com/junoddev/agentconfiging.git" }`.
  - `bugs`: `https://github.com/junoddev/agentconfiging/issues`; `homepage`: repo README URL.
- [ ] **Add the remaining optional package metadata:**
  - `author`: `Aaron Junod`.
  - `keywords`: e.g. `["ai", "agents", "claude-code", "cursor", "copilot", "codex", "agent-config", "mcp", "claude", "developer-tools", "cli", "config"]` — this is the primary lever for npm search discoverability.
- [ ] **Provenance**: publish only via the tag-driven workflow (`publish.yml` already passes `--provenance` and requests `id-token: write`). Never local-publish the launch release — provenance can't be added retroactively.
- [ ] **2FA**: publishing npm account must have 2FA enabled. Use a **granular automation token** scoped to this package for `NPM_TOKEN` (automation tokens bypass the OTP prompt in CI by design; keep the token's scope minimal). Consider npm **Trusted Publishing (OIDC)** instead of a long-lived token — it pairs naturally with the existing OIDC provenance setup and removes the secret entirely.
- [ ] **Name claim**: the 404 confirms `agentconfiging` is unclaimed today, but that's not a reservation. Decide the naming question (bead `agentconfig-fy8.3`) and publish promptly once decided; have the `@capabletooling/agentconfiging` fallback ready per PUBLISHING.md.
- [ ] **Files whitelist**: `"files": ["dist"]` is correct — keep whitelist (not `.npmignore`) as the mechanism; re-verify with the pack dry-run every release since `prepublishOnly` rebuilds.
- [ ] **README on npm**: root `README.md` ships automatically and becomes the npm landing page. It's strong (165 lines, leads with the npx one-liner). Before launch: verify all image links are **absolute** URLs (`docs/images/` relative links break on npmjs.com), and the first paragraph reads well as the npm description snippet.
- [ ] **package.json `description`**: current one is good; keep it in sync with the README tagline.

---

## 5. Security Review Before Public Launch

This tool reads config (potentially containing secrets), runs a local HTTP+WS
server, exposes a real terminal (PTY), and executes pipelines. The recent
security work is real and verified in-source; the list below records **what
exists** and **what to double-check** before strangers run it.

### Verified present (with locations)

| Control | Where | Notes |
|---|---|---|
| Per-session bearer token, every `/api` request | `src/server/app.ts` | SHA-256 + `timingSafeEqual`; app holds only the hash; token travels in URL fragment then Authorization header; **no** `?token=` fallback |
| Host allowlist (DNS-rebinding defense) | `src/server/app.ts` | Host must be exactly `127.0.0.1:<port>` / `localhost:<port>`, else 403 |
| Origin/CSRF gate | `src/server/app.ts` | Origin allowlist on all `/api`; state-changing methods must prove same-origin (Origin or `Sec-Fetch-Site: same-origin`); no CORS headers ever |
| Security headers | `src/server/app.ts` | `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` |
| Static-file hardening | `src/server/app.ts` | Percent-decoded `..` rejection (both separators), realpath canonicalization so symlinks can't escape `distDir` |
| WS auth | `src/server/ws.ts` | Token via `Sec-WebSocket-Protocol` (fragment never sent to server); no frame written to unauthorized sockets |
| Secret redaction | `src/core/redact/` (`patterns.ts`, `redact.ts` + tests) | Server-side redaction before content hits the wire (per README); coverage expanded in commit `bf2dc7e` |
| SSRF denylist | `src/server/pipeline/runtimes.ts` and `src/core/registry/client.ts` | Private-range denylist; registry hosts are DNS-checked immediately before each request; redirects are followed **manually**, re-gated on every hop, and bounded |
| Pipeline exec gating | `src/server/pipeline/runtimes.ts` (`runBashDisabled`) | Bash nodes refuse to run unless launched interactively — headless daemon never executes author-supplied shell |
| Child env hygiene | `src/server/pipeline/runtimes.ts` | Session token never exported to children; denylist of token-shaped env vars stripped (`STRIPPED_ENV_KEYS`) |
| Git exec hardening | `src/server/pipeline/runtimes.ts` | Enumerated read-only subcommand allowlist, strict arg charset, `..` refused, arg-array exec (no shell) |

### Double-check before launch

- [ ] **Redaction breadth**: run the artifact browser over a fixture containing current-format secrets (Anthropic `sk-ant-`, OpenAI `sk-proj-`, GitHub `ghp_`/`github_pat_`, AWS `AKIA`, Slack `xoxb-`, generic `Bearer`/`.env` pairs, private key PEM blocks) and confirm every one renders redacted. Confirm redaction also applies to the **write/diff preview** and **WS-pushed report diffs**, not just the initial artifact read.
- [ ] **Token lifecycle**: token is per-session and random — confirm entropy source (`crypto.randomBytes`, ≥128 bits), confirm it's never logged (server logs, Ink status pane, error paths), and that PTY child environments are scrubbed (the module header claims this — test it: `env | grep -i token` inside the served terminal).
- [ ] **PTY exposure**: the terminal is arbitrary code execution by design. Confirm PTY creation is only reachable through token+Origin-gated routes and only when interactive; confirm the WS gating covers the PTY channel specifically.
- [ ] **SSRF denylist completeness**: verify `isBlockedHttpHost` covers `0.0.0.0`, `::1`/IPv6 loopback, IPv4-mapped IPv6 (`::ffff:127.0.0.1`), link-local `169.254.0.0/16` (cloud metadata `169.254.169.254`), and decimal/octal IP encodings; confirm DNS resolution happens **once** and the connection uses the checked address (or that per-redirect re-gating closes the rebind window). Also confirm the registry client (`src/core` registry + marketplace fetches) goes through the same gate, not just pipeline HTTP nodes.
- [ ] **Write API scope**: confirm every write path is confined to the project root / known global config dirs (the `WriteScope` model in runtimes.ts suggests yes) and that symlinked config files can't redirect writes outside scope (`O_NOFOLLOW` is referenced — verify it's applied on the write path).
- [ ] **Registry/marketplace installs**: checksum verification and provenance stamping are claimed in the README — verify the checksum is enforced (hard fail, not warn) and the 40-entry seed snapshot pins checksums.
- [ ] **`report` command in CI contexts**: confirm it never includes raw file contents with secrets in its JSON output (it's designed to be piped/uploaded by users).
- [ ] **Daemon mode**: confirm `daemon` binds the same 127.0.0.1-only listener (or no listener) and inherits the bash-disabled posture (`runBashDisabled`) — this is the mode most likely to run unattended.
- [ ] **Dependency audit at tag time**: `npm audit --omit=dev` clean (or triaged) on the release commit; lockfile committed.
- [ ] Consider a quick external eyes pass: run the repo's own `/security-review` skill or an equivalent focused review of `src/server/` before tagging.

---

## 6. CI/CD Recommendations

Current release gate:

- `npm run release:gate` is the one command for lint, typecheck, unit tests,
  build, packed-install e2e, and real-browser CDP e2e.
- `npm run test:security` is the independently runnable adversarial regression
  gate and is also invoked by `release:gate`. It reproduces the gxo.3 dangling
  symlink/ENOENT write, 0zm.4 reserved-namespace poisoning, gxo.1 token URL leak,
  np8.7 fix.patch secret carriage, upstream-port ReDoS payload, and 0zm.7
  registry SSRF incidents, including private DNS answers and internal redirect
  targets, plus the full server-output canary leak sweep. Its manifest asserts
  the exact executed count for every incident/sweep so
  selector drift or deleted cases fail the command. Keep it mandatory while
  71h.11 write-path hardening follow-ups remain open.
- `ci.yml` runs that command on Node 20.x/22.x and Ubuntu/macOS for pushes and
  pull requests. Chrome setup is explicit and must succeed.
- `publish.yml` invokes the identical command before npm publish, on Node 22 and
  Ubuntu with the same explicit Chrome check.

Recommended follow-ups:

1. **Add Windows coverage** once Chrome location and native optional dependency
   behavior are proven there; Windows is not part of the current support claim.
2. **GitHub Release automation**: extend `publish.yml` (or add a job) so a `v*` tag also creates a GitHub Release with generated notes (`gh release create "$TAG" --generate-notes` or `softprops/action-gh-release`). Keeps npm version, git tag, and release notes atomic.
3. **Changelog discipline**: adopt Keep a Changelog format in `CHANGELOG.md`; the publish workflow can lift the tag's section into the GitHub Release body. Full release-please/changesets automation is overkill for a single-package repo at 0.x — revisit if release cadence grows.
4. **Pin workflow actions by SHA** (supply-chain hygiene for a security-conscious tool): `actions/checkout@<sha>`, `actions/setup-node@<sha>`.
5. **Switch `NPM_TOKEN` to npm Trusted Publishing (OIDC)** when convenient — removes the long-lived secret; the workflow already has `id-token: write`.
6. Optional post-launch: a scheduled weekly CI run to catch upstream/dependency breakage between releases; Dependabot or Renovate for dependency PRs.

---

## 7. Support Readiness

None of these exist yet; all are plain-file additions:

- [ ] **`SECURITY.md`** (root): private reporting channel (GitHub private vulnerability reporting is the low-friction choice — enable it in repo settings), supported-versions statement (latest 0.x only), response-time expectation. For a tool that opens a local server + terminal, a security policy is a credibility requirement, not a nicety.
- [ ] **Issue templates** (`.github/ISSUE_TEMPLATE/`): `bug_report.yml` (ask for OS, Node version, install method npx/global, whether optional native deps built, and `agentconfiging report` output *with a reminder to check for secrets*), `feature_request.yml`, and `config.yml` pointing security reports to the SECURITY.md channel instead of public issues.
- [ ] **`CHANGELOG.md`**: Keep a Changelog format; seed it with a `0.1.0` entry summarizing the launch feature set (the README's feature list is a ready-made source).
- [ ] **Release notes format**: per-release sections — Highlights / Fixes / Security / Breaking (explicit even when empty during 0.x) — mirrored between CHANGELOG.md and the GitHub Release.
- [ ] **`CONTRIBUTING.md`** (post-launch acceptable): dev setup (`npm run dev`), gate commands, pointer to `docs/ARCHITECTURE.md`, note on the bd/beads tracker if external contributors should see it.
- [ ] Enable GitHub Discussions or label conventions (`bug`, `question`, `platform:windows`, …) — post-launch.

---

## 8. Prioritized Checklist

### Launch-blocking (do before `git tag v0.1.0`)

1. [ ] **Add `author` and `keywords` to `package.json`** — repository, bugs,
   and homepage metadata are present, and provenance is unblocked; keywords
   improve npm discoverability. (§4)
2. [ ] **Decide the npm name** (unscoped `agentconfiging` vs `@capabletooling/agentconfiging`, bead `agentconfig-fy8.3`) and set `NPM_TOKEN` (or Trusted Publishing) on the repo. (§4)
3. [ ] **Merge or resolve `code-review-fixes`**; tag only a commit that is green on `main`. (§3.1)
4. [ ] **Security double-check pass** (§5): redaction fixture sweep incl. diff/WS paths, token-never-logged + PTY env scrub check, SSRF denylist edge cases (IPv6/mapped/link-local/metadata) and registry-client coverage, checksum enforcement on installs, daemon posture.
5. [ ] **Add `SECURITY.md`** and enable private vulnerability reporting. (§7)
6. [ ] **Full gate run + pack verification** on the release commit: `npm run release:gate`, `npm pack --dry-run` contents review. (§3.1–3.2)
7. [ ] **Manual npx cold-start matrix**: empty dir, real repo, `--omit=optional` degradation, Node 20 + 22; at least one Linux run and one Windows attempt (or an explicit Windows-support statement in README). (§3.3–3.4)
8. [ ] **Confirm the first full CI matrix run is green once a GitHub remote exists.** (§6)
9. [ ] **Seed `CHANGELOG.md` with the 0.1.0 entry**; fix any relative image links in README for npm rendering. (§4, §7)
10. [ ] **Publish via the tag → CI → provenance path** (never local for the launch), then post-publish smoke: `npx agentconfiging@latest report` in a scratch repo; create the GitHub Release.

### Post-launch (fast follow, first 2–4 weeks)

- [ ] Windows CI matrix; pin actions by SHA. (§6)
- [ ] GitHub Release automation from tags; changelog-to-release-notes wiring. (§6)
- [ ] Issue templates + config.yml. (§7)
- [ ] `CONTRIBUTING.md`. (§7)
- [ ] Trusted Publishing migration off `NPM_TOKEN`; Dependabot/Renovate; scheduled CI. (§6)
- [ ] Versioning policy write-up (0.x semantics, `report` JSON stability promise). (§2)
- [ ] Windows first-class support work as issues arrive (node-pty prebuilds, path edge cases). (§3.4)
