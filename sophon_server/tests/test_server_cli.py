import contextlib
import io
import unittest
from unittest.mock import patch

import api.server as server


class ServerCliTests(unittest.TestCase):
    def test_port_selection(self):
        for argv, env, expected in [
            ([], {}, 18765),
            ([], {"SOPHON_PORT": "9001"}, 9001),
            (["--port", "9002"], {"SOPHON_PORT": "9001"}, 9002),
            (["--port=9003"], {"SOPHON_PORT": "invalid"}, 9003),
        ]:
            with self.subTest(argv=argv, env=env):
                with patch.dict(server.os.environ, env, clear=True), patch("uvicorn.run") as run:
                    server.main(argv)
                run.assert_called_once_with(server.app, host="127.0.0.1", port=expected, workers=1)

    def test_host_environment_is_preserved(self):
        with patch.dict(server.os.environ, {"SOPHON_HOST": "0.0.0.0"}, clear=True), patch("uvicorn.run") as run:
            server.main(["--port", "9000"])
        run.assert_called_once_with(server.app, host="0.0.0.0", port=9000, workers=1)

    def test_invalid_ports_do_not_start_server(self):
        for argv, env in [
            (["--port", "0"], {}),
            (["--port", "65536"], {}),
            (["--port", "invalid"], {}),
            ([], {"SOPHON_PORT": "invalid"}),
            ([], {"SOPHON_PORT": "65536"}),
        ]:
            with self.subTest(argv=argv, env=env):
                with patch.dict(server.os.environ, env, clear=True), patch("uvicorn.run") as run:
                    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                        server.main(argv)
                self.assertEqual(error.exception.code, 2)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
