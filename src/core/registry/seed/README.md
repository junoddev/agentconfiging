# Registry seed snapshot

This directory is the **in-package seed** for the E6 catalog (SPEC §4.5). It
mirrors what the external **`agentconfig-registry`** git repo publishes, so the
catalog works **offline on first run** before any network fetch.

- `catalog.json` — the reviewable seed catalog; edit this file to add, remove,
  or update entries.
- `index.json` — the generated seed index (do not hand-edit). Checksums are
  added from file contents during generation.
- `build-seed.ts` — the generator/verifier for `index.json`.

## Regenerating

Run from the repo root:

```bash
npx tsx src/core/registry/seed/build-seed.ts            # write index.json
npx tsx src/core/registry/seed/build-seed.ts --verify   # check it is current
```

Each file's `sha256` is computed with the same hasher the runtime verifier
uses (`verifyEntry`), so the seed always passes verification. The
`registry.test.ts` seed-integrity test re-checks this independently.

## `index.json` format (also the external repo's contract)

The external `agentconfig-registry` repo publishes a static `index.json` of
the same shape, plus artifact payloads. Both are **untrusted input**: they are
parsed by `parseRegistryIndex` (strict shape validation, size caps, no
prototype pollution, never eval) and checksum-verified before anything is
installed.

```jsonc
{
  "version": "1.0.0",
  "entries": [
    {
      "kind": "skill",              // subagent | skill | command | mcp-server | hook | rule | runtime-template
      "name": "git-commit-helper",
      "description": "…",
      "version": "1.0.0",
      "source": "agentconfig-seed", // provenance recorded in installed-file frontmatter
      "tags": ["template", "skill", "git"],
      "files": [
        {
          "path": ".claude/skills/git-commit-helper/SKILL.md", // project-relative dest; guarded at INSTALL time, never trusted here
          "content": "…",           // inlined payload (seed + template entries always inline)
        }
      ]
    }
  ]
}
```

Rules the validator enforces:

- Each file has **exactly one** of `content` (inlined) or `url` (fetched +
  verified at fetch time by the fetch client, agentconfig-0zm.2).
- The generator adds a `sha256` value for each inlined file; content-bearing
  files are verified before the generated index is written.
- `url` payloads must be `http(s)`.
- `kind` must be one of the seven artifact kinds. Template-gallery entries are
  ordinary entries carrying a `template` tag (SPEC §5 row 14); runtime scaffolds
  use `kind: "runtime-template"`.
- A malformed entry is **skipped and reported**, not fatal; only an unusable
  top-level shape is rejected outright.

## How the fetch client layers over this seed (agentconfig-0zm.2)

1. First paint uses `loadSeedIndex()` — always available, no I/O.
2. The fetch client pulls the external index over HTTPS into a local cache,
   running it through the same `parseRegistryIndex`.
3. The effective catalog prefers the fetched index; entries are keyed by
   `(kind, name)` and a fetched entry supersedes the seed entry with the same
   key. The seed is the offline floor; the fetched cache is the fresh overlay.

## Authoring notes

Edit `catalog.json`, then run the generator to refresh `index.json` and its
checksums. All seed content is **original, clean-room** starter config — no third-party
tool content copied, no secrets, and no payload that executes on install
(hook/MCP entries are config snippets; installing only writes files).
