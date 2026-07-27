# Publishing `agentconfiging`

The package is **release-ready** but **not yet published**. Publishing is an
irreversible, public action and is the maintainer's decision — this document is
the runbook. Nothing here has been executed.

## Pre-flight (already done)

- `version`: `0.1.0`, `publishConfig.access`: `public`, `license`: MIT, `bin`: `agentconfiging`.
- Tarball verified: `npm pack --dry-run` → 21 files (`dist/{cli,server,core}`, `dist/web`, `LICENSE`, `README.md`), ~693 kB, no `src`/tests/maps/fixtures.
- `prepublishOnly` runs a fresh `npm run build`.
- Optional native deps (`better-sqlite3`, `node-pty`) are in `optionalDependencies` — install and the core CLI succeed without them (proven by `npm run e2e`).
- `npm run e2e` (packaging smoke: pack → clean-dir install → `agentconfiging report` → server serves the bundled UI) **passes**.
- License/originality audit: `docs/LICENSE-AUDIT.md` (all deps permissive, no copied code).

## Naming caveat

The unscoped name `agentconfiging` must be owned by the publishing npm account.
See bead `agentconfig-fy8.3` for the naming decision and the `@capabletooling/agentconfiging`
scoped-alias fallback. If the unscoped name is unavailable, publish the scoped
package instead (adjust `name` in `package.json`).

## Recommended: publish from CI with provenance

Provenance (npm's supply-chain attestation) requires a trusted CI OIDC context and
**cannot** be produced by a local `npm publish`. `.github/workflows/publish.yml`
does this on a version tag:

1. Add the repo secret `NPM_TOKEN` (an npm automation token with publish rights).
2. Bump `version` in `package.json` if needed and commit.
3. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
4. The workflow runs lint/typecheck/test/build/e2e, then `npm publish --provenance --access public`.

## Alternative: manual local publish (no provenance)

```bash
npm login                # authenticate the publishing account
npm run build && npm run e2e   # final local gate
npm publish --dry-run    # verify contents one more time
npm publish              # ← the irreversible step; publishConfig sets access:public
```

## After publish

- Verify: `npx agentconfiging@latest report` in a scratch repo.
- Tag the release in git if not done via CI.
