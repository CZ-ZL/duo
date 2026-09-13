"""Durable paid-session admission and cost accounting on a local POSIX filesystem.

Monetary ledgers reserve declared amounts before spawn under a process lock,
then settle uniquely bound, retained receipts. Unknown costs and exited owners
block further admission until reconciliation. Owner checks require Linux /proc.
This bounds admission under declared reservations, not provider invoices.
Legacy `acquire()` / `charge()` remains a separate count-only compatibility API.

Cost estimates retain the historical demo's fixed tariff, not a verified
current provider/model price or billing receipt:
  input  $0.27 / 1M tokens
  output $1.10 / 1M tokens
Cache-read tokens are billed as regular input here — a deliberate
conservative (over-)estimate.
"""
from __future__ import annotations

import json
import copy
import hashlib
import fcntl
import os
import tempfile
import uuid
from contextlib import contextmanager
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
import math
import threading
import time
from pathlib import Path

COST_PER_MTOK_INPUT = 0.27    # USD, documented constant
COST_PER_MTOK_OUTPUT = 1.10   # USD, documented constant


def estimate_cost_usd(tokens: dict) -> float | None:
    """Fixed-tariff estimate; missing/invalid usage is unknown, never zero."""
    if not isinstance(tokens, dict) or not {'input', 'output'} <= tokens.keys():
        return None
    values = [tokens['input'], tokens['output'], tokens.get('cache_read', 0)]
    if any(type(value) is not int or value < 0 for value in values):
        return None
    # No cache-write tariff is defined by this historical estimate.
    if type(tokens.get('cache_write', 0)) is not int or tokens.get('cache_write', 0) != 0:
        return None
    try:
        cost = ((values[0] + values[2]) * COST_PER_MTOK_INPUT
                + values[1] * COST_PER_MTOK_OUTPUT) / 1_000_000
    except OverflowError:
        return None
    return cost if math.isfinite(cost) else None


def trace_cost_usd(trace: dict) -> float | None:
    """Only account traces whose usage covers every observed model step."""
    if not isinstance(trace, dict) or 'error' in trace or trace.get('usage_complete') is not True:
        return None
    return estimate_cost_usd(trace.get('tokens'))


def _valid_cost(value) -> bool:
    try:
        return type(value) in (int, float) and value >= 0 and math.isfinite(value)
    except OverflowError:
        return False


class BudgetExhausted(RuntimeError):
    pass


class CostUnknown(BudgetExhausted):
    """Unreconciled usage must stop further paid-session admission."""


_USD_UNITS = 1_000_000_000
_PHASES = ('generation', 'selection', 'evaluation')


def _units(value, *, limit=False) -> int:
    if not _valid_cost(value):
        raise ValueError('amount must be finite and nonnegative')
    scaled = Decimal(str(value)) * _USD_UNITS
    return int(scaled.to_integral_value(rounding=ROUND_FLOOR if limit else ROUND_CEILING))


def _owner(pid=None) -> dict | None:
    """Linux process identity; PID reuse and zombies do not count as live owners."""
    pid = os.getpid() if pid is None else pid
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return {'pid': pid, 'start': fields[19]}
    except (OSError, IndexError):
        return None


