# Agent profile coverage and ownership

The canonical roster has eight first-class runtimes and seven profile-sync targets. A profile's
source manifest records questions to audit; it does **not** assert that the product supports every
listed capability. Facts without promoted, claim-level evidence remain `unknown`. Only explicit
vendor evidence that a capability does not exist may justify `unsupported`.

## Operating matrix

| Runtime | Tier | Owner | Volatile review | Stable review |
| --- | --- | --- | --- | --- |
| Aider | first-class | `runtime-maintainers/aider` | weekly | monthly |
| Amazon Q Developer | sync target | `runtime-maintainers/amazon-q` | weekly | monthly |
| Claude Code | first-class | `runtime-maintainers/claude-code` | weekly | monthly |
| Cline | sync target | `runtime-maintainers/cline` | weekly | monthly |
| OpenAI Codex | first-class | `runtime-maintainers/codex` | weekly | monthly |
| Continue | first-class | `runtime-maintainers/continue` | weekly | monthly |
| GitHub Copilot | first-class | `runtime-maintainers/copilot` | weekly | monthly |
| Cursor | first-class | `runtime-maintainers/cursor` | weekly | monthly |
| Gemini CLI | first-class | `runtime-maintainers/gemini-cli` | weekly | monthly |
| JetBrains Junie | sync target | `runtime-maintainers/junie` | weekly | monthly |
| opencode | first-class | `runtime-maintainers/opencode` | weekly | monthly |
| Qodo | sync target | `runtime-maintainers/qodo` | weekly | monthly |
| Roo Code | sync target | `runtime-maintainers/roo` | weekly | monthly |
| Windsurf | sync target | `runtime-maintainers/windsurf` | weekly | monthly |
| Zed | sync target | `runtime-maintainers/zed` | weekly | monthly |

Volatile review covers settings, models, tools, hooks, commands, skills, MCP, extensions, and
history. Stable review covers instruction paths, formats, scopes, layouts, and load behavior. The
machine-readable matrix is `profileCoverageMatrix()`; the canonical cadence and ownership records
are in `RUNTIME_SOURCE_MANIFESTS`.

Owner values are enforceable logical labels: manifest tests require exactly one label per runtime and
the review policy requires human approval. They are not GitHub identities. Repository `CODEOWNERS`
integration is deferred until maintainers supply real teams or handles; these labels must not be
silently translated into invented accounts.

Capability freshness is the worst status among required sources that cover that capability. Optional
sources neither improve nor degrade the rollup. If no required source covers an area, its freshness is
`unavailable`; this is distinct from claiming the capability is unsupported.

## Review rules

1. The runtime owner reviews ordinary additions and evidence refreshes.
2. A second maintainer reviews removals, deprecations, paths/layouts, settings contracts,
   permissions, defaults, and security-sensitive changes.
3. A reviewer must open the cited official source and confirm that each locator supports the exact
   claim. Search snippets, third-party summaries, and model memory are not evidence.
4. Failed retrieval, missing text, ambiguous prose, or an extractor returning no facts is recorded
   as uncertainty. It is never removal evidence.
5. Golden fixtures under `fixtures/profiles/` protect the current projected instruction behavior
   for every runtime. Updating a fixture requires the same evidence and review as the profile fact.

## Claim-to-source ledger

The baseline instruction claims retain their per-fact `Evidence` records and use these official or
upstream-maintained references:

- [Aider conventions](https://aider.chat/docs/usage/conventions.html)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Continue rules](https://docs.continue.dev/customize/deep-dives/rules)
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
- [Cursor documentation](https://cursor.com/docs)
- [Gemini CLI upstream repository](https://github.com/google-gemini/gemini-cli)
- [opencode rules](https://opencode.ai/docs/rules/)
- [Amazon Q Developer documentation](https://docs.aws.amazon.com/amazonq/)
- [Cline rules](https://docs.cline.bot/features/cline-rules)
- [JetBrains Junie](https://www.jetbrains.com/junie/)
- [Qodo documentation](https://docs.qodo.ai/)
- [Roo Code custom instructions](https://docs.roocode.com/features/custom-instructions)
- [Windsurf memories and rules](https://docs.windsurf.com/windsurf/cascade/memories)
- [Zed rules](https://zed.dev/docs/ai/rules)

## Current uncertainty

The baseline import did not retain source snapshots. Consequently its sources are `unavailable`
until a successful audit stores content-addressed evidence. The Claude settings, model, tool, and
hook inventories are migrated internal snapshots and remain `unknown`; no new capability facts are
promoted by this coverage rollout. The Amazon Q, Junie, and Qodo baseline links are broad product
documentation rather than precise configuration references, so their instruction facts also remain
unknown pending a cited candidate and review. The current Cline page documents the rules directory
but does not establish the lifecycle of the legacy single-file entry, so that entry is not removed or
reclassified. The Zed page could not be independently retrieved during this review; its existing
baseline claim remains unchanged and unavailable rather than being treated as disproven.
