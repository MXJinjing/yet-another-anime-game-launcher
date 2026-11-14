# SophonClientv3

Swift 6.3 library and CLI for Sophon installation, incremental updates, and predownloads. Linux and macOS 13+ are supported. Windows patching is deferred until HDiffSwift supports it.

```sh
swift build
.build/debug/SophonCLI --help
.build/debug/SophonCLI update GAME /games/GAME
.build/debug/SophonCLI update GAME /games/GAME --predownload --cache-at /downloads/GAME
.build/debug/SophonCLI next-action GAME /games/GAME
.build/debug/SophonCLI state /games/GAME
.build/debug/SophonCLI state /games/GAME --operation install
```

`GAME` accepts an API game ID or biz. `--cn` selects CN endpoints; `--mode base` selects the base installation scenario. `update --predownload` selects the future branch; `--cache-at PATH` downloads and verifies its diff bundles there, without scanning patch sources, applying patches, or deleting game files. The default source version is detected from the configured executable MD5 and API version records; `--from` overrides it. `update --plan` prints the static manifest plan without modifying game files.

Update uses the installation command's terminal dashboard, showing versions, received/retained/remaining patch bytes, verified bundles, file progress, repairs, verified output, and deletions. Network rates count new traffic in this run. Read and write counters/rates update while I/O is happening, grouped by storage volume; target and cache paths on the same volume share one row. RAM reservations and disk cache use update alongside them. These are application I/O counters, not physical device traffic. Use `--plain` for append-only summaries or `--refresh-interval` to adjust refreshes. The reporters own metric counters and calculations in `Models/SophonMetrics.swift`; CLI and RPC sample snapshots externally at 250 ms by default. Progress goes to stderr; `--plan` keeps JSON on stdout.

macOS release builds strip debug and non-global symbols at link time. This applies to `SophonCLI` only; debug builds retain those symbols. It differs from post-build `strip -u -r`, so the final size should be measured on the macOS artifact.

## Cache and recovery

Each operation has one RAM-first working cache shared by downloaded payloads, original inputs, and repair processing buffers. Data spills to disk only when it cannot fit in RAM. Byte limits and the entry limit provide backpressure, with capacity reserved for consumers so downloads cannot occupy their input space. Consumed data is removed immediately; successful completion removes the whole working directory. Manifest caching, explicit predownloads, and operation state are separate.

Disk spills journal received prefixes of 4 MiB HTTP ranges after writing their bytes. An interrupted run retains unconsumed spills, and resumed requests start at their recorded prefixes. Retained files count against the next run's budget. RAM-only payloads are volatile and must be downloaded again after exiting. Servers that ignore Range requests fall back to a full request. Payload size and MD5 are checked before use; cached predownloads are rechecked when read.

`update --cache-at PATH` stores the complete predownload separately from the bounded fast working cache. Its size is limited by available storage, rather than `--disk-cache-gib`. Resume by repeating the command. The chosen directory is saved with the update state; a later update without `--cache-at` reads and verifies those bundles before downloading missing data through the normal cache. Predownloads remain in their chosen directory after application.

