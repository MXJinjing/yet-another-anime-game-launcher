# Launcher JSON-RPC extensions

Run `swift run SophonCLI rpc --transport http --port 18765 --token TOKEN` from
this package, or omit the transport flag for JSON-RPC over standard input.
HTTP requests use `POST /rpc`, `Content-Type: application/json`, and
`Authorization: Bearer TOKEN`. Browser clients need an exact `--allow-origin`.
The launcher also passes its process ID in `--parent-pid`.

| Method | Named parameters |
| --- | --- |
| `game.online` | `game` (ID or biz), `region` (`os`, `cn`, or `bb`) |
| `files.build` | `game`, `region`, optional `version` |
| `files.list` | `game`, `region`, `version`, `category` (default `game`), `path` (default `.`), optional `pattern`, `recursive`, `offset`, `limit` (1–1000), `refresh` |
| `files.download` | `game`, `region`, `directory`, `version`, `categories` (default `["game"]`), nonempty `files` of exact manifest-relative paths |
| `repair.start` | Install parameters plus optional `installedVersion` to apply an advertised update before verification |
| `operation.pause`, `operation.resume` | `operationID` |
| `operation.limit` | `bytesPerSecond` (0 is unlimited), optional `operationID` |

`files.list` returns `version`, `category`, `path`, `total`, `offset`, and
`files`. Each entry includes `filename`, `name`, and `type`. File entries also
include `size` and `md5`. An exact file path returns one entry, a directory
returns its immediate children, and a recursive or glob query returns
matching descendant files. `refresh` bypasses the local manifest cache.

`files.download` returns an operation ID immediately. Use `operation.status`
or `operation.wait` to get the outcome. It resolves an exact version and all
requested files before staging them, verifies every file, then atomically
replaces each target. It leaves the installed version and launcher state
untouched. Existing files survive a failed download or checksum.

`install.start`, `update.start`, `repair.start`, and `files.download` accept
`bytesPerSecond` in their initial parameters. Pause takes effect at file or
payload checkpoints. Cancelling resumes any blocked connection solely to
terminate it. Install and update use upstream checkpoints.
