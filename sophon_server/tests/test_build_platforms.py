import pathlib
import tempfile
import unittest
from unittest.mock import patch
import build
import infrastructure.platform as runtime


class PlatformBuildTests(unittest.TestCase):
    def test_configs(self):
        for target, arch, asset, suffix in [('linux','x64','linux-x86_64',''), ('linux','arm64','linux-aarch_64',''), ('win32','x64','win64','.exe'), ('darwin','arm64','osx-universal_binary','')]:
            c = build.configuration(target, arch)
            self.assertTrue(c['protoc_url'].endswith(asset + '.zip'))
            self.assertIn('--output-filename=sophon-server' + suffix, c['command'])
            self.assertEqual(pathlib.Path(c['hpatchz']).name, 'hpatchz' + suffix)
        with self.assertRaises(ValueError):
            build.configuration('win32', 'arm64')

    def test_runtime_platforms(self):
        for target, filename in [('linux','hpatchz'), ('win32','hpatchz.exe')]:
            with tempfile.TemporaryDirectory() as d, patch.object(runtime.sys, 'platform', target), patch.object(runtime.platform, 'machine', return_value='AMD64'), patch.dict(runtime.os.environ, {}, clear=True), patch.object(runtime.shutil, 'which', return_value=None), patch.object(runtime.ctypes, 'CDLL', side_effect=AssertionError('must not load macOS libc')):
                root = pathlib.Path(d)
                tool = root / 'bin' / target / 'x64' / filename
                tool.parent.mkdir(parents=True)
                tool.touch()
                self.assertEqual(runtime.resolve_hpatchz(root), tool)
                runtime.memory_relief()


    def test_pycurl_openssl_isolation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            wheel = root / 'wheel'
            dist = root / 'dist'
            wheel.mkdir()
            (dist / 'pycurl').mkdir(parents=True)
            for name in ('libssl.3.dylib', 'libcrypto.3.dylib', 'libcurl.4.8.0.dylib', 'libssh2.1.dylib'):
                (wheel / name).write_text('wheel ' + name)
                (dist / name).write_text('original ' + name)
            extension = dist / 'pycurl' / '_pycurl.so'
            extension.touch()
            def output(command, **kwargs):
                if command[0] != 'otool':
                    return str(wheel)
                return command[-1] + ':\n\t@loader_path/libssl.3.dylib (compatibility version 3.0.0)\n\t@loader_path/libcrypto.3.dylib (compatibility version 3.0.0)\n'
            with patch.object(build.subprocess, 'check_output', side_effect=output), patch.object(build, 'run') as run:
                build.isolate_pycurl_openssl(dist, ['python'])
            commands = [call.args[0] for call in run.call_args_list]
            self.assertIn(['install_name_tool', '-change', '@loader_path/libssl.3.dylib',
                           '@loader_path/../pycurl-libssl.3.dylib', str(extension)], commands)
            self.assertIn(['install_name_tool', '-change', '@loader_path/libcrypto.3.dylib',
                           '@loader_path/pycurl-libcrypto.3.dylib', str(dist / 'libssh2.1.dylib')], commands)
            self.assertIn(['codesign', '--force', '--sign', '-', str(extension)], commands)
            for name in ('libssl.3.dylib', 'libcrypto.3.dylib'):
                self.assertEqual((dist / name).read_text(), 'original ' + name)
                self.assertEqual((dist / ('pycurl-' + name)).read_text(), 'wheel ' + name)
                self.assertFalse(any(command[-1] == str(dist / name) for command in commands))

    def test_pycurl_missing_wheel_dependency(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(build.subprocess, 'check_output', return_value=temporary):
            with self.assertRaisesRegex(RuntimeError, 'wheel dependency missing'):
                build.isolate_pycurl_openssl(temporary, ['python'])


if __name__ == '__main__':
    unittest.main()
