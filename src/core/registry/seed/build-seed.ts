/**
 * build-seed.ts — regenerate (and verify) src/core/registry/seed/index.json.
 *
 * The seed snapshot is the in-package mirror of what the external
 * `agentconfig-registry` repo publishes (SPEC §4.5 + §5 row 14): a static
 * index.json holding the starter template gallery. This script is the single
 * source of truth for that content — like fixtures/tools/build-manifests.mjs,
 * the payloads live here and the committed JSON is a generated artifact.
 *
 * Every file's sha256 is COMPUTED from its UTF-8 bytes with the same hasher
 * the runtime verifier uses (verifyEntry / sha256Hex from ../verify.ts), so
 * the seed is guaranteed to pass verifyEntry — the seed-integrity test then
 * re-checks that independently.
 *
 * Usage (run from repo root):
 *   npx tsx src/core/registry/seed/build-seed.ts            # write index.json
 *   npx tsx src/core/registry/seed/build-seed.ts --verify   # check it matches
 *
 * All content below is ORIGINAL, clean-room starter config — no secrets, no
 * payload that executes on install (hook/MCP entries are config snippets that
 * a runtime may later run; installing them only writes files).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegistryEntry, RegistryEntryKind, RegistryIndex } from '../schema.js';
import { sha256Hex, verifyEntry } from '../verify.js';

const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(SEED_DIR, 'index.json');

const SEED_SOURCE = 'agentconfig-seed';
const SEED_VERSION = '1.0.0';

interface FileSpec {
  path: string;
  content: string;
}
interface EntrySpec {
  kind: RegistryEntryKind;
  name: string;
  description: string;
  tags: string[];
  files: FileSpec[];
  version?: string;
}

function entry(spec: EntrySpec): RegistryEntry {
  return {
    kind: spec.kind,
    name: spec.name,
    description: spec.description,
    version: spec.version ?? SEED_VERSION,
    source: SEED_SOURCE,
    tags: spec.tags,
    files: spec.files.map((f) => ({
      path: f.path,
      content: f.content,
      sha256: sha256Hex(f.content),
    })),
  };
}

/** A Claude-Code-style skill file (SKILL.md with YAML frontmatter). */
function skillFile(name: string, description: string, body: string): FileSpec {
  return {
    path: `.claude/skills/${name}/SKILL.md`,
    content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  };
}

/** A subagent file (frontmatter + system prompt body). */
function subagentFile(name: string, description: string, tools: string, body: string): FileSpec {
  return {
    path: `.claude/agents/${name}.md`,
    content: `---\nname: ${name}\ndescription: ${description}\ntools: ${tools}\n---\n\n${body}\n`,
  };
}

/** A rule file (plain markdown guidance). */
function ruleFile(name: string, body: string): FileSpec {
  return { path: `.agents/rules/${name}.md`, content: `${body}\n` };
}

/** A slash-command file. */
function commandFile(name: string, body: string): FileSpec {
  return { path: `.claude/commands/${name}.md`, content: `${body}\n` };
}

/** A JSON config snippet (hooks, MCP). Config data only — never run on install. */
function jsonFile(p: string, obj: unknown): FileSpec {
  return { path: p, content: JSON.stringify(obj, null, 2) + '\n' };
}

