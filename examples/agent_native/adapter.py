"""BYOE example using existing protocols. No model, API, network or subprocess.

Replace these evaluators with your already-qualified executable evaluation.
The deterministic string checks below test wiring, not optimization efficacy.
"""
import json
from pathlib import Path

from dualloop.models import Candidate, Delta, EvaluationResult
from dualloop.plugins.docs_qa_target import persona_version


class Generator:
    def __init__(self, baseline, options):
        self.baseline, self.options = baseline, options

    def propose(self, champion, feedback, quotas, generation, next_id):
        parent = champion.delta.patch.get("persona", self.baseline)
        candidates = []
        for mode, count in quotas.items():
            for slot in range(count):
                instruction = " Cite checked sources. Be concise."
                if self.options.get("no_improvement"):
                    instruction = ""
                persona = parent + instruction
                if self.options.get("invalid_candidate"):
                    persona = "lost required placeholders"
                candidates.append(Candidate(
                    next_id(), champion.experiment_id, champion.id, generation,
                    mode + "-wording", mode,
                    Delta("cordis-overlay", "system-prompt", {"persona": persona},
                          "Append a source-checking instruction", persona_version(parent)),
                    "The explicit instruction should pass the documented fixture checks.",
                ))
        return candidates


class Executor:
    def run(self, candidate, applied):
        return applied  # no agent execution in this fixture


class Evaluator:
    def __init__(self, spec, tier, root, options):
        self.evaluator_id, self.spec = spec["id"], spec
        self.tier, self.root, self.options = tier, Path(root), options

    def evaluate(self, candidate, artifact):
        if self.options.get("evaluation_failure") and candidate.generation:
            raise RuntimeError("fixture evaluation failure")
        text = artifact["persona"]
        score = float("Cite checked sources." in text)
        if self.tier != "fast":
            score *= float("Be concise." in text)
        metrics = {"instruction_checks": score,
                   "safety_pass": "{{model}}" in text and "{{cwd}}" in text,
                   "sample_size": 1}
        path = self.root / f"{candidate.id}-{self.evaluator_id}.json"
        path.write_text(json.dumps({"metrics": metrics, "data_id": self.spec["data_id"],
                                    "evidence_kind": "fixture"}, indent=2) + "\n")
        return EvaluationResult(candidate.id, self.evaluator_id,
                                "fast" if self.tier == "fast" else "slow", True,
                                metrics, [str(path)], cost_usd=0)


def create_bindings(*, baseline_persona, run_dir, evaluators, options):
    return {
        "generator": Generator(baseline_persona, options),
        "executor": Executor(),
        "fast_evaluator": Evaluator(evaluators["fast"], "fast", run_dir, options),
        "slow_evaluator": (Evaluator(evaluators["slow"], "slow", run_dir, options)
                           if "slow" in evaluators else None),
        "final_evaluator": (Evaluator(evaluators["final"], "final", run_dir, options)
                            if "final" in evaluators else None),
        # This is a declared resource contract, not measured timing or efficacy.
        "generation_max_cost_usd": 0,
        "selection_max_cost_usd": 0,
    }
