"""Optional allocator tuning and executable discovery for each native platform."""
import ctypes
import os
import pathlib
import platform
import shutil
import sys


def normalize_arch(machine):
    aliases = {'amd64': 'x64', 'x86_64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}
    try:
        return aliases[machine.lower()]
    except KeyError:
        raise ValueError(f'Unsupported architecture: {machine}') from None


def resolve_hpatchz(root):
    name = 'hpatchz.exe' if sys.platform == 'win32' else 'hpatchz'
    if os.environ.get('SOPHON_HPATCHZ'):
        configured = pathlib.Path(os.environ['SOPHON_HPATCHZ']).expanduser().resolve()
        if not configured.is_file():
            raise FileNotFoundError(f'SOPHON_HPATCHZ not found: {configured}')
        return configured
    candidates = [root / name, root / 'HDiffPatch' / name,
                  root.parent / 'hpatchz' / name,
                  root / 'bin' / sys.platform / normalize_arch(platform.machine()) / name,
                  root.parent.parent / 'third_party' / 'hpatchz' / sys.platform / normalize_arch(platform.machine()) / name]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    found = shutil.which(name)
    if found:
        return pathlib.Path(found)
    # Allow server startup without the optional ldiff tool; fail when ldiff is used.
    return root / name


def memory_relief():
    if sys.platform == 'darwin':
        try:
            libc = ctypes.CDLL('libc.dylib')
            fn = libc.malloc_zone_pressure_relief
            fn.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
            fn.restype = ctypes.c_size_t
            fn(None, 1)
        except (OSError, AttributeError):
            pass
