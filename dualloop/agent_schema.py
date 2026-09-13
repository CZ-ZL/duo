"""JSON Schemas for calling agents. Cross-field compatibility is checked by plan."""


def schemas():
    text = {"type": "string", "minLength": 1}
    metric_names = {"type": "array", "minItems": 1, "uniqueItems": True, "items": text}
    evaluator = {
        "type": "object", "additionalProperties": False,
        "required": ["id", "version", "data_id", "metrics", "evidence", "limitations"],
        "properties": {"id": text, "version": text, "data_id": text,
                       "metrics": metric_names, "evidence": text,
                       "limitations": text, "data_path": text},
    }
    objective = {
        "type": "object", "required": ["metric", "direction", "evaluator"],
        "properties": {"metric": text, "direction": {"enum": ["maximize", "minimize"]}, "evaluator": text},
    }
    weight_map = {"type": "object", "minProperties": 1, "additionalProperties": {"type": "number"}}
    input_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "DUO Agent-native experiment v1",
        "type": "object", "required": ["contract", "agent", "generations", "quotas"],
        "properties": {
            "generations": {"type": "integer", "minimum": 1},
            "quotas": {"type": "object", "additionalProperties": False,
                       "required": ["exploit", "explore", "innovate"],
                       "properties": {k: {"type": "integer", "minimum": 0} for k in ("exploit", "explore", "innovate")}},
            "promotion": {"type": "object", "properties": {"top_k": {"type": "integer", "minimum": 1}}},
            "agent": {
                "type": "object", "required": ["target_snapshot", "adapter", "evaluators", "permissions", "evidence_kind"],
                "properties": {
                    "target_snapshot": text, "adapter": text,
                    "adapter_options": {"type": "object", "description": "Caller-owned trusted adapter options, bound by the plan digest; do not include credentials."},
                    "evidence_kind": {"enum": ["fixture", "local_benchmark"]},
                    "search_mode": {"enum": ["dual_loop", "single_loop", "baseline"], "default": "dual_loop"},
                    "max_consecutive_failures": {"type": "integer", "minimum": 1, "default": 3},
                    "permissions": {"type": "object", "additionalProperties": False,
                                    "required": ["paid", "network", "external_side_effects"],
                                    "properties": {k: {"const": False} for k in ("paid", "network", "external_side_effects")}},
                    "evaluators": {"type": "object", "additionalProperties": False,
                                   "required": ["fast"], "properties": {k: evaluator for k in ("fast", "slow", "final")}},
                },
            },
            "contract": {
                "type": "object", "required": ["id", "version", "target", "baseline", "lower_objectives", "comparison", "budget"],
                "properties": {
                    "id": text, "version": {"type": "integer", "minimum": 1},
                    "target": {"type": "object", "required": ["kind", "ref", "editable_space"],
                               "properties": {"kind": {"const": "dsh-persona"}, "ref": {"const": "system-prompt"},
                                              "editable_space": {"const": ["persona"]}, "frozen": {"type": "array", "items": text}}},
                    "baseline": {"type": "object", "required": ["ref"], "properties": {"ref": {"const": "snapshot:target"}}},
                    "lower_objectives": {"type": "array", "minItems": 1, "items": objective},
                    "upper_objective": {"anyOf": [objective, {"type": "null"}]},
                    "constraints": {"type": "array", "items": {
                        "type": "object", "required": ["metric", "op", "value"],
                        "properties": {"metric": text, "op": {"enum": ["<", "<=", ">", ">=", "==", "!="]},
                                       "value": {"type": ["number", "boolean"]}}}},
                    "comparison": {"type": "object", "required": ["plugin", "config"],
                                   "properties": {"plugin": {"const": "weighted_v1"}, "config": {
                                       "type": "object", "required": ["weights"], "properties": {
                                           "weights": weight_map, "slow_weights": weight_map,
                                           "min_sample_size": {"type": "number", "minimum": 0},
                                           "incumbent_epsilon": {"type": "number", "minimum": 0}}}}},
                    "budget": {"type": "object", "required": ["max_fast_evals", "max_slow_evals", "max_cost", "max_wall_time_hours"],
                               "properties": {"max_fast_evals": {"type": "integer", "minimum": 2},
                                              "max_slow_evals": {"type": "integer", "minimum": 1},
                                              "max_cost": {"const": 0},
                                              "max_wall_time_hours": {"type": "number", "exclusiveMinimum": 0}}},
                },
            },
        },
        "description": "Plan additionally checks metric coverage/direction, distinct data IDs, resource reservations, files and adapter compatibility.",
    }
    error = {"type": "object", "required": ["code", "component", "message", "retryable", "recoverable", "recovery_conditions", "next_action"],
             "properties": {**{k: text for k in ("code", "component", "message", "recovery_conditions", "next_action")},
                            "retryable": {"type": "boolean"}, "recoverable": {"type": "boolean"}}}
    output_schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "DUO Agent-native result v1", "type": "object",
        "required": ["api_version", "status", "conclusion", "improvement_proven"],
        "properties": {
            "api_version": {"const": 1}, "run_id": text, "plan_digest": text,
            "experiment_id": text,
            "status": {"enum": ["completed", "stopped", "failed", "cancelled"]},
            "conclusion": {"enum": ["recommend_candidate", "retain_baseline", "insufficient_evidence", "run_failed"]},
            "improvement_proven": {"type": "boolean"}, "evidence_kind": {"enum": ["fixture", "local_benchmark"]},
            "reused_artifacts": {"type": "boolean"}, "mode": {"enum": ["optimize", "fast_only", "baseline", "single_loop"]},
            "cost_usd": {"type": ["number", "null"]}, "cost_scope": text,
            "wall_time_s": {"type": "number"}, "summary": {"type": ["object", "null"]},
            "counters": {"type": "object"}, "candidate_id": {"type": ["string", "null"]},
            "attempts": {"type": "object", "required": ["fast", "slow", "final"],
                         "properties": {k: {"type": "integer", "minimum": 0} for k in ("fast", "slow", "final")}},
            "baseline_id": {"type": ["string", "null"]}, "candidate_path": {"type": ["string", "null"]},
            "original_target_changed": {"type": "boolean"}, "failure_candidates": {"type": "array", "items": text},
            "limitations": {"type": "array", "items": text}, "error": {"anyOf": [error, {"type": "null"}]},
            "artifact_hashes": {"type": "object", "additionalProperties": text},
        },
    }
    return input_schema, output_schema
