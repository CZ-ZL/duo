# Fixed finite property domain; appended to existing tests, never candidate input.
import itertools as _property_itertools
import json as _property_json

class TestCases(TestCases):
    pass


def _make_combination_property(values, r, translate):
    # Index subsets are independent of itertools.combinations.
    indices = sorted(tuple(i for i in range(len(values)) if mask & (1 << i))
                     for mask in range(1 << len(values)) if mask.bit_count() == r)
    expected = [tuple(values[i] for i in index) for index in indices]
    def check(self):
        observed = task_func(_property_json.dumps({'number_list': values}), r)
        self.assertEqual(observed, expected)
        if translate:
            shifted = task_func(_property_json.dumps({'number_list': [v + 7 for v in values]}), r)
            self.assertEqual(shifted, [tuple(v + 7 for v in row) for row in observed])
    return check


_case_index = 0
for _length in range(5):
    for _values in _property_itertools.product([-1, 0, 1], repeat=_length):
        for _r in range(_length + 2):
            for _translate in [False, True]:
                setattr(TestCases, f'test_extra_combinations_{_case_index:04d}_translation_{int(_translate)}',
                        _make_combination_property(_values, _r, _translate))
            _case_index += 1
