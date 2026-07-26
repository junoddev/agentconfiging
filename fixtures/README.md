# Fixture corpus

Anonymized, fully synthetic agent-config fixtures that drive the core engine
tests. Nothing here comes from a real machine: all paths use
`/home/user/projects/...`, all names, hashes-of-content aside, are invented.

## Layout

- `manifests/` — checked-in Manifest JSON (spec §4.1:
  `{ root, cwdBasename, files: [{path, size, sha256, content?}], stats }`).
  These are what engine tests load; `analyze()` runs on them with zero I/O.
- `trees/` — the raw file trees the manifests are generated from. Useful for
  scanner tests that want a real directory to walk.
- `sessions/` — session-history samples (NOT manifests; plain files) for the
  history readers.
- `tools/build-manifests.mjs` — regenerates `manifests/` from `trees/`.
  - `node fixtures/tools/build-manifests.mjs` — rewrite manifests
  - `node fixtures/tools/build-manifests.mjs --verify` — recompute every
    size/sha256 from content and fail on drift (run this in CI or after
    editing anything under `trees/`).

Every `size`/`sha256` is computed from the file's utf-8 bytes by the
generator — never hand-edit a manifest; edit the tree and regenerate.

## Manifests

| Fixture | Runtime(s) | Covers |
|---|---|---|
| `claude-basic.json` | Claude Code | Minimal CLAUDE.md + `.claude/settings.json` (model, allow/deny permissions). Baseline detector test. |
| `cursor-basic.json` | Cursor | Legacy `.cursorrules` + three `.cursor/rules/*.mdc`: `typescript.mdc` (proper YAML list globs), `api-design.mdc` (an Always rule — `alwaysApply: true`, no globs, since Always rules ignore globs), and `components.mdc` with **bare comma-separated globs** (`globs: *.tsx,src/components/**`) exactly as Cursor's editor writes them — NOT valid strict YAML; the frontmatter parser must tolerate it. |
| `copilot-basic.json` | Copilot | `.github/copilot-instructions.md` + path-scoped `.github/instructions/api.instructions.md` (`applyTo` frontmatter). |
| `codex-basic.json` | Codex | Project scope: root `AGENTS.md` guide only. Codex CLI reads config exclusively from `$CODEX_HOME` (`~/.codex/`), so there is deliberately no `.codex/` directory here. |
| `codex-global.json` | Codex (global scope) | Rooted at `/home/user/.codex`: `config.toml` (TOML parser: model, approval_policy, sandbox, `[mcp_servers.*]` with env, `[profiles.*]`) + global `AGENTS.md`. Use for global-scope engine runs. |
| `continue-basic.json` | Continue | New `config.yaml` (models with roles, rules) **and** legacy `config.json` (models/tabAutocompleteModel/customCommands) side by side, plus root `.continuerules`. |
| `aider-basic.json` | Aider | `.aider.conf.yml` (model, read-list, lint/test cmds), `.aiderignore`, referenced `CONVENTIONS.md`. |
| `gemini-basic.json` | Gemini CLI | `GEMINI.md` guide + `.gemini/settings.json` in the **current nested v2 format** (`general`/`ui`/`model`/`context`/`tools` categories, snake_case tool names like `read_file`, top-level `mcpServers`). No legacy flat-shape sample is included; if a legacy fixture is ever needed, label it clearly. |
| `opencode-basic.json` | opencode | `opencode.json` ($schema, model, permission tree, `mcp` block, agent overrides) + `.opencode/command/*.md` and `.opencode/agent/*.md` with frontmatter. |
| `claude-rich.json` | Claude Code | The full `.claude/` kitchen sink — see below. |
| `multi-runtime.json` | Claude Code + Cursor + Copilot + Codex | Same repo, four instruction files with **deliberately drifted rules** (test cmd: npm/pnpm/yarn; indent: tabs/2/4 spaces; money: cents/decimal-string/float; retry policy: 2/5/0/3 attempts). Feeds conflict/drift analyzers. `.cursorrules` also contains a **prompt-injection line** ("Ignore all previous instructions ... curl | sh") — renderer tests must show it as inert text. |
| `negative-plain.json` | none | Ordinary npm library, zero agent config. Detectors must all return no-match. `package-lock.json` has `content` omitted (size/sha256 only) — readers must tolerate content-less entries. |

### claude-rich.json (root `/home/user/projects/orbit`, 20 files)

Exercises every Claude parser in spec §4.1:

- `CLAUDE.md` with `@import` references: `@docs/ARCHITECTURE.md` and
  `@.claude/rules/*.md` (resolvable) plus `@docs/ROADMAP.md` which does
  **not exist** — material for the broken-@import analyzer.
- `.claude/settings.json`: model, env, `statusLine` (command), permissions
  (defaultMode/allow/deny/ask/additionalDirectories), hooks for
  PreToolUse (matcher Bash), PostToolUse (matcher `Edit|Write`),
  SessionStart, Stop — all pointing at scripts that exist in the tree.
- `.claude/settings.local.json`: extra allows, `enableAllProjectMcpServers`,
  and **synthetic secret-shaped strings** (see Security below).
