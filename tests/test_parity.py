"""Python side of the browser parity contract, plus the real HiGHS-wasm run (node) when its dependency is installed."""
import json
import shutil
import subprocess

import pytest

from analytics.milp import Model, OPTIONS, solve
from analytics.scenarios import sha
from pipelines.common import ROOT
from tests.conftest import load


def test_vector_set_covers_required_cases():
    tv = load("solver_test_vectors")
    kinds = {v["kind"] for v in tv["vectors"]}
    assert {"preset", "random", "infeasible", "relaxed", "closure"} <= kinds
    st = [v["expected"]["status"] for v in tv["vectors"]]
    assert "Infeasible" in st and "Optimal" in st
    assert any(v["params"]["relax"] and v["expected"]["status"] == "Optimal" and v["expected"]["relaxed_groups"] for v in tv["vectors"])
    assert tv["solver_options"] == OPTIONS and tv["parity_keys"] == ["lp_text_sha256", "status", "objective_usd"]
    assert sha(tv["lp_text"]) == next(v for v in tv["vectors"] if v["id"] == tv["lp_text_vector_id"])["lp_text_sha256"]


@pytest.mark.slow
def test_python_reproduces_every_vector(net):
    tv = load("solver_test_vectors")
    for v in tv["vectors"]:
        m = Model(net, v["params"])
        t = m.lp_text()
        assert sha(t) == v["lp_text_sha256"], v["id"]
        r = solve(m, t)
        e = v["expected"]
        assert r["status"] == e["status"], v["id"]
        if e["objective_usd"] is None:
            assert r["objective"] is None
        else:
            assert abs(r["objective"] - e["objective_usd"]) <= max(tv["tolerance_abs_usd"], tv["tolerance_rel"] * e["objective_usd"]), v["id"]


@pytest.mark.slow
@pytest.mark.skipif(shutil.which("node") is None or not (ROOT / "tests/parity/node_modules/highs").exists(), reason="node or tests/parity/node_modules missing (cd tests/parity && npm ci)")
def test_highs_wasm_reproduces_every_vector():
    p = subprocess.run(["node", "build_lp.mjs"], cwd=ROOT / "tests/parity", capture_output=True, text=True, timeout=600)
    assert p.returncode == 0, p.stdout[-2000:] + p.stderr[-1000:]
    assert "failures: 0" in p.stdout


@pytest.mark.slow
def test_published_artifacts_are_byte_identical_on_rerun(tmp_path, monkeypatch):
    from pipelines import publish
    monkeypatch.setattr(publish, "PUBLIC", tmp_path)
    monkeypatch.setattr(publish, "MANIFESTS", tmp_path)
    (tmp_path / "census_extract.json").write_text((ROOT / "data/manifests/census_extract.json").read_text())
    publish.main()
    for f in tmp_path.glob("*.json"):
        if f.name in ("census_extract.json", "runtime.json"):
            continue
        assert f.read_bytes() == (ROOT / "site/public/data" / f.name).read_bytes(), f.name
