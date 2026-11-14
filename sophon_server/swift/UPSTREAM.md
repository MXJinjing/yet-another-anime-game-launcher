# Swift Sophon source

The upstream launcher pins the RPC-capable SophonClientv3 branch. This source
copy is based on [riverfog7/SophonClientv3 at d6aa77f](https://github.com/riverfog7/SophonClientv3/tree/d6aa77fc0534cabe4e72fbedc4fc71e361d05a16),
the latest revision of that branch at migration time. The default upstream
branch does not contain the launcher RPC service or update engine.

The source includes upstream Swift targets, protocols, dependency lock, tests,
and LGPL-2.1 license. The launcher additions cover selected files, task
controls, and HTTP sidecar lifecycle. Keep upstream changes and these patches
reviewable separately when updating the source copy.

See [the RPC reference](YAAGLM_RPC.md) for the launcher extensions.
