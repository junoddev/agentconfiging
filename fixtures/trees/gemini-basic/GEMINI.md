# Gemini CLI guide — ml-notebooks

Research notebooks + a small training harness. Python, managed with uv.

- Notebooks under `notebooks/` are exploratory; never refactor them.
- Reusable code gets promoted into `mlkit/` with tests.
- Datasets are declared in `data/registry.yaml`; do not add raw files to git.
- Use `uv run pytest` for the harness; notebooks are not tested.
