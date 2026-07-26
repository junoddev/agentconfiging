# Checkout

Payment checkout service. TypeScript + Fastify.

## Build & Test

```bash
npm ci
npm test
```

## Rules

- Indent with tabs.
- Currency amounts are integer minor units (cents).
- All card data goes through the tokenizer; raw PANs never touch our code.
- The retry budget for PSP calls is 2 attempts, 250ms backoff.