const skills: RegistryEntry[] = [
  entry({
    kind: 'skill',
    name: 'git-commit-helper',
    description: 'Draft clear, conventional commit messages from a staged diff.',
    tags: ['template', 'skill', 'git'],
    files: [
      skillFile(
        'git-commit-helper',
        'Write a conventional commit message for the staged changes.',
        `# Git Commit Helper\n\nWhen asked to write a commit message:\n\n1. Read the staged diff (\`git diff --cached\`).\n2. Pick one type: feat, fix, docs, refactor, test, chore, perf.\n3. Write a <=72 char summary in the imperative mood ("add", not "added").\n4. Add a body only when the *why* is not obvious from the summary.\n5. Never invent changes that are not in the diff.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'pr-description-writer',
    description: 'Turn a branch diff into a reviewer-friendly pull request description.',
    tags: ['template', 'skill', 'git', 'review'],
    files: [
      skillFile(
        'pr-description-writer',
        'Compose a PR description with summary, changes, and test notes.',
        `# PR Description Writer\n\nProduce a description with these sections:\n\n- **Summary** — one paragraph on the intent.\n- **Changes** — a bullet per meaningful change, grouped by area.\n- **Testing** — how it was verified (commands, cases).\n- **Risk** — anything a reviewer should scrutinise.\n\nKeep it factual. Link issues by id; do not fabricate ticket numbers.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'changelog-updater',
    description: 'Add a Keep-a-Changelog entry for a set of merged changes.',
    tags: ['template', 'skill', 'docs'],
    files: [
      skillFile(
        'changelog-updater',
        'Append a changelog entry under the Unreleased heading.',
        `# Changelog Updater\n\nFollow the Keep a Changelog format:\n\n1. Find or create an \`## [Unreleased]\` section.\n2. Group entries under Added, Changed, Fixed, Removed, Deprecated, Security.\n3. Write each line for a human reader, present tense, no commit hashes.\n4. Do not bump the version — releasing is a separate step.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'unit-test-scaffolder',
    description: 'Generate a table-driven test skeleton for a target function.',
    tags: ['template', 'skill', 'testing'],
    files: [
      skillFile(
        'unit-test-scaffolder',
        'Scaffold unit tests covering happy path, edges, and errors.',
        `# Unit Test Scaffolder\n\nGiven a function to test:\n\n1. Identify inputs, outputs, and thrown errors.\n2. Enumerate cases: nominal, empty, boundary, and invalid input.\n3. Emit one assertion per case using the project's existing test runner.\n4. Leave a TODO where a case needs domain knowledge you lack.\n5. Never assert behaviour you have not read in the source.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'sql-query-reviewer',
    description: 'Review a SQL query for correctness, indexes, and injection risk.',
    tags: ['template', 'skill', 'database'],
    files: [
      skillFile(
        'sql-query-reviewer',
        'Critique a SQL query for performance and safety.',
        `# SQL Query Reviewer\n\nFor a supplied query, check:\n\n- **Correctness** — joins, NULL handling, GROUP BY completeness.\n- **Performance** — sargable predicates, missing indexes, N+1 patterns.\n- **Safety** — parameterisation; flag any string-built SQL as injection risk.\n\nSuggest an EXPLAIN before recommending an index. Do not run migrations.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'regex-builder',
    description: 'Build and explain a regular expression from a plain-language spec.',
    tags: ['template', 'skill', 'text'],
    files: [
      skillFile(
        'regex-builder',
        'Construct a regex and explain each component.',
        `# Regex Builder\n\n1. Restate the matching goal and list example matches and non-matches.\n2. Build the pattern incrementally; prefer explicit character classes.\n3. Explain every group and quantifier in one line each.\n4. Warn about catastrophic backtracking for nested quantifiers.\n5. Provide the pattern in the target language's escaping.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'api-endpoint-documenter',
    description: 'Document an HTTP endpoint: method, params, responses, errors.',
    tags: ['template', 'skill', 'docs', 'api'],
    files: [
      skillFile(
        'api-endpoint-documenter',
        'Write reference docs for a single HTTP endpoint.',
        `# API Endpoint Documenter\n\nDocument, from the handler source:\n\n- Method and path, with path/query parameters and types.\n- Request body schema and required fields.\n- Success response shape and status code.\n- Each error condition with its status and message.\n\nDo not document behaviour the code does not implement.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'error-message-improver',
    description: 'Rewrite an error message to be actionable and specific.',
    tags: ['template', 'skill', 'dx'],
    files: [
      skillFile(
        'error-message-improver',
        'Improve an error message so a user knows what to do next.',
        `# Error Message Improver\n\nA good error states: what failed, why, and the next action.\n\n1. Name the operation that failed.\n2. Include the offending value (redact secrets first).\n3. Suggest a concrete fix or command.\n4. Avoid blame and internal jargon.\n5. Keep it to one or two sentences.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'dependency-upgrade-planner',
    description: 'Plan a safe dependency upgrade from a changelog and lockfile.',
    tags: ['template', 'skill', 'maintenance'],
    files: [
      skillFile(
        'dependency-upgrade-planner',
        'Assess an upgrade for breaking changes and sequencing.',
        `# Dependency Upgrade Planner\n\n1. Read the package's release notes between current and target versions.\n2. List breaking changes that touch APIs this repo uses.\n3. Order the upgrade: patch, then minor, then major, one PR each.\n4. Note the tests that must pass after each step.\n5. Do not upgrade transitive pins you do not understand.`,
      ),
    ],
  }),
  entry({
    kind: 'skill',
    name: 'log-statement-auditor',
    description: 'Audit logging for noise, secrets, and missing context.',
    tags: ['template', 'skill', 'observability'],
    files: [
      skillFile(
        'log-statement-auditor',
        'Review log statements for level, secrets, and usefulness.',
        `# Log Statement Auditor\n\nFor each log statement, verify:\n\n- **Level** is appropriate (no debug spam at info).\n- **No secrets** — tokens, passwords, PII are never logged.\n- **Context** — an id or key that makes the line searchable.\n\nFlag logs inside hot loops. Suggest structured fields over string concat.`,
      ),
    ],
  }),
];

const subagents: RegistryEntry[] = [
  entry({
    kind: 'subagent',
    name: 'bug-reproducer',
    description: 'Writes a minimal failing test that reproduces a reported bug.',
    tags: ['template', 'subagent', 'testing'],
    files: [
      subagentFile(
        'bug-reproducer',
        'Reproduce a bug as a minimal failing test before any fix.',
        'Read, Grep, Glob, Bash',
        `You reproduce bugs as tests. Given a bug report:\n\n1. Locate the relevant code by searching, not guessing.\n2. Write the smallest test that fails because of the bug.\n3. Confirm it fails for the reported reason, not an unrelated one.\n4. Hand back the failing test; do NOT fix the bug yourself.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'refactoring-assistant',
    description: 'Proposes behaviour-preserving refactors backed by existing tests.',
    tags: ['template', 'subagent', 'refactor'],
    files: [
      subagentFile(
        'refactoring-assistant',
        'Refactor code without changing behaviour, guarded by tests.',
        'Read, Edit, Grep, Glob, Bash',
        `You refactor safely. Rules:\n\n1. Confirm tests pass BEFORE changing anything.\n2. Make one structural change at a time; keep tests green.\n3. Never alter observable behaviour or public signatures without being asked.\n4. If tests are missing, say so and stop rather than refactoring blind.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'security-auditor',
    description: 'Reviews a diff for common vulnerability classes.',
    tags: ['template', 'subagent', 'security'],
    files: [
      subagentFile(
        'security-auditor',
        'Audit changes for injection, secrets, authz, and unsafe defaults.',
        'Read, Grep, Glob',
        `You audit for security issues, read-only. Check for:\n\n- Injection (SQL, shell, template) from untrusted input.\n- Hardcoded secrets or credentials.\n- Missing authorization checks on state-changing paths.\n- Unsafe deserialization or path traversal.\n\nReport findings with severity and file:line. Never exfiltrate secrets you find.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'test-coverage-improver',
    description: 'Finds untested branches and adds targeted tests.',
    tags: ['template', 'subagent', 'testing'],
    files: [
      subagentFile(
        'test-coverage-improver',
        'Add tests for the highest-value untested branches.',
        'Read, Edit, Grep, Glob, Bash',
        `You raise meaningful coverage. Steps:\n\n1. Identify uncovered branches with real failure modes (skip trivial getters).\n2. Add tests that would catch a plausible regression.\n3. Prefer clarity over count; one good test beats five redundant ones.\n4. Keep new tests deterministic and independent.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'documentation-writer',
    description: 'Writes user-facing docs grounded in the actual source.',
    tags: ['template', 'subagent', 'docs'],
    files: [
      subagentFile(
        'documentation-writer',
        'Document features accurately from the code, not assumptions.',
        'Read, Grep, Glob',
        `You write documentation grounded in source. Rules:\n\n1. Read the implementation before describing it.\n2. Show real, runnable examples where possible.\n3. Note limitations and defaults explicitly.\n4. Never document a flag or option the code does not support.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'performance-investigator',
    description: 'Traces a performance complaint to a measured hotspot.',
    tags: ['template', 'subagent', 'performance'],
    files: [
      subagentFile(
        'performance-investigator',
        'Find the measured cause of a slowdown before proposing fixes.',
        'Read, Grep, Glob, Bash',
        `You investigate performance with evidence. Steps:\n\n1. Reproduce the slow path and measure it (timing, counts).\n2. Locate the dominant cost; do not optimise on a hunch.\n3. Propose the smallest change that addresses the measured cost.\n4. Re-measure to confirm. Report before/after numbers.`,
      ),
    ],
  }),
  entry({
    kind: 'subagent',
    name: 'dependency-updater',
    description: 'Applies a planned dependency upgrade and runs the gates.',
    tags: ['template', 'subagent', 'maintenance'],
    files: [
      subagentFile(
        'dependency-updater',
        'Apply one dependency upgrade and verify the build and tests.',
        'Read, Edit, Bash',
        `You apply upgrades one at a time. Steps:\n\n1. Bump exactly one dependency to the agreed version.\n2. Run install, build, and tests.\n3. Fix only breakage caused by the upgrade; report anything larger.\n4. Do not bundle unrelated changes into the upgrade.`,
      ),
    ],
  }),
];

const rules: RegistryEntry[] = [
  entry({
    kind: 'rule',
    name: 'no-secrets-in-code',
    description: 'Forbid hardcoded credentials; require env or a secret manager.',
    tags: ['template', 'rule', 'security'],
    files: [
      ruleFile(
        'no-secrets-in-code',
        `# Rule: No secrets in code\n\nNever hardcode API keys, tokens, passwords, or connection strings.\n\n- Read secrets from environment variables or a secret manager.\n- Keep example values in \`.env.example\` with placeholders only.\n- If you spot an existing hardcoded secret, flag it — do not commit around it.`,
      ),
    ],
  }),
  entry({
    kind: 'rule',
    name: 'prefer-early-returns',
    description: 'Reduce nesting by returning early on guard conditions.',
    tags: ['template', 'rule', 'style'],
    files: [
      ruleFile(
        'prefer-early-returns',
        `# Rule: Prefer early returns\n\nHandle error and edge conditions first and return, keeping the happy path\nat the lowest indentation.\n\n- Replace \`else\` branches after a return with straight-line code.\n- Avoid pyramids of nested \`if\` blocks.\n- Keep each function's main flow readable top to bottom.`,
      ),
    ],
  }),
  entry({
    kind: 'rule',
    name: 'typescript-strict-nulls',
    description: 'Treat null and undefined explicitly under strict TypeScript.',
    tags: ['template', 'rule', 'typescript'],
    files: [
      ruleFile(
        'typescript-strict-nulls',
        `# Rule: Explicit null handling\n\nWith strict null checks on:\n\n- Do not use non-null assertions (\`!\`) to silence the compiler.\n- Narrow with checks or optional chaining before access.\n- Model "absent" as \`undefined\` and "known empty" as an empty value.\n- Prefer discriminated unions over nullable grab-bag objects.`,
      ),
    ],
  }),
  entry({
    kind: 'rule',
    name: 'consistent-error-handling',
    description: 'Handle errors with typed results or narrow catches, not swallowing.',
    tags: ['template', 'rule', 'reliability'],
    files: [
      ruleFile(
        'consistent-error-handling',
        `# Rule: Consistent error handling\n\n- Never swallow an error silently; log or propagate with context.\n- Catch the narrowest scope you can act on.\n- Add context when rethrowing (what operation, which input — redact secrets).\n- Prefer returning a typed result over throwing for expected failures.`,
      ),
    ],
  }),
  entry({
    kind: 'rule',
    name: 'descriptive-names',
    description: 'Name things for intent; ban single-letter and abbreviation soup.',
    tags: ['template', 'rule', 'style'],
    files: [
      ruleFile(
        'descriptive-names',
        `# Rule: Descriptive names\n\n- Names state intent: \`retryCount\`, not \`n\`; \`isReady\`, not \`flag\`.\n- Single letters only for tight loop indices and math conventions.\n- Avoid unexplained abbreviations; match the domain's vocabulary.\n- Booleans read as predicates (\`hasAccess\`, \`shouldRetry\`).`,
      ),
    ],
  }),
  entry({
    kind: 'rule',
    name: 'test-before-merge',
    description: 'Require passing tests and a covering test for every change.',
    tags: ['template', 'rule', 'testing'],
    files: [
      ruleFile(
        'test-before-merge',
        `# Rule: Test before merge\n\n- Every behavioural change ships with a test that would fail without it.\n- The full suite must pass locally before a PR is opened.\n- Bug fixes include a regression test reproducing the bug.\n- Do not disable or skip tests to make a build green.`,
      ),
    ],
  }),
];

const hooks: RegistryEntry[] = [
  entry({
    kind: 'hook',
    name: 'format-on-write',
    description: 'Run the formatter after a file is edited (PostToolUse hook config).',
    tags: ['template', 'hook', 'formatting'],
    files: [
      jsonFile('.claude/hooks/format-on-write.json', {
        hooks: {
          PostToolUse: [
            {
              matcher: 'Edit|Write',
              hooks: [
                {
                  type: 'command',
                  command: 'npx prettier --write "$CLAUDE_FILE_PATHS" 2>/dev/null || true',
                },
              ],
            },
          ],
        },
      }),
    ],
  }),
  entry({
    kind: 'hook',
    name: 'block-committing-secrets',
    description: 'Scan a proposed commit for secret-looking strings and block it.',
    tags: ['template', 'hook', 'security'],
    files: [
      jsonFile('.claude/hooks/block-committing-secrets.json', {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command:
                    'grep -REn "(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" . && exit 2 || exit 0',
                },
              ],
            },
          ],
        },
      }),
    ],
  }),
  entry({
    kind: 'hook',
    name: 'run-tests-on-stop',
    description: 'Run the test suite when the agent finishes a turn (Stop hook config).',
    tags: ['template', 'hook', 'testing'],
    files: [
      jsonFile('.claude/hooks/run-tests-on-stop.json', {
        hooks: {
          Stop: [
            {
              hooks: [{ type: 'command', command: 'npm test --silent || true' }],
            },
          ],
        },
      }),
    ],
  }),
  entry({
    kind: 'hook',
    name: 'lint-staged-precommit',
    description: 'Lint changed files before a commit runs (PreToolUse Bash config).',
    tags: ['template', 'hook', 'linting'],
    files: [
      jsonFile('.claude/hooks/lint-staged-precommit.json', {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                {
                  type: 'command',
                  command: 'npx eslint $(git diff --cached --name-only --diff-filter=ACM) || true',
                },
              ],
            },
          ],
        },
      }),
    ],
  }),
  entry({
    kind: 'hook',
    name: 'notify-on-completion',
    description: 'Emit a desktop notification when the agent stops (Stop hook config).',
    tags: ['template', 'hook', 'dx'],
    files: [
      jsonFile('.claude/hooks/notify-on-completion.json', {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command:
                    'command -v osascript >/dev/null && osascript -e \'display notification "Agent finished" with title "Claude Code"\' || true',
                },
              ],
            },
          ],
        },
      }),
    ],
  }),
];

