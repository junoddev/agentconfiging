# Agent guide — data-pipeline

Batch ETL pipeline in Rust. Reads from S3-compatible storage, writes Parquet.

## Working here

- `cargo build --workspace` must stay green; fix warnings, they are denied in CI.
- Config lives in `pipeline.toml`; never hardcode bucket names.
- Integration tests need `docker compose up -d minio` first.
- Prefer small PRs: one transform per change.

## Layout

- `crates/ingest/` — source readers
- `crates/transform/` — pure transforms (no I/O)
- `crates/sink/` — Parquet writer
