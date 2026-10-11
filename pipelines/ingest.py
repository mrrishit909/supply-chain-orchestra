"""Download the two Census files into data/raw with a SHA-256 manifest. Skips files that already exist.

    uv run python -m pipelines.ingest
"""
from __future__ import annotations

import json
import time
import zipfile

import requests

from pipelines.common import MANIFESTS, RAW, dumps, sha256_file

FILES = {
    "gaz.zip": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_place_national.zip",
    "sub-est2025.csv": "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv",
}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    man = {}
    for name, url in FILES.items():
        p = RAW / name
        if not p.exists():
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            p.write_bytes(r.content)
            fetched = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        else:  # file already on disk (e.g. fetched by hand): record its mtime as the retrieval time
            fetched = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(p.stat().st_mtime))
        man[name] = {"url": url, "bytes": p.stat().st_size, "sha256": sha256_file(p), "fetched_at_utc": fetched}
    with zipfile.ZipFile(RAW / "gaz.zip") as z:
        z.extractall(RAW)
    mf = MANIFESTS / "census_extract.json"
    prev = json.loads(mf.read_text()) if mf.exists() else {}
    for k, v in man.items():  # keep the first recorded retrieval time on reruns so outputs stay byte-identical
        v["fetched_at_utc"] = prev.get(k, {}).get("fetched_at_utc") or v["fetched_at_utc"]
    (MANIFESTS / "census_extract.json").write_text(dumps(man) + "\n")
    print({k: v["sha256"][:12] for k, v in man.items()})


if __name__ == "__main__":
    main()