const mcpServers: RegistryEntry[] = [
  entry({
    kind: 'mcp-server',
    name: 'filesystem',
    description: 'Local filesystem MCP server scoped to the project directory.',
    tags: ['template', 'mcp-server', 'filesystem'],
    files: [
      jsonFile('.mcp/filesystem.json', {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          },
        },
      }),
    ],
  }),
  entry({
    kind: 'mcp-server',
    name: 'github',
    description: 'GitHub MCP server; reads its token from the environment.',
    tags: ['template', 'mcp-server', 'github'],
    files: [
      jsonFile('.mcp/github.json', {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
          },
        },
      }),
    ],
  }),
  entry({
    kind: 'mcp-server',
    name: 'postgres',
    description: 'PostgreSQL MCP server; connection string comes from the environment.',
    tags: ['template', 'mcp-server', 'database'],
    files: [
      jsonFile('.mcp/postgres.json', {
        mcpServers: {
          postgres: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
          },
        },
      }),
    ],
  }),
  entry({
    kind: 'mcp-server',
    name: 'sqlite',
    description: 'SQLite MCP server pointed at a local database file.',
    tags: ['template', 'mcp-server', 'database'],
    files: [
      jsonFile('.mcp/sqlite.json', {
        mcpServers: {
          sqlite: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-sqlite', './data/app.db'],
          },
        },
      }),
    ],
  }),
  entry({
    kind: 'mcp-server',
    name: 'fetch',
    description: 'HTTP fetch MCP server for retrieving and reading web pages.',
    tags: ['template', 'mcp-server', 'web'],
    files: [
      jsonFile('.mcp/fetch.json', {
        mcpServers: {
          fetch: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] },
        },
      }),
    ],
  }),
  entry({
    kind: 'mcp-server',
    name: 'git',
    description: 'Git MCP server exposing history and diffs for the local repo.',
    tags: ['template', 'mcp-server', 'git'],
    files: [
      jsonFile('.mcp/git.json', {
        mcpServers: {
          git: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-git', '--repository', '.'],
          },
        },
      }),
    ],
  }),
];

