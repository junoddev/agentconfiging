# Scheduled profile refresh

`profile-refresh.yml` checks the canonical, allowlisted upstream sources without directly editing canonical profiles.

- Daily runs conditionally check only volatile sources and refresh source/cache metadata; they do not extract, diff, or generate candidates.
- Monday runs perform extraction and semantic diff for volatile sources only, using the persisted evidence cache.
- Runs on the first day of a month discard the cache and audit every stable and volatile source.
- Manual runs can select a profile and exact canonical source, force a clean cache, or suppress PR creation with dry-run.

Each runtime always emits a result and completion record in an isolated matrix job. Drift (audit exit 1) is collected as a candidate artifact; fetch failure (2), invalid output (3), and usage failure (64) fail only that runtime. The aggregation job creates or updates one fixed refresh branch, so repeated runs update a single review PR. Failed or missing runtimes are unresolved and can never close an existing PR. Only a complete successful matrix with no candidates may close a stale refresh PR. Candidates, results, errors, and a machine-readable risk manifest are retained for 14 days.

The workflow never promotes candidates or merges PRs. Every generated update requires human review. Removals and changes involving instruction paths/layout, settings contracts, permissions, defaults, security, or deprecations are explicitly marked high risk.

A changed source without a deterministic extractor produces a candidate with snapshot provenance,
an explicit `manual-extraction-required` uncertainty, and high review risk. It is not reported clean
and does not invent capability facts. An exact manual source selector overrides cadence filtering.

The complete runtime ownership, cadence, provenance rules, coverage matrix, and known uncertainty
are documented in [PROFILE_COVERAGE.md](./PROFILE_COVERAGE.md).

## Operator workflow

1. Run `npm run profiles:list` for the content-safe support summary, or `npm run profiles:show -- <runtime>` for one profile. These views intentionally omit evidence bodies and hashes, promotion records, model prompts/output, cache paths, and internal diagnostics.
2. Run `npm run profiles:audit -- <runtime>` for a focused check, or dispatch the scheduled workflow for the normal isolated matrix run.
3. Inspect the candidate artifact and risk manifest. Resolve every failed or unavailable source; absence is never evidence of removal.
4. Review high-risk semantic changes manually, run the release gate, and promote only through the reviewed-candidate path. The Profiles UI and `/api/profiles` endpoints expose only safe coverage/freshness status and source links.

The hosted CI workflow is the canonical schedule. Operators who need offline or self-hosted checks may wrap `npm run profiles:refresh -- --cadence weekly` in their OS scheduler (for example, a user-level launchd timer or systemd timer) and point `AGENTCONFIGING_STATE_DIR` at a private, access-controlled directory. That wrapper is optional: it must not auto-promote candidates, serve its cache directory, or replace the repository workflow as the source of scheduling policy. The ordinary `agentconfiging daemon` schedules local pipelines and is not the canonical profile-refresh scheduler.