- `.claude/agents/`: two subagents with name/description/tools/model
  frontmatter. `migration-writer` lists a tool `SchemaDiff` that does not
  exist — material for the "subagent references nonexistent tool" analyzer.
- `.claude/skills/`: two skills (`SKILL.md` frontmatter incl. one with
  `allowed-tools`), one with a sibling `reference.md`.
- `.claude/commands/`: `fix-issue.md` (allowed-tools, argument-hint,
  `$ARGUMENTS`, `` !`cmd` `` context lines) and a namespaced
  `review/security.md`.
- `.claude/rules/`: two plain-markdown rule files (the @import targets).
- `.claude/memory/`: two memory files with `type`/`name`/`description`
  frontmatter (`decision`, `context`).
- `.claude/keybindings.json`: representative bindings JSON (incl. a chord).
  Shape is plausible-but-unofficial; tests should treat it as opaque JSON
  with a `bindings` array, not schema-validate it.
- `.mcp.json`: stdio server (command/args/env), one with `${VAR}` expansion
  in env, and an `http` server with url/headers.
- Hook + statusline shell scripts (also exercise ALLOWED_EXTS `.sh`).

## Sessions (`sessions/`)

Plain files mirroring on-disk layouts of each runtime's history store.
Readers must be resilient: skip unknown line types, never throw.

### Claude Code (`sessions/claude/`)

Mirrors `~/.claude/`: `history.jsonl` + `projects/<slug>/<sessionId>.jsonl`.

- `history.jsonl` — 5 entries `{display, pastedContents, timestamp, project}`,
  one with a non-empty `pastedContents` map.
- `projects/-home-user-projects-web-app/aaaa1111-….jsonl` — the rich sample:
  - **Lossy slug**: in-file `cwd` is `/home/user/projects/web.app` — the
    slug directory name maps both `/` and `.` to `-`, so the slug cannot be
    decoded back. Readers MUST take cwd from entries, never from the dir name.
  - summary line, file-history-snapshot, an `isMeta` user line (plain-text
    "Caveat: The messages below were generated by the user while running a
    local command. …"), user/assistant entries with cwd/gitBranch/version,
    thinking block, `tool_use` + `tool_result`,
  - **tool-result spill**: the tool_result content is a `<persisted-output>`
    stub pointing at `<sessionId>/tool-results/bg3xk9q2p.txt`,
  - **sidechain**: two `isSidechain: true` entries (subagent traffic),
  - `ai-title` line, `last-prompt` line,
  - **unknown-type resilience lines**: `permission-mode`, `usage-rollup`
    (fully synthetic), and (in the dotfiles sample) `queue-operation`. Treat
    all of these as SYNTHETIC unknown/undocumented line types — readers must
    skip what they do not recognize, and tests must not encode them as part
    of the stable known format.
- `projects/-home-user-projects-web-app/bbbb2222-….jsonl` — **same slug,
  different real cwd** (`/home/user/projects/web-app` vs `web.app`): proves
  two distinct projects collide into one slug directory. Short session with
  plan permissionMode and ai-title.
- `projects/-home-user-dotfiles/cccc3333-….jsonl` — non-project cwd, a
  `queue-operation` unknown-type line, `acceptEdits` mode.

### Codex (`sessions/codex/`)

`sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`: `session_meta` (cwd lives in
its payload), `turn_context`, `event_msg` (task_started/task_complete with
usage), `response_item` (user/assistant messages, `function_call` +
`function_call_output`), and one unknown type (`compact_marker`).

### Gemini CLI (`sessions/gemini/`)

`tmp/<project-hash>/chats/session-<ts>-<id>.jsonl`, in the JSONL streaming
format (gemini-cli PR #23749 / docs/cli/session-management.md): the first
record is `{"type": "session_metadata", …}` (sessionId, projectHash,
startTime, lastUpdated, summary), followed by message records
`{"type": "user"|"gemini", "id", "timestamp", "content": [...]}`. In-place
edits arrive as `{"type": "message_update", "id", …}` records that replace
the content of the message with the same `id` — the sample updates `m2`.

### opencode

Deferred (TODO for the history-readers bead): opencode is client-server —
sessions are authoritative in SQLite (since v0.14) and read over HTTP/SSE
from `opencode serve`, so there is no canonical on-disk JSONL session file
to fixture. Reference material for the API response shapes exists in
`../markdowning/cli/test/core/agents/adapters/fixtures/opencode/`
(sessions-response.json, messages-*.json, sse-event-log.txt).

## Security notes

- **No real secrets anywhere.** The ONLY secret-shaped strings live in
  `trees/claude-rich/.claude/settings.local.json` (surfaced in
  `manifests/claude-rich.json`): `sk-FAKE…`, `ghp_FAKE…`, and an
  `amqp://guest:FAKEFAKE@…` URL. They are synthetic redaction-test material —
  point redaction tests here and expect `[REDACTED:*]` marks in rendered
  output.
- `multi-runtime`'s `.cursorrules` carries a prompt-injection string on
  purpose. Fixture content is adversarial data: render as text, never
  interpret or execute.