const commands: RegistryEntry[] = [
  entry({
    kind: 'command',
    name: 'review-diff',
    description: 'Slash command: review the working diff for issues before committing.',
    tags: ['template', 'command', 'review'],
    files: [
      commandFile(
        'review-diff',
        `Review the current working diff.\n\nRun \`git diff\` and report, grouped by file:\n\n- Correctness risks and likely bugs.\n- Missing tests for new behaviour.\n- Style or naming that departs from the surrounding code.\n\nBe specific with file:line references. Do not make edits — just review.`,
      ),
    ],
  }),
  entry({
    kind: 'command',
    name: 'generate-tests',
    description: 'Slash command: write tests for the file or symbol under discussion.',
    tags: ['template', 'command', 'testing'],
    files: [
      commandFile(
        'generate-tests',
        `Write tests for $ARGUMENTS.\n\n1. Read the target and its existing tests, if any.\n2. Cover the happy path, boundaries, and error cases.\n3. Match the project's test runner and file conventions.\n4. Ensure the new tests pass before finishing.`,
      ),
    ],
  }),
  entry({
    kind: 'command',
    name: 'explain-selection',
    description: 'Slash command: explain what a piece of code does and why.',
    tags: ['template', 'command', 'docs'],
    files: [
      commandFile(
        'explain-selection',
        `Explain $ARGUMENTS.\n\nGive a short, plain-language explanation covering:\n\n- What it does, step by step.\n- Any non-obvious edge cases or assumptions.\n- One risk or gotcha to watch for.\n\nAssume the reader knows the language but not this codebase.`,
      ),
    ],
  }),
];

