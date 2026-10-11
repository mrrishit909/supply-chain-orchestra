"""One entrypoint: download Census files (if absent) -> network -> solve -> Monte Carlo -> site/public/data/*.json -> validation.

    uv run python -m pipelines.run_all
"""
from __future__ import annotations

from pipelines import contracts, ingest, publish, validate_artifacts


def main() -> None:
    ingest.main()
    contracts.main()
    publish.main()
    validate_artifacts.main()


if __name__ == "__main__":
    main()
