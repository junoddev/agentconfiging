# Testing rules

- Unit tests colocate as `*.test.ts`; integration tests live in `test/int/`.
- Integration tests get a fresh schema via `test/int/setup.ts` — never share state.
- Saga tests must cover the compensation path, not just the happy path.
- Snapshot tests are banned.
