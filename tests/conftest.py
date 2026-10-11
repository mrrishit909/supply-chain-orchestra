import json

import pytest

from pipelines.common import PUBLIC, RAW


def load(name):
    return json.loads((PUBLIC / f"{name}.json").read_text())


@pytest.fixture(scope="session")
def net():
    return load("network")


@pytest.fixture(scope="session")
def sols():
    return {s["id"]: s for s in load("solutions")["scenarios"]}


@pytest.fixture(scope="session")
def model_art():
    return load("model")


@pytest.fixture(scope="session")
def raw_ready():
    return (RAW / "2026_Gaz_place_national.txt").exists() and (RAW / "sub-est2025.csv").exists()
