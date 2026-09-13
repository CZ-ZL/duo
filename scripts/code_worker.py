"""Trusted namespace setup and unittest worker, launched only by code_evaluation."""
import contextlib
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import types
import unittest


def isolate(root):
    # Failures abort before any candidate code is compiled or executed.
    def mount(*args):
        subprocess.run(['/usr/bin/mount', *args], check=True, stdout=subprocess.DEVNULL)
    mount('--make-rprivate', '/')
    mount('-t', 'tmpfs', '-o', 'size=32m,nosuid,nodev', 'tmpfs', root)
    base = Path(root)
    for name in ['usr', 'work', 'tmp', 'dev']:
        (base / name).mkdir()
    # Preserve locked read-only WSL submounts; a nonrecursive bind is EINVAL.
    mount('--rbind', '/usr', str(base / 'usr'))
    mount('-o', 'remount,bind,ro,nosuid,nodev', str(base / 'usr'))
    for name in ['bin', 'lib', 'lib64']:
        if Path('/' + name).exists():
            (base / name).symlink_to('usr/' + name)
    (base / 'dev/null').touch()
    mount('--bind', '/dev/null', str(base / 'dev/null'))
    # Load the library before chroot, then remove all paths into the host root.
    seccomp = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    os.chroot(root)
    os.chdir('/work')
    # Parent wall timeout (normally 6 s) is authoritative. Keep a CPU backstop
    # above it: unittest's own large-dictionary failure diff can exceed 2 s.
    for limit, value in [(resource.RLIMIT_CPU, 10), (resource.RLIMIT_AS, 256 * 1024 * 1024),
                         (resource.RLIMIT_FSIZE, 1024 * 1024), (resource.RLIMIT_NOFILE, 64),
                         (resource.RLIMIT_CORE, 0)]:
        resource.setrlimit(limit, (value, value))
    # Namespace root must not retain mount/chroot or privilege capabilities.
    libc = ctypes.CDLL(None, use_errno=True)
    class Header(ctypes.Structure):
        _fields_ = [('version', ctypes.c_uint32), ('pid', ctypes.c_int)]
    class Caps(ctypes.Structure):
        _fields_ = [('effective', ctypes.c_uint32), ('permitted', ctypes.c_uint32), ('inheritable', ctypes.c_uint32)]
    if libc.prctl(38, 1, 0, 0, 0) or libc.capset(ctypes.byref(Header(0x20080522, 0)), (Caps * 2)()):
        raise RuntimeError('Could not drop namespace privileges')
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    policy = seccomp.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not policy:
        raise RuntimeError('seccomp unavailable')
    # Forbid process/network creation and changes to the established containment.
    denied = ['clone', 'clone3', 'fork', 'vfork', 'execve', 'execveat', 'socket', 'socketpair',
              'mount', 'umount2', 'pivot_root', 'chroot', 'unshare', 'setns', 'ptrace',
              'fsopen', 'fsconfig', 'fsmount', 'move_mount', 'open_tree', 'mount_setattr',
              'process_vm_readv', 'process_vm_writev', 'open_by_handle_at', 'bpf', 'perf_event_open',
              'setrlimit', 'prlimit64', 'capset', 'prctl', 'userfaultfd', 'io_uring_setup',
              'mknod', 'mknodat', 'keyctl', 'add_key', 'request_key', 'reboot']
    try:
        for name in denied:
            number = seccomp.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and seccomp.seccomp_rule_add(policy, 0x00050000 | 1, number, 0) != 0:
                raise RuntimeError('seccomp rule rejected: ' + name)
        if seccomp.seccomp_load(policy) != 0:
            raise RuntimeError('seccomp policy could not load')
    finally:
        seccomp.seccomp_release(policy)


class Results(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.rows = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.rows.append({'name': test.id(), 'status': 'passed'})

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.rows.append({'name': test.id(), 'status': 'failed', 'error': str(error[1])[:1500]})

    def addError(self, test, error):
        super().addError(test, error)
        self.rows.append({'name': test.id(), 'status': 'error', 'error': str(error[1])[:1500]})


def bounded_dict_assert(self, actual, expected, msg=None):
    # Same type checks and equality predicate as unittest.assertDictEqual.
    # Only failure rendering changes: ndiff on 1,000 similar lines can exhaust
    # the task wall limit while the candidate itself has already finished.
    self.assertIsInstance(actual, dict, 'First argument is not a dictionary')
    self.assertIsInstance(expected, dict, 'Second argument is not a dictionary')
    if actual != expected:
        differences = [repr(k)[:120] for k in list(actual)[:1000] if k not in expected or actual[k] != expected[k]][:5]
        self.fail(self._formatMessage(msg, f'Dictionary mismatch: actual keys={len(actual)}, expected keys={len(expected)}, differing keys={differences}'))


def main():
    payload = json.load(sys.stdin)
    code, tests = payload['code'], payload['test']
    isolate(sys.argv[1])
    row = {'status': 'completed', 'taskPassed': False, 'passed': 0, 'planned': 0, 'tests': [],
           'codeSha256': hashlib.sha256(code.encode()).hexdigest(),
           'testSha256': hashlib.sha256(tests.encode()).hexdigest()}
    try:
        compiled = compile(code, '<candidate>', 'exec')
    except SyntaxError as error:
        row.update(status='syntax_error', error=str(error))
    else:
        module = types.ModuleType('__candidate__')
        sys.modules[module.__name__] = module
        namespace = module.__dict__
        with open('/dev/null', 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            try:
                exec(compiled, namespace)
                exec(compile(tests, '<benchmark-tests>', 'exec'), namespace)
                if namespace['TestCases'].assertDictEqual is unittest.TestCase.assertDictEqual:
                    namespace['TestCases'].assertDictEqual = bounded_dict_assert
                suite = unittest.defaultTestLoader.loadTestsFromTestCase(namespace['TestCases'])
                row['planned'] = suite.countTestCases()
                result = Results()
                suite.run(result)
                row.update(passed=sum(r['status'] == 'passed' for r in result.rows), tests=result.rows)
                row['taskPassed'] = row['planned'] > 0 and row['passed'] == row['planned'] and result.wasSuccessful()
            except BaseException as error:
                row.update(status='runtime_error', error=type(error).__name__ + ': ' + str(error)[:1500])
    print(json.dumps(row))


if __name__ == '__main__':
    main()