const runtimeTemplates: RegistryEntry[] = [
  entry({
    kind: 'runtime-template',
    name: 'cursor-starter',
    description: 'Scaffold a Cursor project: a starter rules file and ignore list.',
    tags: ['runtime-template', 'cursor', 'scaffold'],
    files: [
      {
        path: '.cursor/rules/project.mdc',
        content: `---\ndescription: Project conventions for Cursor\nalwaysApply: true\n---\n\n# Project rules\n\n- Follow the existing code style; do not reformat unrelated lines.\n- Add or update a test for every behavioural change.\n- Keep changes surgical and scoped to the request.\n- Never commit secrets; read them from the environment.\n`,
      },
      {
        path: '.cursorignore',
        content: `node_modules/\ndist/\nbuild/\ncoverage/\n.env\n`,
      },
    ],
  }),
  entry({
    kind: 'runtime-template',
    name: 'codex-starter',
    description: 'Scaffold Codex: an AGENTS.md guide and a minimal config.toml.',
    tags: ['runtime-template', 'codex', 'scaffold'],
    files: [
      {
        path: 'AGENTS.md',
        content: `# Agent instructions\n\nThis file guides AI agents working in this repository.\n\n## Build & test\n\n_Add your build and test commands here._\n\n## Conventions\n\n- Match existing style; keep changes minimal and well-tested.\n- Do not introduce new dependencies without asking.\n- Never hardcode secrets.\n`,
      },
      {
        path: '.codex/config.toml',
        content: `# Codex project configuration\n# See https://developers.openai.com/codex for the full reference.\n\n[project]\nname = "my-project"\n`,
      },
    ],
  }),
  entry({
    kind: 'runtime-template',
    name: 'gemini-starter',
    description: 'Scaffold Gemini CLI: a GEMINI.md guide and a settings file.',
    tags: ['runtime-template', 'gemini', 'scaffold'],
    files: [
      {
        path: 'GEMINI.md',
        content: `# Project context for Gemini\n\n## Overview\n\n_Briefly describe what this project is._\n\n## Working agreements\n\n- Keep edits focused on the task.\n- Write tests alongside code changes.\n- Explain non-obvious decisions in the PR description.\n`,
      },
      {
        path: '.gemini/settings.json',
        content: JSON.stringify({ contextFileName: 'GEMINI.md' }, null, 2) + '\n',
      },
    ],
  }),
];

