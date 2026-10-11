import gzip
import json
import re
import subprocess

import pytest
from jsonschema import Draft202012Validator

from pipelines.common import CONTRACTS, PUBLIC, ROOT

NAMES = ["meta", "quality", "network", "model", "solutions", "robustness", "solver_test_vectors", "facts"]


@pytest.mark.parametrize("name", NAMES)
def test_artifact_validates_and_is_small(name):
    sch = json.loads((CONTRACTS / f"{name}.schema.json").read_text())
    Draft202012Validator.check_schema(sch)
    f = PUBLIC / f"{name}.json"
    errs = list(Draft202012Validator(sch).iter_errors(json.loads(f.read_text())))
    assert not errs, errs[0].message
    assert len(gzip.compress(f.read_bytes(), 9, mtime=0)) <= 400 * 1024


def test_schema_files_match_generator():
    from pipelines.contracts import schemas
    for n, s in schemas().items():
        assert json.loads((CONTRACTS / f"{n}.schema.json").read_text()) == s


def test_every_artifact_field_group_is_tagged():
    for n in NAMES:
        t = json.loads((PUBLIC / f"{n}.json").read_text())["tags"]
        assert t and all(re.match(r"^(OBSERVED|DERIVED|PREDICTED|SIMULATED|SYNTHETIC)(/(OBSERVED|DERIVED|PREDICTED|SIMULATED|SYNTHETIC))*$", v) for v in t.values())


def test_no_em_or_en_dash_codepoints_u2014_u2015():
    bad = []
    files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    for f in filter(None, files):
        if "node_modules" in f or not (ROOT / f).is_file():
            continue
        try:
            t = (ROOT / f).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if chr(0x2014) in t or chr(0x2015) in t:
            bad.append(f)
    assert not bad, bad
