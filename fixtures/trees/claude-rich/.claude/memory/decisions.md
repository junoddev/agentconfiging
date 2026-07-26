---
type: decision
name: outbox-over-direct-publish
description: Why all bus publishes go through the transactional outbox
---

# Decision: transactional outbox (2026-03)

Direct publishes lost events when the process died between commit and publish.
All emits now write to the `outbox` table in the same transaction as state
changes; a relay drains it. Revisit only if the relay lag SLO (p99 < 2s) fails.
