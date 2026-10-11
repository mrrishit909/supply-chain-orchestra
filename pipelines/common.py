"""Paths, canonical JSON and hashing shared by the pipeline and tests."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
MANIFESTS = ROOT / "data" / "manifests"
CONTRACTS = ROOT / "data" / "contracts"
PUBLIC = ROOT / "site" / "public" / "data"

SEED = 20261011  # network generator and Monte Carlo seed, fixed for every run


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def dumps(obj) -> str:
    """Canonical JSON: sorted keys, compact separators, stable floats (byte-identical across runs)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def r4(x: float) -> float:
    """The published rounding rule: half-up to 4 decimals (floor(x*1e4+0.5)/1e4). TypeScript mirrors it as Math.floor(x*1e4+0.5)/1e4."""
    import math
    return math.floor(x * 1e4 + 0.5) / 1e4


def fmt(v: float) -> str:
    """Fixed-decimal number text used in the LP file: 4 decimals, trailing zeros stripped, no negative zero."""
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s
