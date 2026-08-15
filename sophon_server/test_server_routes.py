import asyncio
import unittest
from unittest.mock import patch

from starlette.routing import Match

import server
from models import LimitRequest


class ServerRouteTests(unittest.TestCase):
    def test_limit_route_is_not_shadowed_by_task_type_route(self):
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/limit",
            "root_path": "",
        }
        first_match = next(
            route
            for route in server.app.routes
            if route.matches(scope)[0] is Match.FULL
        )
        self.assertEqual(first_match.path, "/api/limit")

        with patch.object(server.limiter, "set_rate") as set_rate:
            response = asyncio.run(
                server.set_download_speed_limit(
                    LimitRequest(download_speed_limit=1024)
                )
            )

        self.assertEqual(response, {"ok": True})
        set_rate.assert_called_once_with(1024)


if __name__ == "__main__":
    unittest.main()