class SessionBudget:
    """Single-file ledger with POSIX lock/reload and atomic durable updates.

    Monetary mode requires explicit per-operation reservations. Legacy
    acquire/charge remains a count-only compatibility API and cannot be used
    on a monetary ledger. A declared reservation is an admission bound, not
    proof of a provider invoice ceiling.
    """
    def __init__(self, path: str | Path, cap: int | None = None,
                 max_cost_usd: float | None = None):
        self.path = Path(path).resolve()
        if cap is not None and (type(cap) is not int or cap <= 0):
            raise ValueError('session limit must be a positive integer')
        self._cap = cap
        self._limit = _units(max_cost_usd, limit=True) if max_cost_usd is not None else None
        self._lock = threading.Lock()
        with self._transaction() as state:
            if state.get('version') == 2 and not self.path.exists():
                self._save(state)

    def _load(self) -> dict:
        if self.path.exists():
            if self.path.stat().st_nlink != 1:
                raise ValueError('hardlinked ledger cannot be atomically updated without forking')
            state = json.loads(self.path.read_text(encoding='utf-8'))
            if not isinstance(state, dict):
                raise ValueError('invalid budget schema')
            if ('version' in state and (type(state['version']) is not int or state['version'] != 2)
                    or 'version' not in state and any(key in state for key in
                        ('ledger_id', 'max_cost_units', 'operations'))):
                raise ValueError('unsupported budget schema version; refusing legacy fallback')
            if state.get('version') == 2:
                self._validate(state)
                if ((self._cap is not None and self._cap != state['cap']) or
                        (self._limit is not None and self._limit != state['max_cost_units'])):
                    raise ValueError('ledger limits are immutable; use the original limits')
                return state
            cost = state['cost_usd']
            if self._cap is not None and self._cap != state.get('cap'):
                raise ValueError('legacy session limit differs; explicit migration is required')
            known = state.setdefault('known_cost_usd', cost)
            if not _valid_cost(known) or (cost is not None and not _valid_cost(cost)):
                raise ValueError('invalid budget cost state; inspect the ledger before execution')
            if self._limit is None:
                return state
            if state['sessions_used'] or cost != 0:
                raise ValueError('nonempty legacy ledger requires explicit audited migration')
        if self._limit is not None:
            return {'version': 2, 'ledger_id': uuid.uuid4().hex,
                    'cap': self._cap or 40, 'max_cost_units': self._limit,
                    'operations': {}, 'started': time.time()}
        return {'sessions_used': 0, 'cost_usd': 0.0, 'cap': self._cap or 40,
                'known_cost_usd': 0.0, 'unknown_cost_sessions': 0,
                'started': time.strftime('%Y-%m-%d %H:%M:%S')}

    @contextmanager
    def _transaction(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, open(str(self.path) + '.lock', 'a+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield self._load()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _save(self, state) -> None:
        """Caller holds the stable lock file; never lock the replaced inode."""
        if state.get('version') == 2:
            state.update(self._totals(state))
        data = json.dumps(state, indent=2, allow_nan=False) + '\n'
        fd, temporary = tempfile.mkstemp(prefix=self.path.name + '.', dir=self.path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def _validate(state):
        def count(value):
            return type(value) is int and value >= 0
        def require(condition):
            if not condition:
                raise ValueError('invalid monetary ledger; preserve and inspect its bytes')
        try:
            require(isinstance(state['ledger_id'], str) and state['ledger_id'])
            require(count(state['cap']) and state['cap'] > 0)
            require(count(state['max_cost_units']))
            require(isinstance(state['operations'], dict))
            for key, op in state['operations'].items():
                require(key and key == op['operation_id'])
                require(op['phase'] in _PHASES and count(op['reserved_units']))
                require(op['status'] in ('reserved', 'settled', 'unknown'))
                require((count(op['cost_units']) if op['status'] == 'settled' else op['cost_units'] is None))
                require(isinstance(op['metadata'], dict) and isinstance(op['receipts'], list))
                require(count(op['owner']['pid']) and op['owner']['pid'] > 0)
                require(isinstance(op['owner']['start'], str))
            totals = SessionBudget._totals(state)
            for key in ('cost_usd', 'known_cost_usd', 'sessions_used', 'reserved_cost_usd'):
                require(key in state and state[key] == totals[key])
        except (AssertionError, KeyError, TypeError):
            raise ValueError('invalid monetary ledger; preserve and inspect its bytes') from None

    @staticmethod
    def _totals(state) -> dict:
        def part(operations):
            operations = list(operations)
            known = sum(op['cost_units'] for op in operations if op['status'] == 'settled')
            held = sum(op['reserved_units'] for op in operations if op['status'] != 'settled')
            uncertain = any(op['status'] != 'settled' for op in operations)
            return {'sessions_used': len(operations), 'known_cost_usd': known / _USD_UNITS,
                    'cost_usd': None if uncertain else known / _USD_UNITS,
                    'reserved_cost_usd': held / _USD_UNITS}
        operations = state['operations'].values()
        return {**part(operations), 'max_cost_usd': state['max_cost_units'] / _USD_UNITS,
                'phases': {phase: part(op for op in operations if op['phase'] == phase)
                           for phase in _PHASES}}

    @staticmethod
    def _blocked(state):
        for op in state['operations'].values():
            if op.get('overrun'):
                return 'budget:reservation_overrun'
            if op['status'] == 'unknown':
                return 'budget:unknown_cost'
            if op['status'] == 'reserved' and _owner(op['owner']['pid']) != op['owner']:
                return 'budget:unresolved_reservation'
        return None

    def snapshot(self) -> dict:
        with self._transaction() as state:
            if state.get('version') == 2:
                state.update(self._totals(state))
                state['blocked_reason'] = self._blocked(state)
            return copy.deepcopy(state)

    @classmethod
    def inspect(cls, path: str | Path) -> dict:
        """Read an atomic ledger snapshot without creating files or acquiring work."""
        instance = cls.__new__(cls)
        instance.path = Path(path).resolve()
        instance._cap = instance._limit = None
        if not instance.path.is_file():
            raise FileNotFoundError(f'budget ledger does not exist: {instance.path}')
        state = instance._load()
        if not instance.path.is_file():
            raise FileNotFoundError('budget ledger was removed during inspection')
        if state.get('version') == 2:
            state.update(cls._totals(state))
            state['blocked_reason'] = cls._blocked(state)
        return state

    @property
    def monetary(self) -> bool:
        return self.snapshot().get('version') == 2

    @property
    def cap(self) -> int:
        return self.snapshot()['cap']

    @property
    def sessions_used(self) -> int:
        return self.snapshot()['sessions_used']

    @property
    def cost_usd(self) -> float | None:
        return self.snapshot()['cost_usd']

    @property
    def known_cost_usd(self) -> float:
        return self.snapshot()['known_cost_usd']

    @property
    def remaining(self) -> int:
        state = self.snapshot()
        return state['cap'] - state['sessions_used']

    def reserve(self, operation_id: str, max_cost_usd: float, *, phase: str,
                metadata: dict | None = None) -> str:
        amount = _units(max_cost_usd)
        if not isinstance(operation_id, str) or not operation_id or phase not in _PHASES:
            raise ValueError('reservation needs an operation ID and supported phase')
        if metadata is not None and not isinstance(metadata, dict):
            raise ValueError('reservation metadata must be an object')
        metadata = json.loads(json.dumps(metadata or {}, allow_nan=False))
        owner = _owner()
        if owner is None:
            raise BudgetExhausted('cannot identify reservation owner on this platform')
        with self._transaction() as state:
            if state.get('version') != 2:
                raise BudgetExhausted('monetary reservation requires an explicit amount limit')
            operations = state['operations']
            if operation_id in operations:
                raise BudgetExhausted('operation already reserved; inspect its receipt, never re-execute')
            for op in operations.values():
                if op['status'] == 'unknown':
                    raise CostUnknown('unknown operation cost; reconcile its receipt')
                if op.get('overrun'):
                    raise BudgetExhausted('reservation amount overrun; further admission stopped')
                if op['status'] == 'reserved' and _owner(op['owner']['pid']) != op['owner']:
                    raise CostUnknown('unresolved reservation from an exited owner; reconcile before new calls')
            if len(operations) >= state['cap']:
                raise BudgetExhausted('session cap reached; refusing reservation')
            exposure = sum(op['cost_units'] if op['status'] == 'settled' else op['reserved_units']
                           for op in operations.values())
            if exposure + amount > state['max_cost_units']:
                raise BudgetExhausted('amount cap reached; refusing reservation')
            operations[operation_id] = {'operation_id': operation_id, 'phase': phase,
                'reserved_units': amount, 'status': 'reserved', 'cost_units': None,
                'metadata': metadata, 'owner': owner, 'reserved_at': time.time(),
                'receipts': []}
            self._save(state)
        return operation_id

    @staticmethod
    def _request_hash(op):
        request = {key: op[key] for key in ('operation_id', 'phase', 'reserved_units', 'metadata')}
        return hashlib.sha256(json.dumps(request, sort_keys=True, allow_nan=False).encode()).hexdigest()

    def stage_receipt(self, operation_id: str, cost_usd: float | None, *,
                      receipt_id: str, evidence: dict | None = None) -> Path:
        """Durably retain a bound receipt before ledger settlement.

        This records trusted caller evidence, not provider authentication.
        A crash after this returns can be recovered by reconcile(path).
        """
        if not isinstance(receipt_id, str) or not receipt_id:
            raise ValueError('receipt needs a stable nonempty identity')
        cost = _units(cost_usd) if _valid_cost(cost_usd) else None
        with self._transaction() as state:
            if state.get('version') != 2 or operation_id not in state['operations']:
                raise ValueError('receipt has no matching reservation')
            op = state['operations'][operation_id]
            payload = {'version': 1, 'ledger_id': state['ledger_id'],
                       'operation_id': operation_id, 'request_hash': self._request_hash(op),
                       'receipt_id': receipt_id, 'cost_units': cost, 'evidence': evidence or {}}
            data = (json.dumps(payload, sort_keys=True, allow_nan=False) + '\n').encode()
            digest = hashlib.sha256(data).hexdigest()
            directory = Path(str(self.path) + '.receipts')
            directory.mkdir(exist_ok=True)
            parent_fd = os.open(directory.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(parent_fd)  # persist the newly created receipt-directory entry
            finally:
                os.close(parent_fd)
            dest = directory / (digest + '.json')
            fd, temporary = tempfile.mkstemp(prefix='.staging-', dir=directory)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    os.link(temporary, dest)  # immutable create, never replace a receipt
                except FileExistsError:
                    if dest.read_bytes() != data:
                        raise ValueError('conflicting immutable receipt')
                directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                os.unlink(temporary)
        return dest

    def settle(self, operation_id: str, cost_usd: float | None, *,
               receipt_id: str, evidence: dict | None = None) -> Path:
        receipt = self.stage_receipt(operation_id, cost_usd, receipt_id=receipt_id, evidence=evidence)
        self.reconcile(receipt)
        return receipt

    def reconcile(self, receipt_path: str | Path) -> None:
        """Apply a staged receipt exactly once; never run or refund an operation."""
        path = Path(receipt_path)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if path.name != digest + '.json':
            raise ValueError('receipt content hash does not match its immutable filename')
        receipt = json.loads(data)
        if not isinstance(receipt, dict):
            raise ValueError('receipt must be a JSON object')
        cost = receipt.get('cost_units')
        if (receipt.get('version') != 1 or not isinstance(receipt.get('receipt_id'), str)
                or not receipt['receipt_id'] or
                (cost is not None and (type(cost) is not int or cost < 0))):
            raise ValueError('invalid receipt')
        overrun = False
        with self._transaction() as state:
            if state.get('version') != 2 or receipt.get('ledger_id') != state['ledger_id']:
                raise ValueError('receipt belongs to a different ledger')
            op = state['operations'].get(receipt.get('operation_id'))
            if op is None or receipt.get('request_hash') != self._request_hash(op):
                raise ValueError('receipt does not match this operation request')
            if any(entry['hash'] == digest for entry in op['receipts']):
                if op.get('overrun'):
                    raise BudgetExhausted('reservation amount overrun; receipt already retained')
                return
            if op['status'] == 'settled':
                raise ValueError('operation already settled; conflicting receipt rejected')
            if (op['status'] == 'reserved' and op['owner'] != _owner()
                    and _owner(op['owner']['pid']) == op['owner']):
                raise BudgetExhausted('operation owner is still active; do not reconcile concurrently')
            if any(entry['receipt_id'] == receipt['receipt_id']
                   for item in state['operations'].values() for entry in item['receipts']):
                raise ValueError('receipt identity was already used')
            op['status'] = 'unknown' if cost is None else 'settled'
            op['cost_units'] = cost
            op['receipts'].append({'hash': digest, 'receipt_id': receipt['receipt_id'],
                                   'path': str(path.resolve()), 'applied_at': time.time(),
                                   'cost_units': cost})
            overrun = cost is not None and cost > op['reserved_units']
            op['overrun'] = overrun
            self._save(state)
        if overrun:
            raise BudgetExhausted('reservation amount overrun; full actual cost retained')

    def acquire(self) -> None:
        """Legacy count-only API; monetary callers must use reserve/settle."""
        with self._transaction() as state:
            if state.get('version') == 2:
                raise BudgetExhausted('explicit operation reservation is required')
            if state['cost_usd'] is None:
                raise CostUnknown('unknown session cost; reconcile the retained ledger before more calls')
            if state['sessions_used'] >= state['cap']:
                raise BudgetExhausted(f"session cap reached ({state['cap']}); refusing to spawn more")
            state['sessions_used'] += 1
            self._save(state)

    def charge(self, cost_usd: float | None = None) -> None:
        """Legacy count-only settlement; cannot bypass a monetary reservation."""
        with self._transaction() as state:
            if state.get('version') == 2:
                raise BudgetExhausted('explicit operation reservation settlement is required')
            if not _valid_cost(cost_usd):
                state['cost_usd'] = None
                state['unknown_cost_sessions'] = state.get('unknown_cost_sessions', 0) + 1
            else:
                state['known_cost_usd'] = round(state['known_cost_usd'] + cost_usd, 6)
                if state['cost_usd'] is not None:
                    state['cost_usd'] = state['known_cost_usd']
            self._save(state)

    def status_line(self) -> str:
        state = self.snapshot()
        cost = (f"cost unknown; known subtotal ~${state['known_cost_usd']:.6f}"
                if state['cost_usd'] is None else f"~${state['cost_usd']:.4f} est.")
        return f"sessions {state['sessions_used']}/{state['cap']} ({cost})"
