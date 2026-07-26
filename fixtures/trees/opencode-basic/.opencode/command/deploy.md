---
description: Deploy the gateway to the given environment
agent: build
model: anthropic/claude-sonnet-4-5
---

Deploy the gateway service to $ARGUMENTS.

Steps:
1. Run `make preflight` and stop on any failure.
2. Apply the terraform plan for the target environment.
3. Verify `/healthz` returns 200 before reporting success.
