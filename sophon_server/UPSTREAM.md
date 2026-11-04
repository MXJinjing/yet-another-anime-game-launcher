# Sophon source copy

Canonical shared server: [MXJinjing/sophon](https://github.com/MXJinjing/sophon).
The launcher keeps a source copy, not a Git submodule. `upstream-lock.json`
records the imported commit and SHA-256 checksums for all shared files.

## Maintenance

1. Implement and commit shared server changes in the Sophon repository first.
2. From the launcher root, review differences, then synchronize:

   ```sh
   python3 scripts/sync-sophon.py --source ../sophon --check
   python3 scripts/sync-sophon.py --source ../sophon --apply
   python3 scripts/sync-sophon.py --source ../sophon --check
   ```

3. Run the affected tests and commit the updated source copy and revision lock
   with any launcher UI changes. Changes to shared protocol events must be
   documented in both API references.

`--verify-lock` checks local checksums without a Sophon checkout and runs in
the launcher test/CI entry point. `--check` is read-only and is the default. `--apply` copies only committed
server source, protobuf schemas, shared tests and license. It refuses to
replace launcher shared edits that differ from both the previous baseline and
the new Sophon version. Backport those edits before synchronizing. A shared
file removed upstream is removed locally only if it has no divergent edits.
The script does not fetch, build, publish or change the installed application.

## Launcher-owned files

The following are maintained separately: `build.py`, dependency/coverage/test
configuration, README, hpatchz integration, launcher UI and
`tests/test_launcher_*.py`. The standalone CLI and release packaging test are
not copied. Generated protobuf, environments, caches and build output are
excluded. The API reference remains in README; do not overwrite its
launcher-specific startup/build instructions during synchronization.
