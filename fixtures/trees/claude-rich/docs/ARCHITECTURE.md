# Architecture

Orbit consumes order events from a message bus, orchestrates fulfillment
steps as a saga, and emits status events.

```
bus -> ingest -> saga engine -> step workers -> bus
                    |
                 postgres (saga state, dedup)
```

- `src/ingest/` — bus consumers, schema validation
- `src/saga/` — state machine, compensation logic
- `src/steps/` — one module per fulfillment step
- `src/emit/` — outbound event publishing (transactional outbox)
