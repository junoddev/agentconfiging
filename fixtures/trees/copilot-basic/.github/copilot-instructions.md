# Copilot instructions for billing-service

This is a Python 3.12 FastAPI service that issues and reconciles invoices.

- Use `uv` for dependency management, never pip directly.
- All money amounts are `Decimal`, quantized to 2 places at the boundary.
- Database access goes through `app/repo/`; handlers never import SQLAlchemy.
- Tests use pytest with the `faker` fixtures in `tests/conftest.py`.
- Run `make check` (ruff + mypy + pytest) before finishing any task.
