#!/usr/bin/env python3
"""Check or copy committed Sophon server sources, preserving launcher adapters."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "sophon_server"
LOCK = COMPONENT / "upstream-lock.json"
REPOSITORY = "https://github.com/MXJinjing/sophon"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def shared_files(component: Path) -> dict[str, Path]:
    """Only managed source files; never discover caches or generated protobuf."""
    result = {}
    for directory, suffix in [("src", ".py"), ("proto", ".proto"), ("tests", ".py")]:
        for path in sorted((component / directory).rglob("*")):
            if path.suffix != suffix or "__pycache__" in path.parts:
                continue
            if path.name.endswith("_pb2.py") or path.name.startswith("test_launcher_"):
                continue
            if directory == "tests" and path.name == "test_release_assets.py":
                continue
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Shared source must be a regular file: {path}")
            result[path.relative_to(component).as_posix()] = path
    return result


def source_snapshot(source: Path) -> tuple[str, dict[str, Path]]:
    component = source / "sophon-server"
    if not (component / "src/server.py").is_file():
        raise ValueError("--source must point to the standalone Sophon repository")
    # Copy the committed tree, not uncommitted work accidentally described by
    # an unrelated revision. Untracked source files are checked as well.
    status = subprocess.check_output(
        ["git", "-C", str(source), "status", "--porcelain", "--untracked-files=all", "--",
         "sophon-server/src", "sophon-server/proto", "sophon-server/tests", "LICENSE"], text=True,
    )
    if status.strip():
        raise ValueError("Commit shared Sophon changes before synchronizing")
    revision = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True,
    ).strip()
    files = shared_files(component)
    files["LICENSE"] = source / "LICENSE"
    if files["LICENSE"].is_symlink():
        raise ValueError("Source license must be a regular file")
    return revision, files


def safe_relative(name: str) -> Path:
    path = Path(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"Invalid path in revision lock: {name}")
    allowed = name == "LICENSE" or (
        len(path.parts) > 1 and path.parts[0] in {"src", "proto", "tests"}
        and not path.name.startswith("test_launcher_")
        and path.suffix in {".py", ".proto"}
    )
    if not allowed:
        raise ValueError(f"Unmanaged path in revision lock: {name}")
    return path


def synchronize(source: Path, destination: Path, lock_path: Path, apply: bool = False) -> dict:
    revision, upstream = source_snapshot(source)
    old = json.loads(lock_path.read_text()) if lock_path.exists() else None
    previous = old["files"] if old is not None else {}
    for name in previous:
        safe_relative(name)
    local = shared_files(destination)
    if (destination / "LICENSE").exists():
        local["LICENSE"] = destination / "LICENSE"
    conflicts = []
    for name in set(local) | set(previous):
        path = local.get(name)
        if path is None:
            if name in upstream:
                conflicts.append(name)  # A local deletion needs backporting too.
        elif name in previous:
            current = digest(path)
            if current != previous[name] and (name not in upstream or current != digest(upstream[name])):
                conflicts.append(name)
        elif name not in upstream or digest(path) != digest(upstream[name]):
            conflicts.append(name)
    # Reject symlink parents before writing or removing any file.
    for name in set(previous) | set(upstream):
        path = destination / safe_relative(name)
        if any(parent.is_symlink() for parent in [path, *path.parents]
               if parent == destination or destination in parent.parents):
            raise ValueError(f"Symlink in destination path: {name}")
    expected = {
        "schema_version": 1, "repository": REPOSITORY, "revision": revision,
        "files": {name: digest(path) for name, path in sorted(upstream.items())},
    }
    if conflicts:
        raise ValueError("Launcher shared files have unsynchronized edits; backport them to Sophon first: " + ", ".join(sorted(conflicts)))
    changes = [name for name, path in upstream.items()
               if name not in local or digest(local[name]) != digest(path)]
    changes += sorted(set(previous) - set(upstream))
    if not apply:
        if changes or old != expected:
            raise ValueError("Source copy needs synchronization; run with --apply after reviewing Sophon changes")
        return expected
    for name, path in upstream.items():
        target = destination / safe_relative(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    for name in set(previous) - set(upstream):
        (destination / safe_relative(name)).unlink(missing_ok=True)
    lock_path.write_text(json.dumps(expected, indent=2) + "\n")
    return expected


def verify_lock(destination: Path, lock_path: Path) -> dict:
    snapshot = json.loads(lock_path.read_text())
    if snapshot.get("schema_version") != 1 or snapshot.get("repository") != REPOSITORY:
        raise ValueError("Invalid Sophon revision lock")
    actual = shared_files(destination)
    actual["LICENSE"] = destination / "LICENSE"
    expected = snapshot["files"]
    for name in expected:
        safe_relative(name)
    if set(actual) != set(expected) or any(digest(actual[name]) != checksum for name, checksum in expected.items()):
        raise ValueError("Shared source differs from the revision lock; synchronize and commit both")
    return snapshot


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT.parent / "sophon")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Verify source copy and revision lock (default)")
    mode.add_argument("--apply", action="store_true", help="Copy committed shared sources into the launcher")
    mode.add_argument("--verify-lock", action="store_true", help="Verify local checksums without a Sophon checkout (CI)")
    args = parser.parse_args(argv)
    try:
        snapshot = (verify_lock(COMPONENT, LOCK) if args.verify_lock else
                    synchronize(args.source.expanduser().resolve(), COMPONENT, LOCK, args.apply))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Sophon synchronization failed: {error}\n")
    print(f"Sophon source copy {'updated' if args.apply else 'verified'}: {snapshot['revision']} ({len(snapshot['files'])} files)")


if __name__ == "__main__":
    main()
