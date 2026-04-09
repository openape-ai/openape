---
'@openape/apes': patch
---

fix(apes): adapter lookup normalizes absolute paths and matches on executable

`ape-shell` / `apes run --shell` previously failed to resolve a shapes adapter when the parsed command started with an absolute path (`/usr/local/bin/o365-cli`) or when the registry entry's `id` differed from its `executable` field. Both cases fell back silently to a generic `bash -c` session grant.

- `loadOrInstallAdapter` now normalizes the input with `basename()` before any lookup.
- `findAdapter` matches both `id` and `executable`, so a binary name like `o365-cli` resolves to its registry entry (`id: "o365"`). Backward compatible — `id`-based lookups keep working.
- After auto-install, the adapter is reloaded under the registry `id`, not the executable name.
