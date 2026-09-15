"""Contract validation: each mode + each refusal reason (DESIGN.md
"Objective Contract" validity check + "Failure / Explore Mode")."""
import copy

import pytest
import yaml

from dualloop.contract import (
    EXPLORE_LABEL, PROXY_ONLY_LABEL, ContractValidationError, PluginRegistry,
    load_contract, validate_contract,
)
from pathlib import Path

MOCK_YML = Path(__file__).resolve().parent.parent / "research" / "experiments" / "mock.yml"


def full_contract_dict():
    return yaml.safe_load(MOCK_YML.read_text(encoding="utf-8"))["contract"]


def registry(**overrides):
    kw = dict(evaluators={"mock_fast", "mock_slow"},
              comparators={"weighted_v1"}, executors={"mock"},
              baselines={"git:HEAD"})
    kw.update(overrides)
    return PluginRegistry(**kw)


class TestModes:
    def test_full_contract_is_optimize(self):
        contract = load_contract(full_contract_dict())
        result = validate_contract(contract, registry())
        assert result.mode == "optimize"
        assert result.labels == []

    def test_missing_upper_objective_is_fast_only(self):
        d = full_contract_dict()
        del d["upper_objective"]
        result = validate_contract(load_contract(d), registry())
        assert result.mode == "fast_only"
        assert PROXY_ONLY_LABEL in result.labels

    def test_missing_comparison_is_explore(self):
        d = full_contract_dict()
        del d["comparison"]
        result = validate_contract(load_contract(d), registry())
        assert result.mode == "explore"
        assert EXPLORE_LABEL in result.labels

    def test_unresolvable_comparator_is_explore(self):
        result = validate_contract(load_contract(full_contract_dict()),
                                   registry(comparators=set()))
        assert result.mode == "explore"


class TestRefusals:
    def test_unresolvable_baseline(self):
        with pytest.raises(ContractValidationError, match="does not resolve"):
            validate_contract(load_contract(full_contract_dict()),
                              registry(baselines=set()))

    def test_empty_editable_space(self):
        d = full_contract_dict()
        d["target"]["editable_space"] = []
        with pytest.raises(ContractValidationError, match="editable_space"):
            load_contract(d)

    def test_no_measurable_objective(self):
        d = full_contract_dict()
        d["lower_objectives"] = []
        with pytest.raises(ContractValidationError, match="no measurable objective"):
            load_contract(d)

    def test_unresolvable_evaluator(self):
        with pytest.raises(ContractValidationError, match="mock_fast"):
            validate_contract(load_contract(full_contract_dict()),
                              registry(evaluators={"mock_slow"}))

    def test_unresolvable_slow_evaluator(self):
        with pytest.raises(ContractValidationError, match="slow evaluator"):
            validate_contract(load_contract(full_contract_dict()),
                              registry(evaluators={"mock_fast"}))

    def test_no_executable_experiment(self):
        with pytest.raises(ContractValidationError, match="no executor"):
            validate_contract(load_contract(full_contract_dict()),
                              registry(executors=set()))

    def test_multiple_failures_reported_together(self):
        with pytest.raises(ContractValidationError) as exc_info:
            validate_contract(load_contract(full_contract_dict()),
                              registry(evaluators=set(), executors=set(),
                                       baselines=set()))
        reasons = exc_info.value.reasons
        assert any("baseline" in r for r in reasons)
        assert any("executor" in r for r in reasons)
        assert any("mock_fast" in r for r in reasons)
