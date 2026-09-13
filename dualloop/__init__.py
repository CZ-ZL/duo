"""DualLoop Phase A — dual-loop autonomous optimization protocol core.

The Dual-Loop Protocol is the product: a fixed state machine (fast loop ->
promotion gate -> slow loop -> feedback edge) with every box a plugin socket.
Evaluators emit metric dicts (facts); only the Comparator emits verdicts.
"""

__version__ = "0.1.0"
