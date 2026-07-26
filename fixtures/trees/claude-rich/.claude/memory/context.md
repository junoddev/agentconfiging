---
type: context
name: fulfillment-partners
description: Quirks of the three fulfillment partner APIs
---

# Partner API quirks

- Partner A retries webhooks up to 7 times with no idempotency key — dedup on
  `(order_id, event_type, occurred_at)`.
- Partner B's sandbox returns production-shaped ids; never branch on id shape.
- Partner C rate limits at 5 rps; the step worker batches by design.
