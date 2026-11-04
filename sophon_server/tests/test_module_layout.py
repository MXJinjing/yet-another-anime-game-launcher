"""Verify the canonical module state, asset root and source entry point."""
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch


class ModuleLayoutTests(unittest.TestCase):
    def test_downloader_uses_the_shared_limiter(self):
        from engine import downloads, runtime
        from infrastructure.rate_limiter import limiter
        self.assertIs(downloads.runtime, runtime)
        self.assertIs(runtime.limiter, limiter)

    def test_asset_root_remains_next_to_the_source_entry(self):
        from engine.runtime import Options, SCRIPTDIR
        source = Path(__file__).resolve().parents[1] / "src"
        self.assertEqual(SCRIPTDIR, source)
        self.assertEqual(Options.tempdir, source / "tmp")

    def test_source_entry_delegates_to_server_main(self):
        from api import server
        source = Path(__file__).resolve().parents[1] / "src"
        with patch.object(server, "main") as main:
            runpy.run_path(str(source / "server.py"), run_name="__main__")
        main.assert_called_once_with()
