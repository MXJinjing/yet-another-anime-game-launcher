#!/usr/bin/env python3
"""Native uv + protoc 31.1 + Nuitka build. --plan validates foreign configurations."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request
import zipfile
ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT / 'sophon_server'
SOURCE = PROJECT / 'src'
PROTO = PROJECT / 'proto'
sys.path.insert(0, str(SOURCE))
from infrastructure.platform import normalize_arch
VERSION = '31.1'


def configuration(target, arch, hpatchz=None, python=None):
    suffix = '.exe' if target == 'win32' else ''
    assets = {('linux', 'x64'): 'linux-x86_64', ('linux', 'arm64'): 'linux-aarch_64',
              ('win32', 'x64'): 'win64', ('darwin', 'x64'): 'osx-universal_binary',
              ('darwin', 'arm64'): 'osx-universal_binary'}
    if (target, arch) not in assets:
        raise ValueError(f'Unsupported build target: {target}/{arch}')
    interpreter = python or os.environ.get('SOPHON_PYTHON')
    patch = Path(hpatchz or os.environ.get('SOPHON_HPATCHZ') or
                 ROOT / 'sidecar' / arch / 'hpatchz' / ('hpatchz' + suffix)).expanduser().resolve()
    out = PROJECT / ('build-x64' if arch == 'x64' else 'build')
    command = ([interpreter, '-m', 'nuitka'] if interpreter else ['uv', 'run', '--project', str(PROJECT), '--locked', 'nuitka'])
    command += ['--warn-implicit-exceptions', '--warn-unusual-code', '--standalone',
                '--python-flag=isolated', '--output-filename=sophon-server' + suffix,
                '--output-dir=' + str(out), '--assume-yes-for-downloads', str(SOURCE / 'server.py')]
    return dict(platform=target, arch=arch, hpatchz=str(patch),
                protoc_url=f'https://github.com/protocolbuffers/protobuf/releases/download/v{VERSION}/protoc-{VERSION}-{assets[target, arch]}.zip',
                protoc=str(ROOT / '.cache' / 'protoc' / f'{target}-{arch}' / 'bin' / ('protoc' + suffix)),
                command=command, distribution=str(out / 'server.dist'), python=interpreter)


def run(command):
    subprocess.run(command, cwd=ROOT, check=True)



def isolate_pycurl_openssl(distribution, python_command):
    """Keep PyCURL's wheel OpenSSL separate from Python's same-named libraries.

    Nuitka flattens dylibs into the distribution directory. PyCURL wheels can
    require a newer OpenSSL than Python, so their consumers need distinct names.
    """
    wheel = Path(subprocess.check_output(
        [*python_command, '-c',
         'import pathlib, pycurl; print(pathlib.Path(pycurl.__file__).parent / ".dylibs")'],
        cwd=ROOT, text=True).strip())
    names = ('libssl.3.dylib', 'libcrypto.3.dylib')
    for name in names:
        if not (wheel / name).is_file():
            raise RuntimeError(f'PyCURL wheel dependency missing: {wheel / name}')
    distribution = Path(distribution)
    isolated = {name: distribution / ('pycurl-' + name) for name in names}
    for name, destination in isolated.items():
        shutil.copy2(wheel / name, destination)
        run(['install_name_tool', '-id', '@loader_path/' + destination.name, str(destination)])
    # Only PyCURL consumers are rewritten; Python's _ssl keeps its own OpenSSL.
    consumers = list(isolated.values())
    for source in wheel.glob('*.dylib'):
        if source.name not in isolated:
            bundled = distribution / source.name
            if not bundled.is_file():
                raise RuntimeError(f'Bundled PyCURL dependency missing: {bundled}')
            consumers.append(bundled)
    extensions = list((distribution / 'pycurl').glob('_pycurl*.so'))
    if not extensions:
        raise RuntimeError('Bundled PyCURL extension missing')
    consumers.extend(extensions)
    for consumer in consumers:
        dependencies = subprocess.check_output(['otool', '-L', str(consumer)], text=True)
        changed = consumer in isolated.values()
        for line in dependencies.splitlines()[1:]:
            dependency = line.strip().split(' (', 1)[0]
            destination = isolated.get(Path(dependency).name)
            if destination is None:
                continue
            # The dylib ID was already changed above; this edits load commands.
            relative = os.path.relpath(destination, consumer.parent)
            replacement = '@loader_path/' + relative
            if dependency != replacement:
                run(['install_name_tool', '-change', dependency, replacement, str(consumer)])
                changed = True
        if changed:
            run(['codesign', '--force', '--sign', '-', str(consumer)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['linux', 'win32', 'darwin'], default=sys.platform)
    parser.add_argument('--arch', default=os.environ.get('SOPHON_ARCH', normalize_arch(platform.machine())), choices=['x64', 'arm64'])
    parser.add_argument('--hpatchz')
    parser.add_argument('--python')
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--generate-only', action='store_true')
    args = parser.parse_args()
    config = configuration(args.platform, args.arch, args.hpatchz, args.python)
    if args.plan:
        print(json.dumps(config, indent=2))
        return
    if args.platform != sys.platform or args.arch != normalize_arch(platform.machine()):
        parser.error('Native builds only: use --plan to inspect other platforms. Run with a matching Python architecture.')
    patch = Path(config['hpatchz'])
    if not args.generate_only and not patch.is_file():
        parser.error(f'hpatchz required for packaging: {patch}; pass --hpatchz with a native executable')
    protoc = Path(config['protoc'])
    if not protoc.is_file():
        protoc.parent.mkdir(parents=True, exist_ok=True)
        archive = protoc.parent.parent / 'protoc.zip'
        urllib.request.urlretrieve(config['protoc_url'], archive)
        with zipfile.ZipFile(archive) as bundle:
            member = 'bin/' + protoc.name
            protoc.write_bytes(bundle.read(member))
        protoc.chmod(0o755)
        archive.unlink()
    version = subprocess.check_output([str(protoc), '--version'], text=True).strip()
    if version != 'libprotoc ' + VERSION:
        raise RuntimeError(f'Unexpected protoc version: {version}')
    run([str(protoc), '-I' + str(PROTO), '--python_out=' + str(SOURCE), *map(str, sorted(PROTO.glob('*.proto')))])
    if args.generate_only:
        return
    if not config['python']:
        run(['uv', 'sync', '--project', str(PROJECT), '--locked'])
    os.environ.setdefault('NUITKA_CACHE_DIR', str(ROOT / '.cache'))
    run(config['command'])
    if sys.platform == 'darwin':
        python_command = ([config['python']] if config['python'] else
                          ['uv', 'run', '--project', str(PROJECT), '--locked', 'python'])
        isolate_pycurl_openssl(config['distribution'], python_command)
    # Executables are copied after compilation, rather than treated as Nuitka data.
    destination = Path(config['distribution']) / ('hpatchz.exe' if sys.platform == 'win32' else 'hpatchz')
    shutil.copy2(patch, destination)
    if sys.platform != 'win32':
        destination.chmod(destination.stat().st_mode | 0o111)
    shutil.copy2(PROJECT / 'licenses' / 'hpatchz.txt', destination.parent)


if __name__ == '__main__':
    main()