An update only checks and modifies its selected patch targets. It skips targets already matching the new hash, caches and checks old inputs, applies HDIFF through [HDiffSwift](https://github.com/ohaiibuzzle/hdiffswift), and streams the output to disk while calculating its MD5. Raw bundle payloads are copied with the same output checks. Broken sources and failed patches fall back to their installation chunks without scanning the rest of the installation. Obsolete files are deleted last.

Successful installation and applied updates write the target version to `config.ini` under `[General]` before recording completion. The private client method preserves existing channel, SDK/plugin, and other settings; it creates the version section when absent. Download-only updates leave this file untouched. A config write failure leaves completion unrecorded so repeating the operation can retry finalization using its existing checkpoints.

Checkpointed resume is enabled by default. Installation scans once to create its initial plan, then records each completed chunk placement and trim. Restart loads that saved plan and downloads/writes only the remaining placements, without scanning the installation again. An update records each completed target after output verification and replacement. Restart trusts those completed-file receipts and works only on unfinished targets. Initial scanning that stopped before a plan was saved must be repeated.

Completion receipts assume game files have not changed outside the operation. Use `--stateless` for a fresh verification: installation scans its files again, while updating checks its selected patch targets before fetching bundles. This discards that operation's checkpoints and working cache; explicit predownloads remain available. A whole bundle is downloaded when any remaining target needs it. Resume an unfinished operation before starting a different operation type in the same game directory.

The default `--write-mode temporary` keeps the existing target until output verification succeeds. Replacement uses a recoverable rename and backup. `--write-mode in-place` preserves the original beside the operation state before overwriting the target. These originals share the disk budget and are removed when their consumers finish. An interrupted active patch restarts from its saved original. In-place mode requires disk caching. This is process-exit recovery, not a guarantee against power loss. Keep the cache and state directories until an unfinished update has completed, and resume with the same `--from` version and directories.

Useful options on `install` and `update`:

| Option | Default | Purpose |
| --- | --- | --- |
| `--cache-directory PATH` | User cache directory | Bounded working cache for live downloads and original files |
| `--cache-at PATH` | Off | Update only: download verified diff bundles here without applying |
| `--state-directory PATH` | Within cache | Saved plan and per-file checkpoints |
| `--memory-cache-mib N` | 1024 | Shared working RAM budget in MiB |
| `--disk-cache-gib N` | 10 | Maximum shared working disk spill in GiB for this operation |
| `--no-disk-cache` | Off | Disable live working-cache spill; explicit predownloads still use disk |
| `--cache-entry-limit N` | 500 | Maximum entries admitted to a cache queue |
| `--io-policy parallel` | Install and update | Concurrent target file work using configured worker counts |
| `--io-policy serialized` | Off | Serialized update target I/O and installer writes, including repairs |
| `--stateless` | Off | Rebuild work from files instead of trusting saved checkpoints |

Originals exceeding the RAM budget spill to disk. In-place originals and originals needed by another update target remain available until their consumers finish. Insufficient working-cache capacity for one live payload and its required input fails with an error. Lowering the disk limit can discard download prefixes to fit the new ceiling; recovery originals are never discarded for capacity. Disabling disk caching discards old working downloads and uses RAM for live data.

These are cache-storage limits, not a process memory cap or a total filesystem quota. RAM reservations cover live payloads, original snapshots, and cached processing output. Manifests, native patch buffers, temporary decompression buffers, and HTTP buffers use additional memory. The disk limit covers shared logical payload reservations, including retained spills and recovery originals. Filesystem allocation, journals/state, target temporary output, and explicit predownloads add disk use.

Updates and installations use parallel target I/O by default. Updates use the configured patch/write worker count, including repair writes. Use `--io-policy serialized` to keep target reads and writes separate, flushing verified output before the next read, while HTTP transfers and cache I/O continue on the cache drive. Installer scanning precedes target writes and uses the configured check-worker count under either policy. These policies do not measure the hardware or promise a particular throughput.

SIGINT/SIGTERM cancel queued work and drain an active native patch write before exiting. A forced kill retains the last recorded state. Separate processes cannot modify the same game directory concurrently.

## App-facing JSON-RPC

Start `.build/debug/SophonCLI rpc` for newline-delimited JSON-RPC 2.0 on stdin/stdout. Stdout carries protocol messages only. Requests may complete out of order; match responses by `id`. Notifications have no response. Closing stdin or calling `rpc.shutdown` cancels and drains active operations.

```json
{"jsonrpc":"2.0","id":1,"method":"rpc.discover"}
{"jsonrpc":"2.0","id":2,"method":"update.start","params":{"game":"GAME","directory":"/games/GAME","sourceVersion":"SOURCE_VERSION","transfer":{"cacheDirectory":"/fast/cache","ioPolicy":"parallel"}}}
{"jsonrpc":"2.0","id":3,"method":"operation.status","params":{"operationID":"ID_FROM_START"}}
{"jsonrpc":"2.0","id":4,"method":"operation.cancel","params":{"operationID":"ID_FROM_START"}}
```

`install.start` and `update.start` return an operation ID immediately. Stdio emits `operation.progress` and `operation.finished` notifications. `operation.wait` waits for the final status; check `status === "completed"` because failed and cancelled operations also return a status. Cancellation remains available while it waits. Installation progress includes `totalDownloadBytes`, `totalWriteBytes`, `downloadedBytes`, `writtenBytes`, and the reporter's file/chunk counts. Totals can be absent until the plan is known. Status for the most recent 128 completed operations is kept in the process. `state.inspect` needs only `directory`, optional `transfer`, and optional `operation` (`update` by default or `install`); it reads persisted state without contacting the API.

Stdio progress notifications include `kind` (`install`/`update`), 0–128 raw `events`, and one latest progress snapshot per batch. An external 250 ms sampler sends snapshots with `events: []` during quiet transfers. Events are collected without transport waits and sent as soon as the writer is available. A slow consumer can grow the RAM backlog; there is no event dropping or disk spool. Status queries and operation completion do not wait for notifications to drain. `operation.finished` follows all events for its operation, and normal shutdown drains notifications. The [client batching examples](rpc-client/README.md#progress-and-lifecycle) show typed consumption with `onProgressBatch()`. Add `rpc --progress-snapshots-only` for UI updates capped at one per 250 ms per operation, with no raw event subscription or event arrays. Use `onProgress()` in this mode; terminal status bypasses the timer and pending snapshots coalesce behind a slow writer.

Operation parameters: `game`, `directory`, optional `cn`, `mode` (`full`/`base`), `voicePacks` and `predownload` (installation), `downloads` (8), `writes` (4), and `transfer`. `sourceVersion` is optional for updates. `predownload: true` selects the future branch, and `cacheOnly: true` downloads verified diff bundles without applying them. `transfer.predownloadDirectory` selects their directory, defaulting to the saved location or `<game>/.sophon-predownload`. `game.version` reports executable-based detection, and `game.nextAction` returns a decision without executing it. Transfer fields use bytes for `memoryLimit` and `diskLimit`, an `entryLimit` of 500 by default, and `writeMode: "temporary"` or `"in-place"`. Set `transfer.preserveState: false` for a fresh verification.

Omitting `transfer.ioPolicy` uses parallel I/O for both updates and installations, with the configured `writes` worker count. Set it to `"serialized"` to serialize target I/O. `transfer.memoryLimit` defaults to 1 GiB. Set `transfer.diskCacheEnabled: false` to disable working disk spill; explicit predownload storage is independent. Update status includes per-bundle download bytes and per-volume I/O/cache counters under `progress.metrics.common.resources`. Installation and update share common timing, metadata, network, I/O, file, and resource metrics; operation-specific sections cover verification, processing, patches, repair, and deletion. The [TypeScript schemas](rpc-client/src/index.ts) describe all fields.

RPC process defaults are set with `--manifest-cache-dir PATH`, `--log-file PATH`, and `--log-level LEVEL`. They apply to every game query and operation in both transports. Without overrides, manifests use the system cache and file logging is disabled; the default log level is `info`. File logs append safely across concurrent operations, and logging failures stay off JSON-RPC stdout. Node and Neutralino pass these flags through `stdio()`'s argument array; HTTP callers use the settings supplied when starting the server. See [session settings](rpc-client/README.md#session-settings).

For HTTP, run:

```sh
.build/debug/SophonCLI rpc --transport http --port 0 --token YOUR_TOKEN
```

The CLI emits an `rpc.listening` message containing its localhost URL. POST JSON requests to that URL with `Content-Type: application/json` and, when configured, `Authorization: Bearer YOUR_TOKEN`. HTTP notifications return 204; poll `operation.status` for progress. Both transports limit requests to 1 MiB and batches to 128 entries. Stdio remains the default transport.

For browser clients, add `--allow-origin http://localhost:5173` using the frontend's exact origin. Repeat the option for additional origins. HTTP responds to JSON/bearer CORS preflights and rejects origins that are not explicitly permitted; browser origins are disabled by default. Neutralino stdio does not require CORS.

Metadata methods include `api.games`, `api.configs`, `api.branches`, `api.scanInfo`, `api.wpfPackages`, `api.resolveGame`, `api.gameInfo`, `api.lookupVersion`, `api.compareBranches`, `api.checkUpdatePath`, `api.sophonBuild`, and `api.sophonPatchBuild`. All accept named parameters and optional `cn`. Game-specific methods accept `game`; `resolveGame` accepts `query`, `lookupVersion` accepts `md5`, and `checkUpdatePath` accepts `sourceVersion`. Language/search/version/predownload filters correspond to the CLI metadata commands.

## Validation

Local transfer, native patch, and RPC tests stay in the existing test file and do not download a game:

```sh
swift test --filter 'testStreamedPatchWithCachedInputs|testTransfer'
```

Linux/macOS CI runs this focused suite. Existing live-manifest tests can be run separately. Real ZZZ repair, cache-budget measurements, and throttled-storage results are recorded in [resource validation](docs/resource-validation.md).

## Selecting the next action

`next-action GAME DIR` and `game.nextAction` inspect saved operations before executable version detection. Matching unfinished installations/updates resume using their saved plans; a partial applied operation targeting an obsolete version is reconciled using the live installation manifest. Known older versions update to live when incremental patches are supported and a diff is advertised; otherwise, the decision selects installation. An up-to-date installation caches an available future update, unless its payloads are already present. Cache-only receipts never establish an installed version. The decision contains action, source/target versions, branch, cache-only flag, scenario, voice packs and reason.

Version detection uses `exe_file_name` from the launch configuration and version/MD5 records from the API. Multiple versions sharing one executable hash require matching completed installation history or an explicit source override. Source-file integrity is checked by the update pipeline; it does not require a full installation scan before choosing an action.

The [TypeScript client](rpc-client/README.md) provides browser/React HTTP, Node stdio, and Yaagl-compatible Neutralino stdio entry points with no runtime dependencies. Notification callback errors are isolated, and stdio shutdown has bounded termination fallbacks.
