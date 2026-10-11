import numpy as np
import pytest

from analytics.robustness import CFG, Evaluator, draws, run_mc
from tests.conftest import load


def test_draws_are_seeded(net):
    a, b = draws(net), draws(net)
    assert all(x["sites_down"] == y["sites_down"] and x["lanes_down"] == y["lanes_down"] and (x["mult"] == y["mult"]).all() for x, y in zip(a, b))
    c = draws(net, {**CFG, "seed": CFG["seed"] + 1})
    assert any(x["sites_down"] != y["sites_down"] for x, y in zip(a, c))


def test_published_shape_and_summary_consistency():
    r = load("robustness")
    n = r["config"]["draws"]
    assert n == 500 and all(len(v) == n for v in r["draws"].values())
    for k in ("legacy", "optimized"):
        res = r["results"][k]
        assert all(len(res[f]) == n for f in res)
        assert abs(np.mean(res["adjusted_cost_usd"]) - r["summary"][k]["adjusted_cost"]["mean"]) <= 1.0
        assert 0 <= min(res["service_level"]) and max(res["service_level"]) <= 1.0 + 1e-9
        assert sum(r["histograms"][k]["cost"]["counts"]) == n and sum(r["histograms"][k]["service_level"]["counts"]) == n
        assert r["summary"][k]["cost"]["cvar95"] >= r["summary"][k]["cost"]["p95"] - 1e-6
    assert r["summary"]["optimized"]["adjusted_cost"]["mean"] < r["summary"]["legacy"]["adjusted_cost"]["mean"]


def test_undisrupted_equals_deterministic_solutions(sols):
    r = load("robustness")
    d = {x["id"]: x for x in r["designs"]}
    assert abs(d["optimized"]["undisrupted_cost_usd"] - sols["optimized"]["objective_usd"]) <= 0.05
    assert abs(d["legacy"]["undisrupted_cost_usd"] - sols["legacy"]["objective_usd"]) <= 0.05


def test_evaluator_is_restored_between_runs_and_monotone(net):
    ev = Evaluator(net, [0, 1, 2, 3, 4, 5, 8, 10])
    a = ev.run()
    b = ev.run(sites_down=[0])
    c = ev.run()
    assert abs(a["cost"] - c["cost"]) < 1e-3 and a["service"] == pytest.approx(1.0)
    assert b["service"] <= a["service"] and b["adjusted"] >= a["adjusted"]


def test_monte_carlo_reproduces_published(net):
    r = load("robustness")
    small = run_mc(net, {"optimized": r["designs"][1]["open_sites"]}, {**CFG, "draws": 12})
    assert small["results"]["optimized"]["cost_usd"] == r["results"]["optimized"]["cost_usd"][:12]