const allEntries: RegistryEntry[] = [
  ...skills,
  ...subagents,
  ...rules,
  ...hooks,
  ...mcpServers,
  ...commands,
  ...runtimeTemplates,
];

function buildIndex(): RegistryIndex {
  return { version: SEED_VERSION, entries: allEntries };
}

function serialize(index: RegistryIndex): string {
  return JSON.stringify(index, null, 2) + '\n';
}

function main(): void {
  const verify = process.argv.includes('--verify');
  const index = buildIndex();
  const text = serialize(index);

  // Self-check: every entry must pass the runtime verifier.
  let integrityFailures = 0;
  for (const e of index.entries) {
    const result = verifyEntry(e);
    if (!result.ok) {
      integrityFailures += 1;
      console.error(`INTEGRITY FAIL: ${e.kind}/${e.name}`, result.mismatches);
    }
  }

  if (verify) {
    const existing = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : null;
    if (existing !== text) {
      console.error(`MISMATCH: ${INDEX_PATH} is stale — rerun without --verify.`);
      process.exit(1);
    }
    if (integrityFailures) process.exit(1);
    console.log(`ok ${index.entries.length} entries verified`);
  } else {
    fs.writeFileSync(INDEX_PATH, text);
    console.log(`wrote ${INDEX_PATH} (${index.entries.length} entries)`);
    if (integrityFailures) process.exit(1);
  }
}

main();
