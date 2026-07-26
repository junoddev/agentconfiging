# Conventions — legacy-api

Flask 2 app being strangled into services. Rules for automated edits:

- Do not modify anything under `legacy/` — it is frozen for extraction.
- New endpoints go in `services/<domain>/routes.py`.
- Every route change needs a matching test in `tests/services/`.
- Keep responses backward compatible; clients pin to field names.
