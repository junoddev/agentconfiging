---
applyTo: "app/api/**/*.py"
---

# API layer instructions

- Every endpoint declares a `response_model`.
- Pagination is cursor-based; page/offset params are forbidden.
- Raise `BillingError` subclasses, never bare `HTTPException`.
