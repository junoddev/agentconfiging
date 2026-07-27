# License Audit

Bead: **agentconfig-fy8.4** (E11 Release). Audit date: 2026-07-27.

This document records the license audit for `agentconfiging`: the project
license, dependency license review, provenance of ported code, and the
clean-room originality statement. Per SPEC §2, the project is MIT and all
feature implementations must be original work — no third-party code is copied
or ported, with the single sanctioned exception of the team's own prior project
`../markdowning`.

## 1. Project license — MIT

- `LICENSE` at repo root: standard MIT text, **Copyright (c) 2026 Aaron Junod**. Verified correct.
- `package.json` `"license": "MIT"` matches.

## 2. Dependency license audit

Every runtime and optional dependency was checked (license field in each
installed `node_modules/<pkg>/package.json`, cross-checked with `npm view`).
All are permissive (MIT / ISC / BSD) — **no copyleft (GPL / AGPL / LGPL)**.

### Runtime dependencies

| Package | License | Permissive? |
|---|---|---|
| commander | MIT | Yes |
| hono | MIT | Yes |
| ink | MIT | Yes |
| react | MIT | Yes |
| react-dom | MIT | Yes |
| chokidar | MIT | Yes |
| yaml | ISC | Yes |
| smol-toml | BSD-3-Clause | Yes |
| @xterm/xterm | MIT | Yes |
| @xterm/addon-fit | MIT | Yes |
| @xyflow/react | MIT | Yes |

### Optional dependencies

| Package | License | Permissive? |
|---|---|---|
| better-sqlite3 | MIT | Yes |
| node-pty | MIT | Yes |

(better-sqlite3 is not installed in the current tree — it is optional — so its
license was confirmed via `npm view better-sqlite3 license` → MIT. node-pty is
installed and MIT.)

**Copyleft finding: none among project dependencies.** All are MIT/ISC/BSD, fully
compatible with shipping under MIT.

### Note on build-time transitive deps

A scan of the wider `node_modules` tree flagged `lightningcss` (and its native
binary) as **MPL-2.0**. This is a *build-time* transitive dependency of Vite
(a `devDependency`), used only during `vite build`. It is **not a runtime
dependency and is not shipped** in the published `dist/` bundle, so its weak
(file-level) copyleft does not affect the MIT license of the distributed
package. No action required; recorded for completeness.

## 3. Provenance — the sanctioned `../markdowning` port

SPEC §3 sanctions inheriting from `../markdowning`, the team's own prior project
(no third-party license issue). The port is explicitly attributed in-source and
in the bead close reasons:

- **Scanner path tables** — `src/core/scanner.ts`: `KNOWN_FILES` / `KNOWN_DIRS`
  / `SKIP_DIRS` / `ALLOWED_EXTS` / caps lifted verbatim from markdowning's
  `cli/src/verticals/agentconfig/scanner.js`, with documented additive
  extensions (`ADDITIONAL_KNOWN_FILES`, `GLOBAL_SKIP_DIRS`).
- **Redaction patterns** — `src/core/redact/patterns.ts`: from markdowning's
  `redact_patterns.js`.
- **Detector signal sets** — `src/core/detectors/*`: 8 runtime detectors ported
  1:1 from markdowning's Elixir `detectors.ex` + modules.
- **Analyzers** — `src/core/analyzers/*`: each file headers its status
  (`PORTED` / `UPGRADED`) relative to markdowning's Elixir analyzers.

All of the above name `../markdowning` as the source. No external tool is named
as a source anywhere in `src/` or `web/`.

## 4. Clean-room originality statement

A scan of `src/` and `web/` for copied-code markers — foreign `Copyright (c)`
lines, `GPL`/`AGPL`/`LGPL` headers, `SPDX-License-Identifier`, `@license`,
`vendored from`, `copied from` — found **no third-party license headers or
attributions**. The only provenance markers present point to `../markdowning`
(team-owned, sanctioned).

Components that mainstream projects usually pull from a package were hand-rolled
as dependency-free clean-room implementations, each documented as such with its
originating bead:

- **WebSocket server** — `src/server/ws.ts` ("Clean-room WebSocket server,
  dependency-free"; not the `ws` package).
- **Unified diff generator** — `src/server/diff.ts` (dependency-free LCS-based
  unified diff; no diff library).
- **Cron parser / scheduler** — `src/server/scheduler.ts` +
  `src/server/schedule/` (own `parseCron`).
- Plus the fuzzy/word-count heuristics in `src/core/analyzers/shared.ts`.

**Finding: no copied third-party code detected.** The codebase is original work
plus the sanctioned team-owned `../markdowning` port.

## 5. NOTICE / attribution

- All dependencies are MIT / ISC / BSD-3-Clause. MIT and ISC require only that
  their own copyright + permission notice travel with copies of *their* source;
  this is satisfied by the license files bundled in each `node_modules/<pkg>`.
  BSD-3-Clause (smol-toml) adds a no-endorsement clause but no separate NOTICE
  obligation.
- **A NOTICE file is not required** for this dependency set. None of the deps
  carry an Apache-2.0 `NOTICE` (which would need propagating), and none impose a
  separate attribution-file requirement.
- The published web bundle inlines react / react-dom / @xterm / @xyflow into
  `dist/web`. All are MIT, which permits redistribution (including minified/
  bundled) provided the MIT permission notice is retained. Standard practice for
  an MIT project; no additional NOTICE obligation is triggered.

## Summary

MIT license verified. All runtime + optional dependencies are permissive
(MIT/ISC/BSD) with zero copyleft. Ported code is exclusively from the
team-owned `../markdowning` and is attributed. No copied third-party code found.
No NOTICE file required.
