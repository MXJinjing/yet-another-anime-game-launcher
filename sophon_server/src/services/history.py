"""Version-pinned hk4e operations, separate from the legacy launcher protocol."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import copy
import threading
import configparser
import fnmatch
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import ssl
import time
import tempfile
from urllib import parse, request

from pydantic import BaseModel, Field
from typing import Literal

VERSION_PATTERN = r'^\d+\.\d+\.\d+$'
CATEGORIES = Literal['game', 'en-us', 'zh-cn', 'ja-jp', 'ko-kr']


class HistoryRequest(BaseModel):
    gamedir: str
    game_type: Literal['hk4e'] = 'hk4e'
    region: Literal['os', 'cn', 'bb'] = 'os'
    version: str = Field(pattern=VERSION_PATTERN)
    categories: list[CATEGORIES] = Field(default_factory=lambda: ['game'], min_length=1)
    files: list[str] = Field(default_factory=list)
    tempdir: str | None = None
    download_speed_limit: int = Field(default=0, ge=0)
    download_threads: int = Field(default=8, ge=1, le=64)
    check_mode: Literal['quick', 'reliable'] = 'reliable'
    allow_downgrade: bool = False


def version_tuple(value):
    if not re.fullmatch(VERSION_PATTERN, value):
        raise ValueError('Version must be major.minor.patch')
    return tuple(map(int, value.split('.')))


def remote_json(url):
    with request.urlopen(url, timeout=60, context=ssl.create_default_context()) as response:
        data = json.load(response)
    if data.get('retcode') != 0 or not data.get('data'):
        raise ValueError(data.get('message') or 'Official API returned no data')
    return data['data']


def query_build(region, version=None):
    if region not in {'os', 'cn', 'bb'}:
        raise ValueError('Unsupported region')
    if version is not None:
        version_tuple(version)
    overseas = region == 'os'
    hyp = 'https://sg-hyp-api.hoyoverse.com' if overseas else 'https://hyp-api.mihoyo.com'
    ids = {'os': ('gopR6Cufr3', 'VYTpXlbWo8'), 'cn': ('1Z8W5NHUQb', 'jGHBHlcOq1'),
           'bb': ('T2S0Gz4Dr2', 'umfgRO5gh5')}
    gid, launcher = ids[region]
    branches = remote_json(hyp + '/hyp/hyp-connect/api/getGameBranches?' +
                           parse.urlencode({'game_ids[]': gid, 'launcher_id': launcher}))
    main = branches['game_branches'][0]['main']
    parameters = {name: main[name] for name in ('branch', 'package_id', 'password')}
    if version is not None:
        parameters['tag'] = version
    host = 'https://sg-public-api.hoyoverse.com' if overseas else 'https://api-takumi.mihoyo.com'
    build = remote_json(host + '/downloader/sophon_chunk/api/getBuild?' + parse.urlencode(parameters))
    actual = build.get('tag')
    if version is not None and actual != version:
        raise ValueError(f'Requested {version}, official API returned {actual}; refusing version fallback')
    version_tuple(actual)
    if not build.get('manifests'):
        raise ValueError(f'No downloadable manifests for {actual}')
    return {'retcode': 0, 'data': build}


def build_summary(region, version=None):
    build = query_build(region, version)['data']
    return {'game_type': 'hk4e', 'region': region, 'version': build['tag'],
            'categories': [{'category': item['matching_field'],
                            'manifest_id': item['manifest']['id'],
                            'manifest_compressed_size': int(item['manifest'].get('compressed_size', 0))}
                           for item in build['manifests']]}


def safe_path(root, filename):
    if not filename or '\\' in filename or PureWindowsPath(filename).drive:
        raise ValueError(f'Unsafe manifest path: {filename}')
    relative = PurePosixPath(filename)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError(f'Unsafe manifest path: {filename}')
    resolved = (root / filename).resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise ValueError(f'Manifest path escapes directory: {filename}')
    return resolved


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
    temp.replace(path)


def read_state(root):
    path = root / '.sophon' / 'state.json'
    if not path.exists():
        return None
    state = json.loads(path.read_text(encoding='utf-8'))
    if state.get('schema') != 1 or state.get('game_type') != 'hk4e':
        raise ValueError('Invalid Sophon directory state')
    return state


def local_version(root):
    cfg = configparser.ConfigParser()
    cfg.read(root / 'config.ini', encoding='utf-8-sig')
    return cfg.get('General', 'game_version', fallback=None)


def prepare_client(root, cache, region, build):
    from engine.runtime import Options
    from engine.client import SophonClient
    options = Options()
    options.gamedir = root
    options.game_type = 'hk4e'
    options.tempdir = cache
    cache.mkdir(parents=True, exist_ok=True)
    cli = SophonClient()
    cli.rel_type = region
    cli.initialize(options)
    cli.installed_ver = build['data']['tag']
    # Pin the response in memory instead of sharing stale getBuild.json caches.
    cli.get_getBuild_json = lambda is_new_file: build
    return cli


def files_info(region, version, category, pattern='*', offset=0, limit=100,
               path=None, recursive=False, refresh=False):
    from services.manifest_browser import browse_files
    # Preserve old pattern-only API callers while new clients explicitly send path.
    return browse_files(region, version, category, path or '.',
                        pattern if pattern != '*' or path is None else None,
                        offset, limit, recursive or path is None, refresh)


def inspect_file(root, item, reliable):
    path = safe_path(root, item.filename)
    if item.flags == 64:
        return None  # Directory-only manifest entries carry no content hash.
    if not path.is_file():
        return 'missing'
    if path.stat().st_size != item.size:
        return 'size mismatch'
    if reliable:
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'md5').hexdigest()
        if digest.lower() != item.md5.lower():
            return 'md5 mismatch'
    return None


def write_config(root, region, version):
    path = root / 'config.ini'
    if path.exists():
        text = path.read_text(encoding='utf-8-sig')
        section = re.search(r'(?ms)^\[General\]\r?\n.*?(?=^\[|\Z)', text)
        if not section:
            raise ValueError('config.ini has no General section')
        updated, count = re.subn(r'(?m)^(game_version\s*=)[^\r\n]*',
                                lambda match: match.group(1) + version, section.group(), count=1)
        if count != 1:
            raise ValueError('config.ini has no game_version')
        text = text[:section.start()] + updated + text[section.end():]
    else:
        text = ('[General]\nchannel=' + ('14' if region == 'bb' else '1') +
                '\ncps=' + ('bilibili' if region == 'bb' else 'mihoyo') +
                '\ngame_version=' + version + '\nsdk_version=\nsub_channel=' +
                ('1' if region == 'cn' else '0') + '\n')
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=root,
                                     prefix='.sophon-config-', delete=False) as stream:
        stream.write(text)
        temp = Path(stream.name)
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def run_history(manager, tasks, task_id, operation, payload, cancel_event, pause_event):
    from engine.files import compare_game_versions
    from engine.control import wait_if_paused
    from services.progress import InstallProgressHandler
    from infrastructure.errors import TaskCancelledError
    root = Path(payload.gamedir).expanduser().resolve()
    if root == Path(root.anchor) or root == Path.home().resolve():
        raise ValueError('Use a dedicated game directory')
    if operation in {'sync', 'check', 'repair'} and not root.is_dir():
        raise ValueError('Existing game directory required')
    state = read_state(root) if root.exists() else None
    current = local_version(root) if root.exists() else None
    safe_path(root, '.sophon/state.json')
    if state and state['region'] != payload.region:
        raise ValueError('Region differs from registered installation state')
    if current and operation != 'download':
        cfg = configparser.ConfigParser()
        cfg.read(root / 'config.ini', encoding='utf-8-sig')
        detected = 'bb' if cfg.get('General', 'channel', fallback='1') == '14' else ('cn' if cfg.get('General', 'sub_channel', fallback='0') == '1' else 'os')
        if detected != payload.region:
            raise ValueError('Region does not match config.ini')
    if operation == 'install' and root.exists() and any(root.iterdir()):
        if not state or state.get('pending_version') != payload.version or state.get('version'):
            raise ValueError('Install requires an empty directory or a matching interrupted Sophon installation')
    if operation == 'sync' and current and compare_game_versions(current, payload.version) > 0 and not payload.allow_downgrade:
        raise ValueError('Downgrade requires allow_downgrade=true')
    if operation in {'check', 'repair'} and current and current != payload.version:
        raise ValueError(f'Installed version {current} differs from requested {payload.version}; use sync to change version')
    build = query_build(payload.region, payload.version)  # Validate exact tag before directory writes.
    root.mkdir(parents=True, exist_ok=True)
    cache = Path(payload.tempdir).expanduser().resolve() if payload.tempdir else (root / '.tmp').resolve()
    if payload.tempdir is None and not cache.is_relative_to(root):
        raise ValueError('Default cache directory resolves outside game directory')
    if cache == root or root.is_relative_to(cache):
        raise ValueError('Cache directory must not contain the game directory')
    cli = prepare_client(root, cache / 'history' / payload.region / payload.version, payload.region, build)
    progress = InstallProgressHandler(task_id, manager, tasks)
    progress.job_start()
    planned = []
    found = set()
    signatures = {}
    categories = list(dict.fromkeys(payload.categories + ((state or {}).get('categories', []) if operation == 'sync' else [])))
    for category in categories:
        cli.load_manifest(category)
        category_json = cli.di_chunks.category_json
        for item in cli.di_chunks.manifest.files:
            safe_path(root, item.filename)
            safe_path(cache / 'history' / payload.region / payload.version, 'files/' + item.filename)
            if item.flags not in {0, 64}:
                raise ValueError(f'Unsupported manifest flags: {item.flags}')
            if not payload.files or item.filename in payload.files:
                signature = (item.size, item.md5, item.flags)
                if item.filename in signatures:
                    if signatures[item.filename] != signature:
                        raise ValueError(f'Conflicting category entries for {item.filename}')
                    continue
                signatures[item.filename] = signature
                planned.append((category, item, category_json))
                found.add(item.filename)
    missing = set(payload.files) - found
    if missing:
        raise ValueError('Files not found in selected version/categories: ' + ', '.join(sorted(missing)))
    if not planned:
        raise ValueError('No files selected')
    if operation in {'install', 'sync'}:
        atomic_json(root / '.sophon' / 'state.json',
                    {**(state or {}), 'schema': 1, 'game_type': 'hk4e', 'region': payload.region,
                     'pending_version': payload.version})
    total_download = sum(chunk.compressed_size for _, item, _ in planned for chunk in item.chunks)
    if operation == 'check':
        manager.send_message_threadsafe({'type': 'repair_summary', 'task_id': task_id,
            'repair_mode': payload.check_mode, 'total_files': len(planned)}, task_id)
    else:
        progress.download_summary(payload.version, total_download, len(planned), categories)
    issues = []
    downloads = []
    for index, (category, item, category_json) in enumerate(planned, 1):
        wait_if_paused(pause_event, cancel_event)
        reason = inspect_file(root, item, payload.check_mode == 'reliable')
        if reason:
            issues.append({'filename': item.filename, 'reason': reason})
        if operation in {'check', 'repair'}:
            manager.send_message_threadsafe({'type': 'check_file', 'task_id': task_id,
                'filename': item.filename, 'requires_repair': bool(reason), 'reason': reason or '',
                'overall_progress': {'checked_files': index, 'total_files': len(planned),
                                     'overall_percent': index / len(planned) * 100}}, task_id)
        if operation != 'check' and (operation != 'repair' or reason):
            # Each worker gets independent category metadata and per-file chunk cache.
            worker = copy.copy(cli)
            worker.di_chunks = copy.copy(cli.di_chunks)
            worker.di_chunks.category_json = category_json
            worker._history_chunk_directory = cache / 'history' / payload.region / payload.version / 'chunks' / hashlib.sha256(item.filename.encode()).hexdigest()
            downloads.append((worker, item))

    stopped = threading.Event()
    class WorkerCancellation:
        def is_set(self):
            return stopped.is_set() or cancel_event.is_set()
        def wait(self, timeout=None):
            deadline = None if timeout is None else time.monotonic() + timeout
            while not self.is_set():
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0: return False
                stopped.wait(min(0.05, remaining) if remaining is not None else 0.05)
            return True
    worker_cancel = WorkerCancellation()
    def download(entry):
        worker, item = entry
        wait_if_paused(pause_event, worker_cancel)
        for attempt in range(3):
            try:
                worker.download_game_file(item, install_progress_handler=progress,
                                          cancel_event=worker_cancel, pause_event=pause_event)
                break
            except TaskCancelledError:
                raise
            except Exception:
                if attempt == 2: raise
                wait_if_paused(pause_event, worker_cancel)
                if worker_cancel.wait(0.5): raise TaskCancelledError('cancelled')
        post_reason = inspect_file(root, item, True)
        if post_reason: raise ValueError(f'Post-download check failed: {item.filename}: {post_reason}')

    if downloads:
        # Bound queued work too; stop peers on failure without marking the user task cancelled.
        entries = iter(downloads)
        with ThreadPoolExecutor(max_workers=payload.download_threads) as executor:
            active = set()
            try:
                for _ in range(min(payload.download_threads, len(downloads))):
                    active.add(executor.submit(download, next(entries)))
                while active:
                    wait_if_paused(pause_event, cancel_event)
                    finished, active = wait(active, timeout=0.1, return_when=FIRST_COMPLETED)
                    for future in finished: future.result()
                    for _ in finished:
                        entry = next(entries, None)
                        if entry is not None: active.add(executor.submit(download, entry))
            except BaseException:
                stopped.set()
                for future in active: future.cancel()
                raise
    completed = [item.filename for _, item, _ in planned]
    wait_if_paused(pause_event, cancel_event)
    if operation in {'install', 'sync'}:
        # Delete only files owned by the previous tracked manifest, after new files succeed.
        prior = state.get('files', []) if state else []
        obsolete = set(prior) - set(completed)
        if operation == 'sync':
            for filename in sorted(obsolete):
                path = safe_path(root, filename)
                if path.is_file():
                    path.unlink()
        write_config(root, payload.region, payload.version)
        atomic_json(root / '.sophon' / 'state.json', {'schema': 1, 'game_type': 'hk4e',
                    'region': payload.region, 'version': payload.version,
                    'categories': categories, 'files': completed})
    if operation == 'download':
        atomic_json(root / '.sophon' / f'download-{payload.region}-{payload.version}.json',
                    {'version': payload.version, 'categories': categories, 'files': completed})
    result = {'version': payload.version, 'operation': operation, 'files': completed,
              'checked_files': len(planned), 'categories': categories, 'issues': issues if operation == 'check' else [],
              'healthy': not issues if operation == 'check' else True}
    progress.job_end()
    return result
