import copy
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import zstandard
import services.history as history
import services.manifest_browser as manifest_browser
import manifest_pb2
from api.models import TaskStatus


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Manager:
    def __init__(self):
        self.events = []
    def send_message_threadsafe(self, message, task_id):
        self.events.append(message)


class HistoricalFileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.assets = Path(cls.temp.name)
        handler = functools.partial(QuietHandler, directory=str(cls.assets))
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.builds = {}
        for version, contents in [('4.5.0', {'data/selected.bin': b'old-data', 'data/removed.bin': b'removed'}),
                                  ('5.0.0', {'data/selected.bin': b'new-data', 'data/new.bin': b'new'})]:
            pb = manifest_pb2.Manifest()
            for name, content in contents.items():
                item = pb.files.add(filename=name, size=len(content), md5=hashlib.md5(content).hexdigest())
                compressed = zstandard.ZstdCompressor().compress(content)
                chunk_id = hashlib.md5(compressed).hexdigest()
                (cls.assets / chunk_id).write_bytes(compressed)
                item.chunks.add(chunk_id=chunk_id, md5=item.md5, offset=0,
                                compressed_size=len(compressed), uncompressed_size=len(content))
            raw = zstandard.ZstdCompressor().compress(pb.SerializeToString())
            filename = f'manifest-{version}'
            (cls.assets / filename).write_bytes(raw)
            cls.builds[version] = {'retcode':0,'data':{'tag':version,'manifests':[{
                'matching_field':'game', 'manifest':{'id':filename},
                'manifest_download':{'url_prefix':cls.base}, 'chunk_download':{'url_prefix':cls.base}}]}}

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name) / 'game'
        self.manager = Manager()
        self.tasks = {'test':TaskStatus(task_id='test', status='running')}
        self.query = patch.object(history, 'query_build', side_effect=lambda region, version: copy.deepcopy(self.builds[version]))
        self.query.start()
        # Browsing binds query_build at module import time; mock its own lookup too.
        browser_query = patch.object(manifest_browser, 'query_build',
            side_effect=lambda region, version: copy.deepcopy(self.builds[version]))
        browser_query.start()
        self.addCleanup(browser_query.stop)
        cache_environment = patch.dict('os.environ', {
            'SOPHON_MANIFEST_CACHE': str(Path(self.directory.name) / 'manifest-cache')})
        cache_environment.start()
        self.addCleanup(cache_environment.stop)
        manifest_browser._cache.clear()
        self.addCleanup(manifest_browser._cache.clear)
        self.progress = patch('services.progress.InstallProgressHandler._calculate_speed')
        self.progress.start()

    def tearDown(self):
        self.query.stop()
        self.progress.stop()
        self.directory.cleanup()

    def run_operation(self, mode, version='4.5.0', **extra):
        payload = history.HistoryRequest(gamedir=str(self.root), version=version, **extra)
        return history.run_history(self.manager, self.tasks, 'test', mode, payload, threading.Event(), threading.Event())

    def test_parallel_files_use_isolated_shared_chunk_caches(self):
        from engine.client import SophonClient
        content = b'shared-chunk-content'
        compressed = zstandard.ZstdCompressor().compress(content)
        chunk_id = hashlib.md5(compressed).hexdigest()
        (self.assets / chunk_id).write_bytes(compressed)
        pb = manifest_pb2.Manifest()
        for filename in ('data/first.bin', 'data/second.bin'):
            item = pb.files.add(filename=filename,size=len(content),md5=hashlib.md5(content).hexdigest())
            item.chunks.add(chunk_id=chunk_id,offset=0,compressed_size=len(compressed),uncompressed_size=len(content))
        manifest_name = 'manifest-parallel-fixture'
        (self.assets / manifest_name).write_bytes(zstandard.ZstdCompressor().compress(pb.SerializeToString()))
        build = copy.deepcopy(self.builds['4.5.0'])
        build['data']['manifests'][0]['manifest']['id'] = manifest_name
        barrier = threading.Barrier(2)
        original = SophonClient.download_game_file
        clients = []
        def parallel(client,item,**kwargs):
            clients.append(client)
            barrier.wait(timeout=5)
            return original(client,item,**kwargs)
        with patch.object(history,'query_build',return_value=build),patch.object(SophonClient,'download_game_file',parallel):
            self.run_operation('install',download_threads=2)
        self.assertEqual(len({id(client.di_chunks) for client in clients}),2)
        self.assertEqual(len({client._history_chunk_directory for client in clients}),2)
        for filename in ('first.bin','second.bin'):
            self.assertEqual((self.root/'data'/filename).read_bytes(),content)
        self.assertEqual(history.local_version(self.root),'4.5.0')

    def test_worker_failure_stops_peers_without_committing_version(self):
        from engine.client import SophonClient
        from infrastructure.errors import TaskCancelledError
        barrier = threading.Barrier(2)
        peer_stopped = threading.Event()
        def failing(client,item,**kwargs):
            if not getattr(client, '_fixture_started', False):
                client._fixture_started = True
                barrier.wait(timeout=5)
            if item.filename == 'data/selected.bin':raise RuntimeError('worker failure')
            self.assertTrue(kwargs['cancel_event'].wait(5))
            peer_stopped.set()
            raise TaskCancelledError('peer stopped')
        with patch.object(SophonClient,'download_game_file',failing):
            with self.assertRaisesRegex(RuntimeError,'worker failure'):
                self.run_operation('install',download_threads=2)
        self.assertTrue(peer_stopped.is_set())
        self.assertFalse((self.root/'config.ini').exists())

    def test_download_threads_validation(self):
        from pydantic import ValidationError
        self.assertEqual(history.HistoryRequest(gamedir=str(self.root),version='4.5.0').download_threads,8)
        for value in (0,65):
            with self.assertRaises(ValidationError):
                history.HistoryRequest(gamedir=str(self.root),version='4.5.0',download_threads=value)

    def test_selected_file_only_and_read_only_check(self):
        self.run_operation('download', files=['data/selected.bin'])
        self.assertEqual((self.root / 'data/selected.bin').read_bytes(), b'old-data')
        self.assertFalse((self.root / 'data/removed.bin').exists())
        self.assertFalse((self.root / 'config.ini').exists())
        (self.root / 'data/selected.bin').write_bytes(b'BAD-DATA')
        result = self.run_operation('check', files=['data/selected.bin'])
        self.assertFalse(result['healthy'])
        self.assertEqual((self.root / 'data/selected.bin').read_bytes(), b'BAD-DATA')
        self.run_operation('repair', files=['data/selected.bin'])
        self.assertEqual((self.root / 'data/selected.bin').read_bytes(), b'old-data')

    def test_missing_selection_never_downloads_unselected_files(self):
        with self.assertRaisesRegex(ValueError, 'Files not found'):
            self.run_operation('download', files=['not-in-manifest'])
        self.assertFalse((self.root / 'data').exists())

    def test_sync_updates_tracked_files_preserves_extra_and_requires_downgrade_opt_in(self):
        self.run_operation('install')
        self.assertEqual(history.local_version(self.root), '4.5.0')
        (self.root / 'keep-user-file').write_text('keep')
        self.run_operation('sync', version='5.0.0')
        self.assertFalse((self.root / 'data/removed.bin').exists())
        self.assertEqual((self.root / 'keep-user-file').read_text(), 'keep')
        self.assertEqual(history.local_version(self.root), '5.0.0')
        with self.assertRaisesRegex(ValueError, 'Downgrade'):
            self.run_operation('sync', version='4.5.0')
        self.run_operation('sync', version='4.5.0', allow_downgrade=True)
        self.assertEqual(history.local_version(self.root), '4.5.0')

    def test_interrupted_install_resumes_without_false_version(self):
        from engine.client import SophonClient
        original = SophonClient.download_game_file
        def interrupted(client, item, **kwargs):
            if item.filename == 'data/removed.bin':
                raise RuntimeError('interrupted')
            return original(client, item, **kwargs)
        with patch.object(SophonClient, 'download_game_file', interrupted):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                self.run_operation('install')
        self.assertFalse((self.root / 'config.ini').exists())
        self.run_operation('install')
        self.assertEqual(history.local_version(self.root), '4.5.0')

    def test_failure_does_not_advance_version(self):
        self.run_operation('install')
        from engine.client import SophonClient
        with patch.object(SophonClient, 'download_game_file', side_effect=RuntimeError('network failure')):
            with self.assertRaisesRegex(RuntimeError, 'network failure'):
                self.run_operation('sync', version='5.0.0')
        self.assertEqual(history.local_version(self.root), '4.5.0')
        self.assertTrue((self.root / 'data/removed.bin').exists())

    def test_repair_does_not_auto_upgrade_historical_installation(self):
        self.run_operation('install')
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.run_operation('repair', version='5.0.0')
        self.assertEqual(history.local_version(self.root), '4.5.0')

    def test_cancel_before_file_download(self):
        from infrastructure.errors import TaskCancelledError
        payload = history.HistoryRequest(gamedir=str(self.root), version='4.5.0', files=['data/selected.bin'])
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(TaskCancelledError):
            history.run_history(self.manager,self.tasks,'test','download',payload,cancel,threading.Event())
        self.assertFalse((self.root / 'data/selected.bin').exists())

    def test_file_listing_is_pinned_and_filtered(self):
        result = history.files_info('os','4.5.0','game','*/selected.*')
        self.assertEqual(result['total'],1)
        self.assertEqual(result['files'][0]['filename'],'data/selected.bin')


class HistoricalValidationTests(unittest.TestCase):
    def test_no_silent_version_fallback(self):
        branches = {'game_branches':[{'main':{'branch':'main','package_id':'example','password':'example'}}]}
        wrong = {'tag':'7.1.0','manifests':[{}]}
        with patch.object(history, 'remote_json', side_effect=[branches,wrong]):
            with self.assertRaisesRegex(ValueError, 'refusing version fallback'):
                history.query_build('os','4.5.0')

    def test_windows_and_unix_escape_paths_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for filename in ['../outside','/outside','C:/outside','C:\\outside','\\\\server\\file','']:
                with self.assertRaises(ValueError):
                    history.safe_path(root,filename)
            (root/'link').symlink_to(root.parent)
            with self.assertRaises(ValueError):
                history.safe_path(root,'link/outside')


if __name__ == '__main__':
    unittest.main()
