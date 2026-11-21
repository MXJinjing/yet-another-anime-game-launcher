# Sophon source mirror

Canonical source: [MXJinjing/sophon](https://github.com/MXJinjing/sophon).

`sophon_server/` is kept so launcher development can read the Swift sidecar and the legacy API beside the UI. It is a mirror only. This repository does not check it, synchronize it, or compile it in CI. `upstream-lock.json` is not a gate. Packaging does not read this directory.

The binary that ships in the app comes from the release named in [`sophon.release`](../sophon.release) at the launcher root. `./build-sophon.sh` downloads that release. Workflows call the script and do not select the version. To move the launcher onto a newer Sophon build, publish the release in `MXJinjing/sophon` first, then change `sophon.release`. An older pin continues to download that same release after upstream publishes a newer one.

`SOPHON_FROM_SOURCE=1 ./build-sophon.sh` compiles this mirror for local experiments. Do not use that path for CI or release packaging.
